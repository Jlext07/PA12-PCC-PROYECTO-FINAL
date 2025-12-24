let map, markers = {};
let editingId = null;
let lastCams = null; // guarda el último JSON cargado para debug
// Indica si el mapa existe en el DOM y Leaflet está cargado
const MAP_ENABLED = (typeof document !== 'undefined' && document.getElementById('mapAdmin') !== null && typeof L !== 'undefined');

// Inicializar Mapa (no hace nada si no hay contenedor o Leaflet)
function initMap() {
    if (!MAP_ENABLED) return;
    map = L.map('mapAdmin', { zoomControl: true }).setView([9.0, -79.5], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    // Click en el mapa para capturar coordenadas
    map.on('click', (e) => {
        document.getElementById('lat').value = e.latlng.lat.toFixed(6);
        document.getElementById('lon').value = e.latlng.lng.toFixed(6);
    });

    // Evita que el mapa salga desfasado si el contenedor cambia de tamaño al cargar
    // (por ejemplo en Bootstrap). Pequeño timeout para permitir el layout.
    setTimeout(() => { try { map.invalidateSize(); } catch(e){} }, 200);
} 

// Cargar cámaras desde la API
async function loadCams() {
    const list = document.getElementById('camsList');
    const camCount = document.getElementById('camCount');
    const camsEmpty = document.getElementById('camsEmpty');
    const camsError = document.getElementById('camsError');

    camsError.style.display = 'none';
    camsEmpty.style.display = 'none';

    let res;
    try {
        res = await fetch('/api/camaras');
    } catch (e) {
        camsError.textContent = 'Error de red al cargar cámaras: ' + e;
        camsError.style.display = 'block';
        list.innerHTML = '';
        camCount.textContent = '(0)';
        return;
    }

    if (!res.ok) {
        camsError.textContent = `Error ${res.status} al cargar cámaras`;
        camsError.style.display = 'block';
        list.innerHTML = '';
        camCount.textContent = '(0)';
        return;
    }

    const cams = await res.json();
    lastCams = cams;
    list.innerHTML = "";
    // hide raw JSON area if visible until user toggles
    const rawArea = document.getElementById('rawJsonArea');
    if (rawArea) rawArea.style.display = 'none';

    // Limpiar marcadores previos sólo si el mapa está habilitado
    if (MAP_ENABLED) {
        Object.values(markers).forEach(m => { try { map.removeLayer(m); } catch(e){} });
        markers = {};
    }

    const latlngs = [];

    Object.entries(cams).forEach(([id, cam]) => {
        // Añadir a la lista visual
        const item = document.createElement('div');
        item.className = "list-group-item d-flex justify-content-between align-items-center";
        item.innerHTML = `
            <div>
                <strong>${cam.nombre || ('Cam ' + id)}</strong> <small class="text-muted">ID: ${id}</small><br>
                <small>Device: ${cam.device ?? ''} | Lat: ${cam.lat ?? ''}</small>
            </div>
            <div class="btn-group">
              <button class="btn btn-sm btn-info" onclick="editCam('${id}')">Editar</button>
              <button class="btn btn-sm btn-danger" onclick="deleteCam('${id}')">Eliminar</button>
            </div>
        `;
        list.appendChild(item);

        // Añadir marcador al mapa (si está habilitado) y parseo seguro de coordenadas
        if (MAP_ENABLED && cam.lat !== undefined && cam.lon !== undefined && cam.lat !== null && cam.lon !== null && cam.lat !== "" && cam.lon !== "") {
            const lat = parseFloat(cam.lat);
            const lon = parseFloat(cam.lon);
            if (!isNaN(lat) && !isNaN(lon)) {
                const m = L.marker([lat, lon]).addTo(map).bindPopup(cam.nombre);
                markers[id] = m;
                latlngs.push([lat, lon]);
            }
        }
    });

    // Actualizar contador y empty state
    const count = Object.keys(cams).length;
    camCount.textContent = `(${count})`;
    if (count === 0) {
        camsEmpty.style.display = 'block';
    }

    // Si el área de JSON está visible, actualizar su contenido
    if (rawArea && rawArea.style.display !== 'none') {
        rawArea.textContent = JSON.stringify(lastCams, null, 2);
    }

    // Rellenar la lista simple de cámaras (nombres visibles con botón borrar)
    const simple = document.getElementById('camsSimpleList');
    if (simple) {
        simple.innerHTML = '';
        Object.entries(cams).forEach(([id, cam]) => {
            const name = cam.nombre || (`Cam ${id}`);
            const btn = document.createElement('div');
            btn.className = 'badge bg-secondary d-inline-flex align-items-center gap-2 p-2';
            btn.style.cursor = 'default';
            btn.innerHTML = `
                <span>${name}</span>
                <button class='btn btn-sm btn-outline-light btn-danger ms-2' title='Eliminar ${name}' data-id='${id}'>Eliminar</button>
            `.trim();
            // Attach handler
            const del = btn.querySelector('button');
            if (del) del.addEventListener('click', (e) => { e.stopPropagation(); deleteCam(id); });
            simple.appendChild(btn);
        });
    }

    // Ajustar vista para encuadrar todas las cámaras si hay marcadores y el mapa está habilitado
    if (MAP_ENABLED) {
        try {
            if (latlngs.length > 0) {
                const bounds = L.latLngBounds(latlngs);
                map.invalidateSize();
                map.fitBounds(bounds.pad ? bounds.pad(0.2) : bounds, { padding: [20,20] });
            } else {
                // Forzar refresh de tamaño aunque no haya marcadores
                map.invalidateSize();
            }
        } catch (e) {
            console.error('Error ajustando bounds del mapa:', e);
        }
    }
}

// Llenar formulario para editar
async function editCam(id) {
    const res = await fetch('/api/camaras');
    const cams = await res.json();
    const cam = cams[id];
    
    editingId = id;
    document.getElementById('editingId').value = id;
    document.getElementById('nombre').value = cam.nombre;
    document.getElementById('lat').value = cam.lat;
    document.getElementById('lon').value = cam.lon;
    document.getElementById('device').value = cam.device;
    document.getElementById('saveBtn').textContent = "Actualizar Cámara";

    // Si la cámara tiene coordenadas y el mapa está habilitado, centramos el mapa en ella para edición
    if (MAP_ENABLED && cam && cam.lat !== undefined && cam.lon !== undefined && cam.lat !== null && cam.lon !== null && cam.lat !== "" && cam.lon !== "") {
        const lat = parseFloat(cam.lat);
        const lon = parseFloat(cam.lon);
        if (!isNaN(lat) && !isNaN(lon)) {
            try { map.setView([lat, lon], 13); } catch(e) {}
            // Abrir popup del marcador si exista
            if (markers[id]) try { markers[id].openPopup(); } catch(e) {}
        }
    }
}

// Eliminar cámara (llama a la API y recarga la lista)
async function deleteCam(id) {
    if (!confirm('¿Eliminar esta cámara? Esta acción no se puede deshacer.')) return;
    try {
        const res = await fetch(`/api/camaras/${id}/delete`, { method: 'POST' });
        const js = await res.json();
        if (res.ok && js.success) {
            alert('Cámara eliminada');
            resetForm();
            loadCams();
        } else {
            alert('Error eliminando cámara: ' + (js.error || 'unknown'));
        }
    } catch (e) {
        alert('Error: ' + e);
    }
}

// Guardar/Actualizar (Envío a una nueva ruta de API)
document.getElementById('camForm').onsubmit = async (e) => {
    e.preventDefault();
    const data = {
        id: document.getElementById('editingId').value,
        nombre: document.getElementById('nombre').value,
        lat: parseFloat(document.getElementById('lat').value),
        lon: parseFloat(document.getElementById('lon').value),
        device: parseInt(document.getElementById('device').value)
    };

    const res = await fetch('/api/guardar_camara', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });

    if (res.ok) {
        resetForm();
        loadCams();
    }
};

