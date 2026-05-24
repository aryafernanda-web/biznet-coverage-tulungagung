/* =========================================================
   Coverage Checker – Biznet Tulungagung
   =========================================================
   - Load KML dari Google Maps
   - Bangun graph jalur kabel
   - Dijkstra cari jarak DP terdekat
   - ≤350m = COVERED, >350m = NOT COVERED
   - Blokir rute yang melintasi jalur kereta
   - Fallback ke OSRM jika tidak ada jalur kabel
   ========================================================= */

'use strict';

/* ----- CONSTANTS ----- */
const OSRM_PROFILES = [
  'https://router.project-osrm.org/route/v1/driving/',
  'https://router.project-osrm.org/route/v1/walking/',
  'https://routing.openstreetmap.de/routed-foot/route/v1/foot/'
];
const OSRM_TABLE_PROFILES = [
  'https://router.project-osrm.org/table/v1/driving/',
  'https://router.project-osrm.org/table/v1/walking/'
];
const COVER_DIST = 350; // meter (jarak dihitung sepanjang jaringan kabel)
const MAX_RESULTS = 12;
const CANDIDATE_POOL = 50; // DP yang diperiksa jarak jalan
const SNAP_RADIUS = 1200; // meter – snap lokasi & DP ke jaringan kabel
const USER_SNAP_COUNT = 6; // node kabel terdekat untuk titik pengguna
const DP_SNAP_COUNT = 5;
const OSRM_SNAP_RADIUS = 500; // snap ke jalan (OSM jarang di pedesaan)
const graphEdgeGeom = {}; // 'idA-idB' -> [{lat,lng}, ...] geometri kabel asli
const osrmRouteCache = new Map();
const CENTER      = [-8.079, 111.903]; // Tulungagung

/* ----- RAILWAY LINES (Sekitar Tulungagung) ----- */
const RAILWAY_LINES = [
    [[-8.0831442, 111.9465484], [-8.0831680, 111.9466184], [-8.0847274, 111.9512268], [-8.0862327, 111.9556148], [-8.0886551, 111.9628304], [-8.0899535, 111.9665811], [-8.0918455, 111.9721168], [-8.0924857, 111.9740007], [-8.0940638, 111.9785766], [-8.0975537, 111.9889311], [-8.0980369, 111.9903197], [-8.0985029, 111.9916858], [-8.0997983, 111.9954835], [-8.1006443, 111.9979637], [-8.1018630, 112.0015388], [-8.1023405, 112.0029490], [-8.1026367, 112.0038322], [-8.1027787, 112.0043119], [-8.1028929, 112.0047769], [-8.1029909, 112.0052372], [-8.1030674, 112.0058053], [-8.1030976, 112.0063968], [-8.1030963, 112.0070344], [-8.1030376, 112.0085318], [-8.1029909, 112.0095990]],
    [[-8.0164013, 111.9237641], [-8.0171978, 111.9233341]],
    [[-7.9878641, 111.9393123], [-7.9903126, 111.9379734], [-7.9963352, 111.9347067], [-7.9983332, 111.9336161], [-8.0053474, 111.9297817], [-8.0084859, 111.9280709]],
    [[-8.0678507, 111.9054166], [-8.0679064, 111.9054475]],
    [[-8.0437779, 111.9088088], [-8.0477600, 111.9066374], [-8.0486842, 111.9061311], [-8.0493335, 111.9057764], [-8.0506870, 111.9050291], [-8.0511979, 111.9047883], [-8.0517862, 111.9045618], [-8.0524107, 111.9043515], [-8.0531632, 111.9041875], [-8.0532412, 111.9041730], [-8.0537003, 111.9040993], [-8.0541318, 111.9040525], [-8.0550223, 111.9040287], [-8.0559877, 111.9040840], [-8.0601423, 111.9044105], [-8.0605921, 111.9044463]],
    [[-8.0084859, 111.9280709], [-8.0088023, 111.9279374], [-8.0090547, 111.9278139], [-8.0099802, 111.9273012], [-8.0110651, 111.9267107], [-8.0118781, 111.9262680], [-8.0122156, 111.9260411]],
    [[-8.0615841, 111.9045940], [-8.0620389, 111.9046326], [-8.0625672, 111.9046696], [-8.0633969, 111.9047295], [-8.0640866, 111.9047826]],
    [[-8.0615841, 111.9045940], [-8.0619066, 111.9046486], [-8.0620269, 111.9046715], [-8.0625611, 111.9047122], [-8.0633910, 111.9047750], [-8.0637677, 111.9047968], [-8.0638870, 111.9047947], [-8.0640866, 111.9047826]],
    [[-8.0679064, 111.9054475], [-8.0682078, 111.9056272], [-8.0683898, 111.9057546], [-8.0685823, 111.9059001], [-8.0689162, 111.9062173], [-8.0692137, 111.9065619], [-8.0695065, 111.9069763], [-8.0697273, 111.9073551], [-8.0699088, 111.9077682]],
    [[-8.0699088, 111.9077682], [-8.0721759, 111.9144533], [-8.0739143, 111.9194966], [-8.0746467, 111.9216526], [-8.0747047, 111.9218429], [-8.0747519, 111.9219851], [-8.0754691, 111.9240726]],
    [[-8.0754691, 111.9240726], [-8.0754933, 111.9241503]],
    [[-8.0654077, 111.9048239], [-8.0655466, 111.9048347], [-8.0662746, 111.9049000], [-8.0666572, 111.9049627], [-8.0670241, 111.9050539], [-8.0672897, 111.9051450], [-8.0675658, 111.9052671], [-8.0678507, 111.9054166]],
    [[-8.0171978, 111.9233341], [-8.0199312, 111.9218311], [-8.0260071, 111.9185037], [-8.0287437, 111.9170381], [-8.0310547, 111.9157574], [-8.0324310, 111.9150098]],
    [[-8.0324310, 111.9150098], [-8.0324839, 111.9149806]],
    [[-8.0831442, 111.9465484], [-8.0829707, 111.9461654], [-8.0829093, 111.9459990], [-8.0826585, 111.9452700], [-8.0822679, 111.9441346], [-8.0820491, 111.9434986], [-8.0819650, 111.9432296], [-8.0818438, 111.9427886]],
    [[-8.0122156, 111.9260411], [-8.0126037, 111.9258299], [-8.0130287, 111.9256066], [-8.0164013, 111.9237641]],
    [[-8.0084859, 111.9280709], [-8.0104770, 111.9269761], [-8.0122156, 111.9260411]],
    [[-8.0324839, 111.9149806], [-8.0328506, 111.9147768], [-8.0344437, 111.9139215], [-8.0378321, 111.9120662], [-8.0389008, 111.9114395], [-8.0397227, 111.9110122], [-8.0411605, 111.9102364], [-8.0437258, 111.9088373]],
    [[-8.0437258, 111.9088373], [-8.0437779, 111.9088088]],
    [[-8.0605921, 111.9044463], [-8.0625633, 111.9046015], [-8.0635263, 111.9046683], [-8.0648576, 111.9047811]],
    [[-8.0640866, 111.9047826], [-8.0648576, 111.9047811]],
    [[-8.0605921, 111.9044463], [-8.0615841, 111.9045940]],
    [[-8.0648576, 111.9047811], [-8.0654077, 111.9048239]],
    [[-8.0754933, 111.9241503], [-8.0761593, 111.9261603], [-8.0780575, 111.9317052], [-8.0801228, 111.9377765], [-8.0814060, 111.9415173], [-8.0815002, 111.9417882], [-8.0818438, 111.9427886]],
    [[-8.0818438, 111.9427886], [-8.0823046, 111.9441181], [-8.0826978, 111.9452568], [-8.0831442, 111.9465484]]
];

