const SPECIES_COLORS = {
  "jaguar": '#FF5733',
  "rana_dorada": '#FFD700',
  "tapir": '#6C757D',
  "aguila_harpia": '#2E86C1'
};

let charts = {};
let table = null;
let map = null;
let markersLayer = null;
let live = false;
let evtSource = null;

function fmtSpeciesLabel(s){
  if(!s) return '';
  const map = { 'jaguar': 'Jaguar', 'rana_dorada': 'Rana Dorada', 'tapir': 'Tapir', 'aguila_harpia': 'Águila Harpía' };
  return map[s] || s;
}

async function fetchJSON(url){
  const res = await fetch(url);
  return await res.json();
}

async function loadSpecies(){
  try{
    const stats = await fetchJSON('/api/dashboard_stats');
    const select = document.getElementById('filterSpecies');
    Object.keys(stats || {}).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = fmtSpeciesLabel(s);
      select.appendChild(opt);
    });
  }catch(e){ console.warn('Error loading species', e); }
}

async function loadSummary(){
  try{
    const s = await fetchJSON('/api/summary');
    document.getElementById('kpiTotal').textContent = s.total || 0;
    document.getElementById('kpiSpecies').textContent = s.species_count || 0;
    document.getElementById('kpiCams').textContent = s.cameras_active || 0;
    document.getElementById('kpiLast').textContent = s.last_detection || '-';
  }catch(e){ console.warn('summary fetch failed', e); }
}

function buildCharts(data){
  const speciesCounts = {};
  const byDate = {};
  const byCamSpec = {};
  const hours = Array.from({length:24},()=>0);

  data.forEach(r => {
    const s = r.especie || 'unknown';
    speciesCounts[s] = (speciesCounts[s]||0)+1;

    const d = r.fecha || '';
    byDate[d] = byDate[d] || {}; byDate[d][s] = (byDate[d][s]||0)+1;

    const cam = r.camara || 'sin_cam';
    byCamSpec[cam] = byCamSpec[cam] || {}; byCamSpec[cam][s] = (byCamSpec[cam][s]||0)+1;

    const h = (r.hora || '00:00:00').split(':')[0];
    hours[parseInt(h,10)] += 1;
  });

  const labels = Object.keys(speciesCounts);
  const values = labels.map(l=>speciesCounts[l]);

  if(charts.barSpecies) charts.barSpecies.destroy();
  charts.barSpecies = new Chart(document.getElementById('barSpecies'), {
    type: 'bar', data: { labels, datasets:[{ label:'Avistamientos', data: values, backgroundColor: labels.map(l=>SPECIES_COLORS[l]||'#888') }] }, options:{responsive:true}
  });

  if(charts.donutSpecies) charts.donutSpecies.destroy();
  charts.donutSpecies = new Chart(document.getElementById('donutSpecies'), {
    type: 'doughnut', data: { labels, datasets:[{ data: values, backgroundColor: labels.map(l=>SPECIES_COLORS[l]||'#888') }] }, options:{responsive:true, cutout:'60%'}
  });

  const dateLabels = Object.keys(byDate).sort();
  const datasets = [];
  const speciesList = Array.from(new Set(data.map(r=>r.especie)));
  speciesList.forEach(s => {
    datasets.push({ label: fmtSpeciesLabel(s), data: dateLabels.map(d=>byDate[d][s]||0), borderColor: SPECIES_COLORS[s]||'#888', fill:false });
  });
  if(charts.lineTime) charts.lineTime.destroy();
  charts.lineTime = new Chart(document.getElementById('lineTime'), { type:'line', data:{ labels:dateLabels, datasets }, options:{responsive:true}
  });

  const camLabels = Object.keys(byCamSpec);
  const stackDatasets = speciesList.map(s => ({ label:fmtSpeciesLabel(s), data: camLabels.map(c=> byCamSpec[c][s]||0), backgroundColor: SPECIES_COLORS[s]||'#888' }));
  if(charts.stackedCam) charts.stackedCam.destroy();
  charts.stackedCam = new Chart(document.getElementById('stackedCam'), { type:'bar', data:{ labels:camLabels, datasets:stackDatasets }, options:{ responsive:true, plugins:{ legend:{ position:'bottom' }}, scales:{ x:{ stacked:true }, y:{ stacked:true } } } });

  if(charts.histHour) charts.histHour.destroy();
  charts.histHour = new Chart(document.getElementById('histHour'), { type:'bar', data:{ labels: hours.map((_,i)=>String(i)), datasets:[{ label:'Detecciones', data: hours, backgroundColor:'#6c757d' }] }, options:{responsive:true} });
}