function resetForm() {
    editingId = null;
    document.getElementById('camForm').reset();
    document.getElementById('editingId').value = "";
    document.getElementById('saveBtn').textContent = "Guardar";
}

document.getElementById('cancelBtn').onclick = resetForm;

// Inicio
if (MAP_ENABLED) initMap();
loadCams();

// Hook para el botón 'Actualizar' (si existe)
const refreshBtn = document.getElementById('refreshCamsBtn');
if (refreshBtn) refreshBtn.addEventListener('click', () => { loadCams(); refreshBtn.disabled = true; setTimeout(()=>refreshBtn.disabled=false, 800); });

// Hook: eliminar por ID manual
const deleteByIdBtn = document.getElementById('deleteByIdBtn');
if (deleteByIdBtn) deleteByIdBtn.addEventListener('click', () => {
    const val = document.getElementById('deleteByIdInput').value.trim();
    if (!val) { alert('Ingresa un ID de cámara'); return; }
    deleteCam(val);
});

// Hook: mostrar JSON crudo
const showRawBtn = document.getElementById('showRawBtn');
const rawArea = document.getElementById('rawJsonArea');
if (showRawBtn) showRawBtn.addEventListener('click', () => {
    if (!rawArea) return;
    if (rawArea.style.display === 'none') {
        rawArea.style.display = 'block';
        rawArea.textContent = JSON.stringify(lastCams, null, 2);
        showRawBtn.textContent = 'Ocultar JSON';
    } else {
        rawArea.style.display = 'none';
        showRawBtn.textContent = 'Ver JSON';
    }
});