/* =========================================================
   GLOBAL STATE
   ========================================================= */
let map;
let dpLayer, kabelLayer, railwayLayer, riverLayer, routeLayer, userMarker;
let dpPoints    = [];   // {id, name, desc, lat, lng}
let cableSegs   = [];   // [[{lat,lng},...], ...]
let graphNodes  = [];   // {lat, lng, id}
let graphEdges  = {};   // id -> [{toId, dist}]
let userLatLng  = null;
let userLocationMarker = null;
let userLocationCircle = null;

/* Locks to prevent race conditions */
let analyzeToken = 0;
let isDrawingRoute = false;

/* Measurement state */
let isMeasuring = false;
let measurePoints = [];
let measureLayer = null;
let measureDistance = 0;

/* =========================================================
   INIT
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initSidebar();
  loadKML();
  if (location.protocol === 'file:') {
    setTimeout(() => {
      showToast('Gunakan Live Server (bukan file://) agar rute jalan OSRM berfungsi.', 6000);
    }, 1500);
  }
});

/* ----- MAP ----- */
function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true });

  const TILE_URL = 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';
  const TILE_ATTR = '&copy; Google Maps';

  L.tileLayer(TILE_URL, {
    attribution: TILE_ATTR,
    maxZoom: 20
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.setView(CENTER, 15);

  /* Layer groups */
  dpLayer      = L.layerGroup().addTo(map);
  kabelLayer   = L.layerGroup().addTo(map);
  railwayLayer = L.layerGroup().addTo(map);
  riverLayer   = L.layerGroup().addTo(map);
  routeLayer   = L.layerGroup().addTo(map);
  measureLayer = L.layerGroup().addTo(map);

  /* Klik peta → pilih lokasi */
  map.on('click', e => onMapClick(e.latlng));

  /* Blokir Railway & Rivers */
  drawRailway();
  if (typeof RIVER_LINES !== 'undefined') drawRiver();
}

/* ----- SIDEBAR ----- */
function initSidebar() {
  /* Search */
  document.getElementById('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });
  document.getElementById('searchBtn').addEventListener('click', doSearch);

  /* GPS */
  const gpsBtn = document.getElementById('gpsBtn');
  gpsBtn.addEventListener('click', () => {
    if ("geolocation" in navigator) {
      gpsBtn.disabled = true;
      const originalText = gpsBtn.innerHTML;
      gpsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mencari...';
      
      navigator.geolocation.getCurrentPosition(pos => {
        const { latitude, longitude, accuracy } = pos.coords;
        const latlng = [latitude, longitude];
        
        // Remove old marker
        if (userLocationMarker) map.removeLayer(userLocationMarker);
        if (userLocationCircle) map.removeLayer(userLocationCircle);
        
        // Create blue dot marker
        userLocationCircle = L.circle(latlng, { radius: accuracy, color: '#3b82f6', fillOpacity: 0.15, weight: 1 }).addTo(map);
        userLocationMarker = L.circleMarker(latlng, {
          radius: 8,
          fillColor: '#3b82f6',
          color: '#fff',
          weight: 3,
          fillOpacity: 1
        }).addTo(map).bindPopup("Lokasi Anda").openPopup();
        
        map.setView(latlng, 16);
        onMapClick({ lat: latitude, lng: longitude });
        
        gpsBtn.disabled = false;
        gpsBtn.innerHTML = originalText;
      }, err => {
        gpsBtn.disabled = false;
        gpsBtn.innerHTML = originalText;
        alert("Error GPS: " + err.message);
      }, { enableHighAccuracy: true });
    }
  });

  /* Layer toggles */
  document.getElementById('togDP').addEventListener('change', e =>
    e.target.checked ? dpLayer.addTo(map) : map.removeLayer(dpLayer));
  document.getElementById('togKabel').addEventListener('change', e =>
    e.target.checked ? kabelLayer.addTo(map) : map.removeLayer(kabelLayer));
  document.getElementById('togRailway').addEventListener('change', e =>
    e.target.checked ? railwayLayer.addTo(map) : map.removeLayer(railwayLayer));
  if (document.getElementById('togRiver')) {
    document.getElementById('togRiver').addEventListener('change', e =>
      e.target.checked ? riverLayer.addTo(map) : map.removeLayer(riverLayer));
  }
  document.getElementById('togRoute').addEventListener('change', e =>
    e.target.checked ? routeLayer.addTo(map) : map.removeLayer(routeLayer));

  /* Mobile sidebar toggle */
  document.getElementById('sidebarToggle').addEventListener('click', () =>
    document.getElementById('sidebar').classList.toggle('open'));

  /* Measure Tool Toggle */
  const measureBtn = document.getElementById('measureBtn');
  if (measureBtn) {
    measureBtn.addEventListener('click', () => {
      isMeasuring = !isMeasuring;
      if (isMeasuring) {
        measureBtn.classList.add('active');
        showToast("Mode Ukur Aktif. Klik pada peta untuk membuat titik ukur.");
        document.getElementById('map').style.cursor = 'crosshair';
      } else {
        measureBtn.classList.remove('active');
        showToast("Mode Ukur Nonaktif.");
        document.getElementById('map').style.cursor = '';
        measureLayer.clearLayers();
        measurePoints = [];
        measureDistance = 0;
      }
    });
  }

  /* Toast helper */
  window.showToast = (msg, duration = 3000) => {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.style = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(32,33,36,0.9);color:#fff;padding:8px 16px;border-radius:24px;font-size:13px;z-index:9999;box-shadow:0 2px 5px rgba(0,0,0,0.3);transition:opacity 0.3s;pointer-events:none;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => t.style.opacity = '0', duration);
  };
}

/* =========================================================
   LOAD & PARSE KML
   ========================================================= */
async function loadKML() {
  showLoading(true);
  console.log('Using static KML data...');

  try {
    if (typeof KML_DP_POINTS === 'undefined' || typeof KML_CABLE_SEGS === 'undefined') {
      throw new Error('Static data (data.js) not found or not loaded.');
    }

    dpPoints = KML_DP_POINTS;
    cableSegs = KML_CABLE_SEGS.map(s => Array.isArray(s) ? s : (s.value || []));

    console.log(`Loaded: ${dpPoints.length} DP, ${cableSegs.length} cable segments`);

    buildGraph();
    renderDP();
    renderKabel();

    showLoading(false);
    hideMsgAfter();
  } catch (err) {
    console.error('Error loading static data:', err.message);
    showLoading(false);
    showLoadError();
  }
}

/* Add click handler for any DP */
async function selectSpecificDP(dp) {
  if (!userLatLng) {
    showToast('Klik lokasi Anda di peta terlebih dahulu.');
    return;
  }
  const results = await analyzeLocation(userLatLng.lat, userLatLng.lng, dp);
  if (results.length > 0) {
    renderResults(results, userLatLng);
  } else {
    showToast('Gagal menghitung rute ke DP ini.');
  }
}

/* =========================================================
   GRAPH BUILD (jalur kabel sebagai graph berbobot)
   ========================================================= */
function edgeGeomKey(aId, bId) {
  return aId < bId ? `${aId}-${bId}` : `${bId}-${aId}`;
}

function storeEdgeGeom(aId, bId, points) {
  const key = edgeGeomKey(aId, bId);
  const existing = graphEdgeGeom[key];
  if (!existing || points.length > existing.length) {
    graphEdgeGeom[key] = points;
  }
}

function buildGraph() {
  graphNodes = [];
  graphEdges = {};
  Object.keys(graphEdgeGeom).forEach(k => delete graphEdgeGeom[k]);

  const nodeMap = {}; // "lat,lng" -> nodeId

  function getOrAdd(lat, lng) {
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (nodeMap[key] === undefined) {
      const id = graphNodes.length;
      graphNodes.push({ id, lat, lng });
      graphEdges[id] = [];
      nodeMap[key] = id;
    }
    return nodeMap[key];
  }

  /* Tambahkan DP sebagai node */
  dpPoints.forEach(dp => {
    const id = getOrAdd(dp.lat, dp.lng);
    dp.nodeId = id;
  });

  /* Tambahkan node dan edge dari kabel */
  cableSegs.forEach(seg => {
    for (let i = 0; i < seg.length - 1; i++) {
      const a  = seg[i], b = seg[i + 1];
      const aId = getOrAdd(a.lat, a.lng);
      const bId = getOrAdd(b.lat, b.lng);
      const d   = haversine(a.lat, a.lng, b.lat, b.lng);

      /* Cek apakah edge ini melintasi jalur kereta */
      const crossRail = segmentCrossesRailway(a, b);

      storeEdgeGeom(aId, bId, [a, b]);
      graphEdges[aId].push({ toId: bId, dist: d, crossRail });
      graphEdges[bId].push({ toId: aId, dist: d, crossRail });
    }
  });

  /* Hubungkan DP ke beberapa node kabel terdekat (≤SNAP_RADIUS) agar tidak terputus */
  dpPoints.forEach(dp => {
    const nearby = graphNodes
      .filter(n => n.id !== dp.nodeId)
      .map(n => ({ id: n.id, dist: haversine(dp.lat, dp.lng, n.lat, n.lng), n }))
      .filter(x => x.dist <= SNAP_RADIUS)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, DP_SNAP_COUNT);

    nearby.forEach(({ id: bestId, dist: bestDist, n }) => {
      const crossRail = segmentCrossesRailway(dp, n);
      const weight = bestDist * 2.0;
      graphEdges[dp.nodeId].push({ toId: bestId, dist: weight, crossRail, type: 'snap' });
      graphEdges[bestId].push({ toId: dp.nodeId, dist: weight, crossRail, type: 'snap' });
    });
  });

  console.log(`Graph: ${graphNodes.length} nodes, ${Object.values(graphEdges).flat().length} edges`);
}

/* =========================================================
   DIJKSTRA
   ========================================================= */
function dijkstra(startId, blockRailway = true) {
  const dist = {}, prev = {}, visited = new Set();
  graphNodes.forEach(n => { dist[n.id] = Infinity; prev[n.id] = null; });
  dist[startId] = 0;

  const pq = [[0, startId]]; // [dist, id]

  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [d, u] = pq.shift();
    if (visited.has(u)) continue;
    visited.add(u);

    for (const edge of (graphEdges[u] || [])) {
      if (blockRailway && edge.crossRail) continue; // blokir kereta
      const nd = d + edge.dist;
      if (nd < dist[edge.toId]) {
        dist[edge.toId] = nd;
        prev[edge.toId] = u;
        pq.push([nd, edge.toId]);
      }
    }
  }

  return { dist, prev };
}

