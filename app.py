from flask import Flask, render_template, Response, jsonify, send_from_directory, request
import cv2
from ultralytics import YOLO
from datetime import datetime, timedelta
import csv, os, time, json
import pandas as pd

app = Flask(__name__)

# ================= CONFIG =================
MODEL_PATH = "best.pt"
CONF_TH = 0.6
CAPTURE_BASE = "captures"
CSV_FILE = "registro_detectados.csv"
CAMERAS_FILE = "cameras.json"
# Evita registrar la misma especie en la misma cámara muy seguido (segundos)
COOLDOWN_SECONDS = 10 
ultimas_detecciones = {} 

os.makedirs(CAPTURE_BASE, exist_ok=True)

# ================= MODEL =================
try:
    model = YOLO(MODEL_PATH)
except Exception as e:
    print("Error cargando modelo:", e)
    model = None

# ================= FILE INIT =================
def init_files():
    if not os.path.exists(CSV_FILE):
        with open(CSV_FILE, "w", newline="", encoding="utf-8") as f:
            csv.writer(f).writerow(["camara","fecha","hora","especie","x1","y1","x2","y2","confianza","lat","lon","imagen"])
    
    if not os.path.exists(CAMERAS_FILE):
        # Inicializar sin cámaras predefinidas — el usuario añadirá las suyas
        with open(CAMERAS_FILE, "w", encoding="utf-8") as f:
            json.dump({}, f, indent=2)

init_files()