function populateTable(data){
  const tbody = document.querySelector('#tableRecords tbody');
  tbody.innerHTML = '';
  data.slice().reverse().forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.fecha||''}</td>
      <td>${r.hora||''}</td>
      <td>${fmtSpeciesLabel(r.especie||'')}</td>
      <td>${r.lat||''}</td>
      <td>${r.lon||''}</td>
      <td>${r.camara||''}</td>
      <td><img src="/captures/${r.imagen}" class="table-img" data-img="/captures/${r.imagen}"/></td>
    `;
    tbody.appendChild(tr);
  });
  if(!table) table = $('#tableRecords').DataTable({ order:[[0,'desc']], pageLength: 10 });
  else { table.clear().destroy(); table = null; table = $('#tableRecords').DataTable({ order:[[0,'desc']], pageLength: 10 }); }

  // image click
  $('#tableRecords img.table-img').on('click', function(){ $('#modalImg').attr('src', $(this).data('img')); var m = new bootstrap.Modal(document.getElementById('imgModal')); m.show(); });
}

function updateMap(data){
  if(!map){
    map = L.map('map').setView([0,0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
  }
  markersLayer.clearLayers();
  data.forEach(r=>{
    const la = parseFloat(r.lat); const lo = parseFloat(r.lon);
    if(isNaN(la) || isNaN(lo)) return;
    const color = SPECIES_COLORS[r.especie]||'#666';
    const m = L.circleMarker([la,lo], { radius:6, color, fillColor:color, fillOpacity:0.8 }).bindPopup(`<b>${fmtSpeciesLabel(r.especie)}</b><br>${r.fecha} ${r.hora}<br>${r.camara}`);
    markersLayer.addLayer(m);
  });
  if(markersLayer.getLayers().length>0) map.fitBounds(markersLayer.getBounds(), { maxZoom: 13, padding:[40,40] });
}

async function loadAll(){
  const start = document.getElementById('startDate').value;
  const end = document.getElementById('endDate').value;
  const species = document.getElementById('filterSpecies').value;
  const q = new URLSearchParams();
  if(start) q.set('start', start);
  if(end) q.set('end', end);
  if(species) q.set('species', species);

  const data = await fetchJSON('/api/detections?' + q.toString());
  buildCharts(data);
  populateTable(data);
  updateMap(data);
  loadSummary();
}

function startLive(){
  if(evtSource) evtSource.close();
  evtSource = new EventSource('/api/stream');
  evtSource.onmessage = (e) => {
    try{
      const payload = JSON.parse(e.data);
      // payload could be {type:'new', record: {...}} or summary; simply reload for now
      loadAll();
    }catch(err){ console.warn(err); }
  };
}

function stopLive(){ if(evtSource){ evtSource.close(); evtSource = null; } }

document.addEventListener('DOMContentLoaded', async ()=>{
  await loadSpecies();
  await loadSummary();
  await loadAll();

  document.getElementById('applyFilters').addEventListener('click', loadAll);
  document.getElementById('resetFilters').addEventListener('click', ()=>{ document.getElementById('filterSpecies').value=''; document.getElementById('startDate').value=''; document.getElementById('endDate').value=''; loadAll(); });

  document.getElementById('toggleLive').addEventListener('click', (e)=>{
    live = !live; e.target.classList.toggle('btn-success', live); e.target.textContent = live ? 'Live: On' : 'Live';
    if(live) startLive(); else stopLive();
  });
});