function reconstructPath(prev, targetId) {
  const path = [];
  let cur = targetId;
  while (cur !== null) {
    path.unshift(cur);
    cur = prev[cur];
  }
  return path;
}

/* =========================================================
   SNAP LOCATION → NEAREST CABLE NODE
   ========================================================= */
function snapToGraph(lat, lng, maxRadius = Infinity) {
  const snaps = nearestGraphSnaps(lat, lng, 1, maxRadius);
  if (!snaps.length) return { id: -1, dist: Infinity };
  return snaps[0];
}

function nearestGraphSnaps(lat, lng, limit, maxRadius = SNAP_RADIUS) {
  return graphNodes
    .map(n => ({ id: n.id, dist: haversine(lat, lng, n.lat, n.lng), lat: n.lat, lng: n.lng }))
    .filter(x => x.dist <= maxRadius)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);
}

function cableReachFromUser(lat, lng, dpNodeId) {
  const snaps = nearestGraphSnaps(lat, lng, USER_SNAP_COUNT);
  if (!snaps.length) return { cableDist: null, pathNodes: [] };

  let best = Infinity;
  let bestPath = [];

  for (const snap of snaps) {
    const { dist, prev } = dijkstra(snap.id);
    const onNet = dist[dpNodeId];
    if (!isFinite(onNet)) continue;
    const total = snap.dist + onNet;
    if (total < best) {
      best = total;
      bestPath = reconstructPath(prev, dpNodeId);
    }
  }

  if (!isFinite(best)) return { cableDist: null, pathNodes: [] };
  return { cableDist: best, pathNodes: bestPath };
}

