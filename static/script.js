// script.js — index page behavior: load cameras, map, last 5 records, stream selection

let CAMERAS = {}; // será rellenado desde API al cargar
let CURRENT_CAM_KEY = null;

async function loadCameras() {
  try {
    const res = await fetch('/api/camaras');
    const cams = await res.json();
    CAMERAS = cams;
    populateCameraList(cams);
    populateSelect(cams);
    populateQuickButtons(cams);
    addMapMarkers(cams);
  } catch (e) {
    console.error("No se pudieron cargar cámaras:", e);
  }
}

function populateQuickButtons(cams) {
  const container = document.getElementById('cameraQuickButtons');
  if (!container) return;
  container.innerHTML = '';
  for (const [id, cam] of Object.entries(cams)) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-outline-light';
    btn.dataset.cam = id;
    btn.textContent = `${cam.nombre || `Cam ${id}`} (dev:${cam.device ?? id})`;
    btn.onclick = () => setVideoSource(id);
    container.appendChild(btn);
  }
}

function populateCameraList(cams) {
  const container = document.getElementById('cameraList');
  container.innerHTML = '';
  for (const [id, cam] of Object.entries(cams)) {
    const wrapper = document.createElement('div');
    wrapper.className = 'd-flex align-items-center justify-content-between mb-1';

    const btn = document.createElement('button');
    btn.className = 'list-group-item list-group-item-action camera-btn flex-grow-1';
    btn.dataset.cam = id;
    btn.textContent = `${cam.nombre} (ID ${id})`;
    btn.onclick = () => setVideoSource(id);

    const gear = document.createElement('button');
    gear.className = 'btn btn-sm btn-outline-secondary ms-2';
    gear.textContent = '⚙';
    gear.title = 'Asignar dispositivo';
    gear.onclick = (e) => {
      e.stopPropagation();
      const current = cam.device ?? id;
      const d = prompt(`Ingrese el índice de dispositivo para ${cam.nombre}:`, current);
      if (d === null) return;
      const deviceNum = parseInt(d);
      if (isNaN(deviceNum)) { alert('Índice inválido'); return; }
      // send to API
      fetch(`/api/camaras/${id}/set_device`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ device: deviceNum }) })
        .then(r => r.json())
        .then(js => {
          if (js.success) {
            CAMERAS[id].device = deviceNum;
            // update selects and quick buttons
            populateSelect(CAMERAS);
            populateQuickButtons(CAMERAS);
            alert('Dispositivo asignado correctamente');
          } else {
            alert('Error: ' + (js.error||'')); 
          }
        }).catch(err => { alert('Error: ' + err); });
    };

    wrapper.appendChild(btn);
    wrapper.appendChild(gear);
    container.appendChild(wrapper);
  }
}

function populateSelect(cams) {
  const sel = document.getElementById('selectCam');
  sel.innerHTML = '';
  for (const [id, cam] of Object.entries(cams)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `Cam ${id} — ${cam.nombre}`;
    sel.appendChild(opt);
  }
}

// MAP (Leaflet)
const map = L.map('map', { zoomControl: true, attributionControl: false }).setView([8.98, -79.52], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
const markers = {};

function addMapMarkers(cams) {
  // limpiar markers previos
  for (const m of Object.values(markers)) map.removeLayer(m);
  Object.keys(markers).forEach(k => delete markers[k]);

  for (const [id, cam] of Object.entries(cams)) {
    const marker = L.marker([cam.lat, cam.lon]).addTo(map);
    marker.bindPopup(`<b>${cam.nombre}</b><br>ID: ${id}<br><button class="btn btn-sm btn-primary" onclick="setVideoSource(${id})">Ver cámara</button>`);
    markers[id] = marker;
  }
}

// cambiar fuente del <img> para el stream
function setVideoSource(camId) {
  const video = document.getElementById('videoFeed');
  const spinner = document.getElementById('videoSpinner');
  if (spinner) spinner.style.display = 'block';
  // attach one-time listeners
  const onLoad = () => {
    if (spinner) spinner.style.display = 'none';
    video.removeEventListener('load', onLoad);
  };
  const onError = () => {
    if (spinner) spinner.style.display = 'none';
    // reattempt after short delay
    setTimeout(() => setVideoSource(camId), 2000);
    video.removeEventListener('error', onError);
  };
  video.addEventListener('load', onLoad);
  video.addEventListener('error', onError);
  // If camId matches a camera key, use the mapped device endpoint
  if (CAMERAS && CAMERAS[camId]) {
    video.src = `/video_feed_cam/${camId}`;
    CURRENT_CAM_KEY = camId;
  } else {
    video.src = `/video_feed/${camId}`;
    CURRENT_CAM_KEY = null;
  }
  const sel = document.getElementById('selectCam');
  if (sel) sel.value = camId;

  // Show camera name in title overlay
  const titleEl = document.getElementById('videoTitle');
  if (titleEl && CAMERAS && CAMERAS[camId]) titleEl.textContent = CAMERAS[camId].nombre || `Cam ${camId}`;
  else if (titleEl) titleEl.textContent = `Cam ${camId}`;
  updateQuickButtonsActive();
}

function updateQuickButtonsActive() {
  const container = document.getElementById('cameraQuickButtons');
  if (!container) return;
  for (const btn of container.children) {
    const id = btn.dataset ? btn.dataset.cam : btn.getAttribute('data-cam');
    if (!id) continue;
    if (String(id) === String(CURRENT_CAM_KEY)) {
      btn.classList.remove('btn-outline-light');
      btn.classList.add('btn-primary');
      btn.classList.add('text-white');
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.remove('text-white');
      btn.classList.add('btn-outline-light');
    }
  }
}

// Últimos 5 registros
async function loadLastFive() {
  try {
    const res = await fetch('/api/ultimos_registros');
    const data = await res.json();
    const tbody = document.querySelector('#lastRecordsTable tbody');
    tbody.innerHTML = '';
    data.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.camara}</td><td>${r.fecha}</td><td>${r.hora}</td><td>${r.especie}</td><td>${r.confianza}</td>`;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error('Error cargando últimos registros', e);
  }
}

document.getElementById('btnSelect').addEventListener('click', () => {
  const cam = document.getElementById('selectCam').value || '0';
  setVideoSource(cam);
});

document.getElementById('btnViewAll').addEventListener('click', () => {
  window.location.href = '/registros';
});

// inicializar todo
window.addEventListener('load', async () => {
  await loadCameras();
  await loadLastFive();
  // Actualizar últimos registros cada 10 segundos
  setInterval(loadLastFive, 10000);
  // Set default camera title until user selects one
  const titleEl = document.getElementById('videoTitle');
  if (titleEl) titleEl.textContent = 'Sin cámara seleccionada';
  // Remove detect button if it exists
  const detectBtn = document.getElementById('btnDetectDevices');
  if (detectBtn) detectBtn.remove();
  // Auto-select first camera if exists
  const firstCam = Object.keys(CAMERAS)[0];
  if (firstCam) setVideoSource(firstCam);
});