# ================= UTILS =================
def load_cameras():
    try:
        with open(CAMERAS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except: return {}

def get_df():
    # Lee el CSV y asegura que las columnas que usamos existan (para evitar KeyError en la UI)
    cols = ["camara","fecha","hora","especie","x1","y1","x2","y2","confianza","lat","lon","imagen"]
    try:
        # Leer con tolerancia a líneas mal formadas (p. ej. si hay comas en campos no escapadas)
        try:
            df = pd.read_csv(CSV_FILE, engine='python', on_bad_lines='skip')
        except TypeError:
            # Compatibilidad con versiones antiguas de pandas
            df = pd.read_csv(CSV_FILE, engine='python')
        # Añadir columnas faltantes con valores por defecto
        for c in cols:
            if c not in df.columns:
                df[c] = ""
        # Normalizar valores nulos
        df = df.fillna("")
        return df if not df.empty else pd.DataFrame(columns=cols)
    except Exception as e:
        print('Error leyendo CSV:', e)
        return pd.DataFrame(columns=cols)

def save_capture(frame, especie):
    path = os.path.join(CAPTURE_BASE, datetime.now().strftime("%Y"), especie)
    os.makedirs(path, exist_ok=True)
    img_name = f"{datetime.now().strftime('%H%M%S')}.jpg"
    cv2.imwrite(os.path.join(path, img_name), frame)
    return f"{datetime.now().strftime('%Y')}/{especie}/{img_name}"

# ================= STREAM =================
def generar_stream(device_id):
    cap = cv2.VideoCapture(int(device_id))
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                # Evitar loop apretado si la cámara no devuelve frames
                time.sleep(0.1)
                continue

            if model:
                try:
                    results = model(frame, verbose=False)
                except Exception as e:
                    print("Model inference error:", e)
                    results = []

                for r in results:
                    for box in r.boxes:
                        conf = float(box.conf[0])
                        if conf < CONF_TH: continue

                        cls = int(box.cls[0])
                        especie = model.names.get(cls, str(cls))

                        # Lógica de Cooldown
                        key = f"{device_id}_{especie}"
                        ahora = datetime.now()
                        if key not in ultimas_detecciones or (ahora - ultimas_detecciones[key]) > timedelta(seconds=COOLDOWN_SECONDS):
                            ultimas_detecciones[key] = ahora
                            x1, y1, x2, y2 = map(int, box.xyxy[0])
                            img_p = save_capture(frame, especie)
                            cams = load_cameras()
                            cam = next((c for c in cams.values() if str(c.get("device")) == str(device_id)), {})

                            with open(CSV_FILE, "a", newline="", encoding="utf-8") as f:
                                csv.writer(f).writerow([f"Cam {device_id}", ahora.strftime("%Y-%m-%d"), ahora.strftime("%H:%M:%S"), especie, x1,y1,x2,y2, round(conf,2), cam.get("lat",""), cam.get("lon",""), img_p])

                        # Dibujar
                        x1,y1,x2,y2 = map(int, box.xyxy[0])
                        cv2.rectangle(frame, (x1,y1), (x2,y2), (0,255,0), 2)
                        cv2.putText(frame, f"{especie} {conf:.2f}", (x1, y1-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,255,0), 2)

            _, buffer = cv2.imencode('.jpg', frame)
            yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
    except GeneratorExit:
        # Cliente desconectó
        pass
    except Exception as e:
        print("Stream error:", e)
    finally:
        cap.release()

# ================= ROUTES =================
@app.route("/")
def index():
    return render_template("index.html", cameras=load_cameras())

@app.route("/video_feed_cam/<cam_id>")
def video_feed_cam(cam_id):
    cams = load_cameras()
    dev = cams.get(str(cam_id), {}).get("device", 0)
    return Response(generar_stream(dev), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route("/api/ultimos_registros")
def ultimos_registros():
    df = get_df()
    return jsonify(df.tail(5).iloc[::-1].to_dict(orient="records"))

@app.route("/api/todos_registros")
def todos_registros():
    return jsonify(get_df().to_dict(orient="records"))

@app.route("/api/dashboard_stats")
def dashboard_stats():
    df = get_df()
    return jsonify(df["especie"].value_counts().to_dict()) if not df.empty else jsonify({})

@app.route("/registros")
def registros(): return render_template("registros.html")

@app.route("/dashboard")
def dashboard(): return render_template("dashboard.html")

@app.route("/api/guardar_camara", methods=["POST"])
def guardar_camara():
    data = request.json
    cams = load_cameras()
    
    # Si no tiene ID (es nueva), generamos uno basado en el timestamp
    cam_id = data.get("id")
    if not cam_id:
        cam_id = str(int(time.time()))
    
    cams[cam_id] = {
        "nombre": data.get("nombre"),
        "lat": data.get("lat"),
        "lon": data.get("lon"),
        "device": data.get("device")
    }
    
    with open(CAMERAS_FILE, "w", encoding="utf-8") as f:
        json.dump(cams, f, indent=2)
        
    return jsonify({"status": "ok"})

@app.route("/api/camaras")
def api_camaras():
    # Devuelve la configuración de cámaras (utilizada por la UI de administración)
    return jsonify(load_cameras())

@app.route("/admin_camaras")
def admin_camaras():
    return render_template("cameras_admin.html")

@app.route('/captures/<path:filename>')
def serve_capture(filename):
    # Permite acceder a las imágenes salvadas en la carpeta de captures
    return send_from_directory(CAPTURE_BASE, filename)

@app.route('/api/camaras/<cam_id>/set_device', methods=['POST'])
def set_camera_device(cam_id):
    data = request.json or {}
    device = data.get('device')
    cams = load_cameras()
    if cam_id not in cams:
        return jsonify({'success': False, 'error': 'camera_not_found'}), 404
    try:
        cams[cam_id]['device'] = int(device)
    except Exception:
        cams[cam_id]['device'] = device
    with open(CAMERAS_FILE, 'w', encoding='utf-8') as f:
        json.dump(cams, f, indent=2)
    return jsonify({'success': True})

@app.route('/api/camaras/<cam_id>/delete', methods=['POST'])
def delete_camera(cam_id):
    """Elimina una cámara de la configuración.
    No borra imágenes capturadas (para evitar pérdida accidental).
    """
    cams = load_cameras()
    if cam_id not in cams:
        return jsonify({'success': False, 'error': 'not_found'}), 404
    try:
        del cams[cam_id]
        with open(CAMERAS_FILE, 'w', encoding='utf-8') as f:
            json.dump(cams, f, indent=2)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Extra endpoints para el dashboard
@app.route('/api/summary')
def api_summary():
    df = get_df()
    cams = load_cameras()
    total = len(df)
    species_count = df['especie'].nunique() if not df.empty else 0
    cameras_active = len(cams)
    last_row = df.tail(1)
    if not last_row.empty:
        last_detection = f"{last_row.iloc[0]['fecha']} {last_row.iloc[0]['hora']}"
    else:
        last_detection = None
    return jsonify({
        'total': int(total),
        'species_count': int(species_count),
        'cameras_active': int(cameras_active),
        'last_detection': last_detection
    })

@app.route('/api/detections')
def api_detections():
    # Parámetros opcionales: start=YYYY-MM-DD, end=YYYY-MM-DD, species=nombre
    start = request.args.get('start')
    end = request.args.get('end')
    species = request.args.get('species')

    df = get_df()
    if df.empty:
        return jsonify([])
    if start:
        df = df[df['fecha'] >= start]
    if end:
        df = df[df['fecha'] <= end]
    if species:
        df = df[df['especie'] == species]

    # Normalizar salida a lista de registros simples
    out = df[['fecha','hora','especie','lat','lon','camara','imagen']].to_dict(orient='records')
    return jsonify(out)

@app.route('/api/species')
def api_species():
    df = get_df()
    if df.empty:
        return jsonify([])
    return jsonify(sorted(df['especie'].dropna().unique().tolist()))

@app.route('/api/stream')
def stream():
    # SSE para cambios simples en CSV; cada vez que detecta un nuevo mtime envía un mensaje
    def gen():
        last_mtime = 0
        while True:
            try:
                mtime = os.path.getmtime(CSV_FILE)
            except Exception:
                mtime = 0
            if mtime != last_mtime:
                last_mtime = mtime
                # emitimos una señal simple; el cliente puede recargar datos
                data = json.dumps({'type':'update'})
                yield f"data: {data}\n\n"
            time.sleep(2)
    return Response(gen(), mimetype='text/event-stream')

# ================= MAIN =================
if __name__ == "__main__":
    # Ejecutar la aplicación Flask (escucha en todas las interfaces para acceso en la red local)
    app.run(debug=True, host="0.0.0.0", port=5000)