function pathCrossesBlocked(pathCoords) {
  if (!pathCoords || pathCoords.length < 2) return false;
  for (let i = 0; i < pathCoords.length - 1; i++) {
    const a = { lat: pathCoords[i][0], lng: pathCoords[i][1] };
    const b = { lat: pathCoords[i + 1][0], lng: pathCoords[i + 1][1] };
    if (segmentCrossesRailway(a, b)) return true;
  }
  return false;
}

function getEdgeGeometry(fromId, toId) {
  const geom = graphEdgeGeom[edgeGeomKey(fromId, toId)];
  if (!geom || geom.length < 2) return null;
  const fwd = graphNodes[fromId];
  const rev = [...geom].reverse();
  const dFwd = haversine(fwd.lat, fwd.lng, geom[0].lat, geom[0].lng);
  const dRev = haversine(fwd.lat, fwd.lng, rev[0].lat, rev[0].lng);
  return dFwd <= dRev ? geom : rev;
}

function routeAlongCableGeometry(pathNodeIds, userLL, dp) {
  const coords = [];
  const pushPt = (lat, lng) => {
    if (!coords.length) {
      coords.push([lat, lng]);
      return;
    }
    const last = coords[coords.length - 1];
    if (haversine(last[0], last[1], lat, lng) > 2) coords.push([lat, lng]);
  };

  pushPt(userLL.lat, userLL.lng);

  for (let i = 0; i < pathNodeIds.length - 1; i++) {
    const fromId = pathNodeIds[i];
    const toId = pathNodeIds[i + 1];
    const geom = getEdgeGeometry(fromId, toId);
    if (geom) {
      geom.forEach(p => pushPt(p.lat, p.lng));
    } else {
      const n = graphNodes[toId];
      if (n) pushPt(n.lat, n.lng);
    }
  }

  pushPt(dp.lat, dp.lng);
  return coords.length >= 2 ? coords : null;
}

function effectiveRankingDist(r) {
  if (r.roadDist != null && isFinite(r.roadDist)) return r.roadDist;
  if (r.cableDist != null && isFinite(r.cableDist)) return r.cableDist;
  return r.straightDist;
}

function coverageDistance(r) {
  if (r.cableDist != null && isFinite(r.cableDist)) return r.cableDist;
  if (r.roadDist != null && isFinite(r.roadDist)) return r.roadDist;
  return r.straightDist;
}

/* =========================================================
   ON MAP CLICK & MEASURE
   ========================================================= */
function handleMeasureClick(latlng) {
  measurePoints.push(latlng);
  
  if (measurePoints.length > 1) {
    const prev = measurePoints[measurePoints.length - 2];
    const dist = haversine(prev.lat, prev.lng, latlng.lat, latlng.lng);
    measureDistance += dist;
    
    L.polyline([prev, latlng], { color: '#8b5cf6', weight: 4, dashArray: '5,5' }).addTo(measureLayer);
  }
  
  const marker = L.circleMarker(latlng, {
    radius: 6, color: '#fff', weight: 2, fillColor: '#8b5cf6', fillOpacity: 1
  }).addTo(measureLayer);
  
  if (measurePoints.length === 1) {
    marker.bindTooltip("Start", { permanent: true, direction: 'right', className: 'measure-tooltip' }).openTooltip();
  } else {
    marker.bindTooltip(`${Math.round(measureDistance)} m`, { permanent: true, direction: 'right', className: 'measure-tooltip' }).openTooltip();
  }
}

async function onMapClick(latlng) {
  if (isMeasuring) {
    handleMeasureClick(latlng);
    return;
  }

  /* Hide hint */
  document.getElementById('mapClickHint').classList.add('hide');

  userLatLng = latlng;

  /* User marker */
  if (userMarker) map.removeLayer(userMarker);
  userMarker = L.marker([latlng.lat, latlng.lng], {
    icon: L.divIcon({
      className: '',
      html: `<div style="
        width:16px;height:16px;border-radius:50%;
        background:#3b82f6;border:3px solid #fff;
        box-shadow:0 0 0 3px rgba(59,130,246,.4);
      "></div>`,
      iconSize:[16,16], iconAnchor:[8,8]
    })
  }).addTo(map);

  /* Clear old routes */
  routeLayer.clearLayers();
  showResultSection(false);

  showToast('Menganalisis DP terdekat…');
  const results = await analyzeLocation(latlng.lat, latlng.lng);
  if (!results.length) {
    showToast('Analisis gagal. Buka via Live Server jika file:// diblokir.');
    return;
  }
  renderResults(results, latlng);

  /* Fetch nearby POIs in background */
  fetchPOI(latlng.lat, latlng.lng).then(pois => renderPOI(pois)).catch(() => {});
}

/* =========================================================
   ANALYZE LOCATION
   ========================================================= */
async function analyzeLocation(lat, lng, targetDP = null) {
  const token = ++analyzeToken;

  try {
    const candidates = targetDP ? [targetDP] : dpPoints;

    let results = candidates.map(dp => {
      const straightDist = haversine(lat, lng, dp.lat, dp.lng);
      const { cableDist, pathNodes } = cableReachFromUser(lat, lng, dp.nodeId);
      const crosses = segmentCrossesRailway({ lat, lng }, dp);

      return {
        dp,
        straightDist,
        cableDist,
        pathNodes,
        roadDist: null,
        osrmCoords: null,
        finalDist: straightDist,
        status: 'notcovered',
        via: cableDist != null ? 'Jalur Kabel' : 'Menghitung…',
        crosses
      };
    });

    results.sort((a, b) => {
      const da = a.cableDist != null ? a.cableDist : a.straightDist;
      const db = b.cableDist != null ? b.cableDist : b.straightDist;
      return da - db;
    });

    const byStraight = [...results].sort((a, b) => a.straightDist - b.straightDist);
    const poolIds = new Set();
    const pool = [];
    for (const r of results) {
      if (pool.length >= CANDIDATE_POOL) break;
      if (!poolIds.has(r.dp.id)) { poolIds.add(r.dp.id); pool.push(r); }
    }
    for (const r of byStraight) {
      if (pool.length >= CANDIDATE_POOL) break;
      if (!poolIds.has(r.dp.id)) { poolIds.add(r.dp.id); pool.push(r); }
    }

    if (token !== analyzeToken) return [];

    const roadMap = await getOsrmTableDistances(lat, lng, pool.map(r => r.dp));
    if (token !== analyzeToken) return [];

    pool.forEach(r => {
      const rd = roadMap.get(r.dp.id);
      if (rd != null && rd > 0) r.roadDist = rd;
    });

    pool.forEach(r => {
      r.finalDist = coverageDistance(r);
      r.via = r.cableDist != null ? 'Jalur Kabel' : (r.roadDist != null ? 'Jalan' : 'Estimasi');
      if (r.pathNodes.length >= 2) {
        const cableLine = routeAlongCableGeometry(r.pathNodes, { lat, lng }, r.dp);
        if (cableLine) r.crosses = r.crosses || pathCrossesBlocked(cableLine);
      }
      r.status = r.crosses ? 'blocked' : r.finalDist <= COVER_DIST ? 'covered' : 'notcovered';
    });

    pool.sort((a, b) => effectiveRankingDist(a) - effectiveRankingDist(b));

    const topResults = pool.slice(0, MAX_RESULTS);

    for (let i = 0; i < topResults.length; i++) {
      if (token !== analyzeToken) return [];
      const r = topResults[i];
      const osrmData = await getOSRMRoute(lat, lng, r.dp.lat, r.dp.lng, true);
      if (osrmData) {
        r.osrmCoords = osrmData.coords;
        if (r.roadDist == null) r.roadDist = osrmData.dist;
        r.crosses = pathCrossesBlocked(r.osrmCoords);
        r.status = r.crosses ? 'blocked' : r.finalDist <= COVER_DIST ? 'covered' : 'notcovered';
      }
      if (i < topResults.length - 1) await delay(80);
    }

    topResults.sort((a, b) => effectiveRankingDist(a) - effectiveRankingDist(b));
    return topResults;
  } catch (err) {
    console.error('Analysis Error:', err);
    return [];
  }
}

/* =========================================================
   RENDER RESULTS
   ========================================================= */
function renderResults(results, userLL) {
  showResultSection(true);
  const list = document.getElementById('resultList');
  list.innerHTML = '';

  if (!results.length) {
    document.getElementById('statusBadge').className = 'status-badge notcovered';
    document.getElementById('statusBadge').textContent = '❌ Data DP tidak tersedia';
    return;
  }

  const best = results[0];
  const badge = document.getElementById('statusBadge');

  if (best.status === 'blocked') {
    badge.className = 'status-badge blocked';
    badge.textContent = '⚠️ TERBLOKIR JALUR KERETA';
  } else if (best.status === 'covered') {
    badge.className = 'status-badge covered';
    badge.textContent = `✅ AREA COVERED — ${Math.round(best.finalDist)} m`;
  } else {
    badge.className = 'status-badge notcovered';
    badge.textContent = `❌ NOT COVERED — ${Math.round(best.finalDist)} m`;
  }

  results.forEach((r, idx) => {
    const card = document.createElement('div');
    card.className = 'result-card' + (idx === 0 ? ' active' : '');
    const statusLabel = r.status === 'blocked' ? 'BLOCKED' : r.status === 'covered' ? 'COVERED' : 'NOT COVERED';
    const statusClass = r.status;

    card.innerHTML = `
      <div class="dp-name">${escHtml(r.dp.name)}</div>
      <div class="dp-dist">
        ${r.via === 'Jalur Kabel'
          ? `🔌 JALUR KABEL: <strong>${Math.round(r.finalDist)} m</strong>${r.roadDist ? ` <span style="opacity:.75">(jalan ~${Math.round(r.roadDist)} m)</span>` : ''}`
          : r.via === 'Jalan'
            ? `🛣️ VIA JALAN: <strong>${Math.round(r.finalDist)} m</strong>`
            : `📏 ESTIMASI: <strong>${Math.round(r.finalDist)} m</strong>`}
      </div>
      <span class="dp-status ${statusClass}">${statusLabel}</span>
      <div class="dp-via">Via: ${escHtml(r.via)}</div>
      ${r.dp.desc ? `<div class="dp-via">Info: ${escHtml(stripHtml(r.dp.desc))}</div>` : ''}
      <button class="dp-route-btn" data-idx="${idx}">🗺️ Tampilkan Rute</button>
    `;

    const activateRoute = () => {
      drawRoute(r, userLL);
      list.querySelectorAll('.result-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      map.flyTo([r.dp.lat, r.dp.lng], 17, { duration: 1 });
    };

    card.querySelector('.dp-route-btn').addEventListener('click', e => {
      e.stopPropagation();
      activateRoute();
    });
    card.addEventListener('click', () => {
      activateRoute();
    });

    list.appendChild(card);
  });

  if (best) drawRoute(best, userLL);
}

/* =========================================================
   DRAW ROUTE ON MAP
   ========================================================= */
async function drawRoute(result, userLL) {
  if (isDrawingRoute) return;
  isDrawingRoute = true;

  routeLayer.clearLayers();
  showToast('Menghitung rute…');

  try {
    const color = result.status === 'covered' ? '#22c55e'
      : result.status === 'blocked' ? '#f59e0b' : '#ef4444';

    let pathCoords = null;
    let dashArray = result.status === 'blocked' ? '10,10' : null;
    let viaLabel = 'Jalan';

    const osrmData = await getOSRMRoute(userLL.lat, userLL.lng, result.dp.lat, result.dp.lng, true);
    if (osrmData?.coords?.length >= 2) {
      pathCoords = osrmData.coords;
      result.osrmCoords = osrmData.coords;
      viaLabel = 'Jalan';
    }

    if (!pathCoords && result.pathNodes?.length >= 2) {
      pathCoords = routeAlongCableGeometry(result.pathNodes, userLL, result.dp);
      if (pathCoords) {
        dashArray = dashArray || '6,4';
        viaLabel = 'Jalur Kabel';
      }
    }

    if (!pathCoords || pathCoords.length < 2) {
      showToast('Rute tidak dapat dihitung. Periksa koneksi internet.');
      isDrawingRoute = false;
      return;
    }

    L.polyline(pathCoords, {
      color,
      weight: 5,
      opacity: 0.85,
      dashArray
    }).addTo(routeLayer).bringToFront();

    L.circleMarker([result.dp.lat, result.dp.lng], {
      radius: 9, color: '#fff', weight: 2.5, fillColor: color, fillOpacity: 1
    }).addTo(routeLayer)
      .bindPopup(`<b>${escHtml(result.dp.name)}</b><br>Via: ${escHtml(viaLabel)}`);

    const allPts = pathCoords.filter(p => p && p[0] != null);
    if (allPts.length > 1) {
      map.flyToBounds(L.latLngBounds(allPts), { padding: [60, 60], duration: 0.8 });
    }

    showToast(`✓ Rute ke ${result.dp.name} — ${Math.round(result.finalDist)} m`);
  } catch (e) {
    console.error('Draw Route Error:', e);
    showToast('Gagal menampilkan rute.');
  } finally {
    isDrawingRoute = false;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    const proxy = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    const res = await fetch(proxy);
    if (!res.ok) throw e;
    return await res.json();
  }
}

function osrmCacheKey(fromLat, fromLng, toLat, toLng) {
  return `${fromLat.toFixed(5)},${fromLng.toFixed(5)}>${toLat.toFixed(5)},${toLng.toFixed(5)}`;
}

/* ----- OSRM jarak ke banyak DP (satu permintaan per chunk) ---- */
async function getOsrmTableDistances(fromLat, fromLng, dps) {
  const out = new Map();
  if (!dps.length) return out;

  const chunkSize = 12;
  for (let i = 0; i < dps.length; i += chunkSize) {
    const chunk = dps.slice(i, i + chunkSize);
    const coordList = [`${fromLng},${fromLat}`];
    chunk.forEach(dp => coordList.push(`${dp.lng},${dp.lat}`));
    const coordStr = coordList.join(';');
    const destIdx = chunk.map((_, j) => j + 1).join(';');

    for (const base of OSRM_TABLE_PROFILES) {
      const url = `${base}${coordStr}?sources=0&destinations=${destIdx}&annotations=distance`;
      try {
        const data = await fetchJson(url);
        if (data.code !== 'Ok' || !data.distances?.[0]) continue;
        data.distances[0].forEach((d, j) => {
          if (d != null && d >= 0) out.set(chunk[j].id, d);
        });
        break;
      } catch (e) {
        console.warn('OSRM table error:', e);
      }
    }
    await delay(100);
  }
  return out;
}

/* ----- OSRM route (mengikuti jalan) ---- */
async function getOSRMRoute(fromLat, fromLng, toLat, toLng, useCache = false) {
  const key = osrmCacheKey(fromLat, fromLng, toLat, toLng);
  if (useCache && osrmRouteCache.has(key)) return osrmRouteCache.get(key);

  const coordStr = `${fromLng},${fromLat};${toLng},${toLat}`;
  const params = [
    'overview=full',
    'geometries=geojson',
    'steps=false',
    'continue_straight=false',
    `radiuses=${OSRM_SNAP_RADIUS};${OSRM_SNAP_RADIUS}`
  ].join('&');

  for (const base of OSRM_PROFILES) {
    const url = `${base}${coordStr}?${params}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await fetchJson(url);
        if (data.code !== 'Ok' || !data.routes?.[0]) {
          if (attempt === 0) await delay(300);
          continue;
        }
        const route = data.routes[0];
        const result = {
          coords: route.geometry.coordinates.map(c => [c[1], c[0]]),
          dist: route.distance
        };
        if (useCache) osrmRouteCache.set(key, result);
        return result;
      } catch (e) {
        if (attempt === 0) await delay(300);
        else console.warn('OSRM route error:', base, e);
      }
    }
  }
  return null;
}

/* =========================================================
   SEARCH
   ========================================================= */
let searchTimer;
async function doSearch() {
  let q = document.getElementById('searchInput').value.trim();
  if (!q) return;
  const sugg = document.getElementById('searchSuggestions');

  /* Handle Google Maps URLs */
  if (q.includes('google.com/maps') || q.includes('maps.app.goo.gl') || q.includes('goo.gl/maps')) {
    showToast("Memproses link lokasi...");
    
    let targetUrl = q;
    
    // Resolve short links via proxy
    let coords = null;
    if (q.includes('maps.app.goo.gl') || q.includes('goo.gl/maps')) {
      try {
        const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(q)}`;
        const res = await fetch(proxyUrl);
        const html = await res.text();
        
        // Google Sets coordinates in center=lat%2Clng tags or similar
        const fallbackMatch = html.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || html.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || html.match(/center=(-?\d+\.\d+)%2C(-?\d+\.\d+)/);
        if (fallbackMatch) {
          coords = { lat: parseFloat(fallbackMatch[1]), lng: parseFloat(fallbackMatch[2]) };
        } else {
          targetUrl = res.url; // fetch automatically followed redirect!
        }
      } catch (e) {
        console.warn("Unshorten failed, attempting regex anyway:", e);
      }
    }

    if (!coords) {
      // Comprehensive Regex for Google Maps coords if not found yet
      const regexList = [
        /@(-?\d+\.\d+),(-?\d+\.\d+)/,               // @lat,lng
        /[q|ll|query]=(-?\d+\.\d+),(-?\d+\.\d+)/,   // q=lat,lng
        /3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/             // 3d-lat!4dlng
      ];
      
      for (const reg of regexList) {
        const m = targetUrl.match(reg);
        if (m) {
          coords = { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
          break;
        }
      }
    }

    if (coords) {
      onMapClick(coords);
      sugg.classList.remove('show');
      return;
    } else {
      alert("Link tidak dikenal atau koordinat tidak ditemukan. Gunakan Pin drop / URL browser.");
      return;
    }
  }

  /* Cek apakah input koordinat lat,lng */
  const coordMatch = q.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    onMapClick({ lat, lng });
    sugg.classList.remove('show');
    return;
  }

  /* Nominatim */
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ' Tulungagung')}&format=json&limit=5`,
      { headers: { 'Accept-Language': 'id' } }
    );
    const data = await res.json();
    sugg.innerHTML = '';
    if (!data.length) {
      sugg.innerHTML = '<div class="suggestion-item" style="color:#94a3b8">Tidak ditemukan</div>';
    } else {
      data.forEach(item => {
        const d = document.createElement('div');
        d.className = 'suggestion-item';
        d.textContent = item.display_name;
        d.addEventListener('click', () => {
          onMapClick({ lat: parseFloat(item.lat), lng: parseFloat(item.lon) });
          sugg.classList.remove('show');
          document.getElementById('searchInput').value = item.display_name;
        });
        sugg.appendChild(d);
      });
    }
    sugg.classList.add('show');
  } catch {
    sugg.innerHTML = '<div class="suggestion-item" style="color:#94a3b8">Gagal pencarian</div>';
    sugg.classList.add('show');
  }
}

document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap') && !e.target.closest('.suggestions')) {
    document.getElementById('searchSuggestions').classList.remove('show');
  }
});

/* =========================================================
   RENDER DP MARKERS
   ========================================================= */
function renderDP() {
  dpLayer.clearLayers();
  dpPoints.forEach(dp => {
    const marker = L.circleMarker([dp.lat, dp.lng], {
      radius: 5, color: '#ef4444', fillColor: '#ef4444', fillOpacity: .85, weight: 1.5
    });
    let popupContent = `<b>${escHtml(dp.name)}</b>`;
    if (dp.desc) popupContent += `<br><small>${escHtml(stripHtml(dp.desc))}</small>`;
    popupContent += `<br><button onclick="window.selectSpecificDPById(${dp.id})" style="margin-top:8px;cursor:pointer;background:#1a73e8;color:#fff;border:none;padding:4px 8px;border-radius:4px;font-size:11px">Hitung Rute ke Sini</button>`;
    marker.bindPopup(popupContent);
    marker.on('click', () => marker.openPopup());
    dpLayer.addLayer(marker);
  });
}

// Global expose for popup button
window.selectSpecificDPById = (id) => {
  const dp = dpPoints.find(d => d.id === id);
  if (dp) selectSpecificDP(dp);
};

/* =========================================================
   RENDER KABEL LINES
   ========================================================= */
function renderKabel() {
  kabelLayer.clearLayers();
  cableSegs.forEach(seg => {
    if (!seg || seg.length < 2) return;
    const latLngs = seg.map(c => [c.lat, c.lng]);
    L.polyline(latLngs, { color: '#f97316', weight: 3, opacity: 0.8 }).addTo(kabelLayer);
  });
}

/* =========================================================
   RAILWAY
   ========================================================= */
function drawRailway() {
  railwayLayer.clearLayers();
  RAILWAY_LINES.forEach(lineCoords => {
    /* main line style (Google Maps railway look) */
    L.polyline(lineCoords, { color: '#333', weight: 5, opacity: 0.6 }).addTo(railwayLayer);
    L.polyline(lineCoords, { color: '#fff', weight: 3, opacity: 0.8, dashArray: '10,12' }).addTo(railwayLayer)
      .bindPopup('⚠️ Jalur Kereta Api — Rute diblokir');
    /* border */
    L.polyline(lineCoords, { color: '#000', weight: 7, opacity: .25 }).addTo(railwayLayer);
  });
}

function drawRiver() {
  riverLayer.clearLayers();
  if (typeof RIVER_LINES === 'undefined') return;
  RIVER_LINES.forEach(lineCoords => {
    /* bg besar transparan */
    L.polyline(lineCoords, { color: '#0ea5e9', weight: 8, opacity: 0.5 }).addTo(riverLayer)
      .bindPopup('⚠️ Jalur Sungai Besar — Rute diblokir melewati area ini');
    /* garis tengah */
    L.polyline(lineCoords, { color: '#0284c7', weight: 2, opacity: 0.8 }).addTo(riverLayer);
  });
}

/* =========================================================
   CROSSING DETECTION (RAILWAY & RIVERS)
   ========================================================= */
function segmentCrossesRailway(a, b) {
  /* Cek Rel Kereta */
  for (const line of RAILWAY_LINES) {
    for (let i = 0; i < line.length - 1; i++) {
      const r1 = { lat: line[i][0], lng: line[i][1] };
      const r2 = { lat: line[i + 1][0], lng: line[i + 1][1] };
      if (segmentsIntersect(a, b, r1, r2)) return true;
    }
  }
  
  /* Cek Sungai Besar */
  if (typeof RIVER_LINES !== 'undefined') {
    for (const line of RIVER_LINES) {
      for (let i = 0; i < line.length - 1; i++) {
        const r1 = { lat: line[i][0], lng: line[i][1] };
        const r2 = { lat: line[i + 1][0], lng: line[i + 1][1] };
        if (segmentsIntersect(a, b, r1, r2)) return true;
      }
    }
  }
  
  return false;
}

/* Line segment intersection (2D, lat/lng as x/y) */
function segmentsIntersect(a, b, c, d) {
  function cross(o, u, v) {
    return (u.lng - o.lng) * (v.lat - o.lat) - (u.lat - o.lat) * (v.lng - o.lng);
  }
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

/* =========================================================
   UTILITIES
   ========================================================= */
function haversine(lat1, lng1, lat2, lng2) {
  const R  = 6371000;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function txt(el, tag) {
  const t = el.querySelector(tag);
  return t ? t.textContent.trim() : '';
}

function coords1(el) {
  const coordNode = el.querySelector('coordinates');
  if (!coordNode) return [0, 0];
  return coordNode.textContent.trim()
    .split(',').map(Number);
}

function coordsList(el) {
  const coordNode = el.querySelector('coordinates');
  if (!coordNode) return [];
  return coordNode.textContent.trim()
    .split(/\s+/).filter(Boolean).map(s => {
      const [lng, lat] = s.split(',').map(Number);
      return { lat, lng };
    });
}

function escHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function stripHtml(s) {
  const d = document.createElement('div');
  d.innerHTML = s || '';
  return d.textContent || d.innerText || '';
}

function showLoading(show) {
  document.getElementById('loading').classList.toggle('hidden', !show);
}

function showResultSection(show) {
  document.getElementById('resultSection').style.display = show ? '' : 'none';
}

function hideMsgAfter() {
  setTimeout(() => {
    document.getElementById('mapClickHint').classList.remove('hide');
  }, 300);
}

function showLoadError() {
  /* Tampilkan notifikasi KML gagal tapi tetap lanjut dengan mode terbatas */
  const hint = document.getElementById('mapClickHint');
  hint.style.color = '#f59e0b';
  hint.innerHTML = `
    <div style="margin-bottom:8px">⚠️ Data KML gagal dimuat secara otomatis.</div>
    <button id="retryKmlBtn" style="
      background:#f59e0b;color:#fff;border:none;padding:5px 12px;
      border-radius:4px;cursor:pointer;font-family:inherit;font-weight:600;
      transition:all 0.2s;
    ">🔄 Coba Lagi</button>
  `;
  hint.classList.remove('hide');

  const btn = document.getElementById('retryKmlBtn');
  if (btn) {
    btn.onclick = (e) => {
      e.stopPropagation();
      loadKML();
    };
  }
}

/* =========================================================
   POI — Tempat Terdekat via Overpass API
   ========================================================= */
const POI_ICONS = {
  cafe: '☕', restaurant: '🍽️', fast_food: '🍔', food_court: '🍱',
  bank: '🏦', atm: '🏧', hospital: '🏥', clinic: '🏥', pharmacy: '💊',
  school: '🏫', university: '🎓', place_of_worship: '🕌',
  fuel: '⛽', parking: '🅿️', supermarket: '🛒', convenience: '🏪',
  hotel: '🏨', guest_house: '🛏️', police: '👮', post_office: '📮',
  default: '📍'
};

async function fetchPOI(lat, lng) {
  const R = 300; // radius 300m
  const query = `
    [out:json][timeout:10];
    (
      node["amenity"](around:${R},${lat},${lng});
      node["shop"](around:${R},${lat},${lng});
      node["tourism"](around:${R},${lat},${lng});
    );
    out body 30;
  `;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query
    });
    const data = await res.json();
    return data.elements || [];
  } catch (e) {
    console.warn('POI fetch error:', e);
    return [];
  }
}

function renderPOI(pois) {
  const section = document.getElementById('poiSection');
  const list = document.getElementById('poiList');
  if (!section || !list) return;

  list.innerHTML = '';
  if (!pois.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  pois.slice(0, 12).forEach(poi => {
    const tags = poi.tags || {};
    const name = tags.name || tags['name:id'] || tags.amenity || tags.shop || tags.tourism || 'Tempat';
    const type = tags.amenity || tags.shop || tags.tourism || 'default';
    const icon = POI_ICONS[type] || POI_ICONS.default;
    const d = document.createElement('div');
    d.className = 'poi-item';
    d.innerHTML = `<span class="poi-icon">${icon}</span><span class="poi-name">${escHtml(name)}</span>`;
    d.addEventListener('click', () => map.setView([poi.lat, poi.lon], 18));
    list.appendChild(d);
  });
}

/* =========================================================
   STREET VIEW — Mapillary
   ========================================================= */
function openStreetView(lat, lng) {
  if (!lat || !lng) {
    showToast("Pilih lokasi di peta terlebih dahulu");
    return;
  }
  // Buka Google Maps Street View Asli di Tab Baru (Akurasi & Ketersediaan 100%)
  const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
  window.open(url, '_blank');
}

window.closeSVPanel = () => {};
