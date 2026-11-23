/* ══════════════════════════════════════════════════════════════════
   MagnetMonitor v2 – script.js
   Frontend interactivo: monitoreo, cálculo electromagnético,
   diagnósticos del servidor y simulación.
   ══════════════════════════════════════════════════════════════════ */

// ─── Constantes físicas ─────────────────────────────────────────
const MU_0 = 4 * Math.PI * 1e-7;

// ─── Configuración de la API ─────────────────────────────────────
// En producción: 'https://miltonguerrero.rf.gd'
// En local/dev:  '' (mismo origen si el backend corre local)
const API_BASE = (() => {
  const h = window.location.hostname;
  if (h === 'miltonguerrero.rf.gd') return 'https://miltonguerrero.rf.gd';
  if (h === 'localhost' || h === '127.0.0.1') return '';
  return '';
})();

const READINGS_URL    = `${API_BASE}/api/readings`;
const SENSORS_URL     = `${API_BASE}/api/sensors`;
const EXPORT_URL      = `${API_BASE}/api/readings/export`;
const DIAGNOSTICS_URL = `${API_BASE}/api/diagnostics`;

// Polling cada 2 segundos para monitoreo en vivo
const POLL_INTERVAL_MS = 2000;

// ─── Estado global ───────────────────────────────────────────────
let readings       = [];
let simRunning     = false;
let simInterval    = null;
let pollInterval   = null;
let chartWindowSec = 60;
let rowIndex       = 0;
let useRealData    = false;
let currentSensor  = 'all';
let lastReadingId  = 0;

// ─── Estado de Telemetría ESP32 ──────────────────────────────────
let lastPacketTimestamp  = 0;
let totalPacketsReceived = 0;
let activeSensorName     = '—';
let activeHwMode         = 'Esperando datos...';

// ═══════════════════════════════════════════════════════════════════
//  SISTEMA DE NOTIFICACIONES (TOASTS) Y CONSOLA DE DIAGNÓSTICO
// ═══════════════════════════════════════════════════════════════════

function showToast(message, type = 'info', duration = 4500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = type === 'success' ? '✅' :
               type === 'error'   ? '❌' :
               type === 'warn'    ? '⚠️' : 'ℹ️';

  toast.innerHTML = `<span>${icon}</span><span style="flex:1">${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

function logConnection(type, message, details = null) {
  const consoleEl = document.getElementById('diag-console');
  if (!consoleEl) return;

  const now = new Date().toLocaleTimeString('es', { hour12: false });
  const entry = document.createElement('div');
  entry.className = `console-entry ${type}`;

  let extra = '';
  if (details) {
    if (typeof details === 'object') {
      try { extra = ' → ' + JSON.stringify(details); } catch (_) {}
    } else {
      extra = ` → ${details}`;
    }
  }

  entry.textContent = `[${now}] [${type.toUpperCase()}] ${message}${extra}`;
  consoleEl.insertBefore(entry, consoleEl.firstChild);

  // Limitar historial a 80 líneas
  while (consoleEl.children.length > 80) {
    consoleEl.removeChild(consoleEl.lastChild);
  }
}

/**
 * Realiza fetch con captura de errores, timeout y parseo de HTML/JSON
 */
async function safeFetch(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, credentials: 'omit', credentials: 'same-origin', signal: controller.signal });
    clearTimeout(id);

    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    let json = null;
    if (contentType.includes('application/json') || (text.trim().startsWith('{') && text.trim().endsWith('}'))) {
      try { json = JSON.parse(text); } catch (_) {}
    }

    if (!res.ok) {
      const errMsg = json?.error || `Error HTTP ${res.status}: ${res.statusText}`;
      const errDetail = json?.detail || (text.length < 250 ? text : 'Respuesta no JSON del servidor');
      const err = new Error(errMsg);
      err.status = res.status;
      err.detail = errDetail;
      err.json = json;
      throw err;
    }

    if (!json) {
      throw new Error(`El servidor respondió con contenido no JSON (${contentType || 'texto/html'}). Verifica que los archivos PHP estén subidos correctamente.`);
    }

    return json;
  } catch (err) {
    clearTimeout(id);
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`Tiempo de espera agotado (${timeoutMs / 1000}s) contactando a ${url}`);
      timeoutErr.status = 408;
      throw timeoutErr;
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  CHART.JS
// ═══════════════════════════════════════════════════════════════════
const ctx = document.getElementById('main-chart').getContext('2d');
const chart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      {
        label: 'Campo |B| (T)',
        data: [],
        borderColor: '#58a6ff',
        backgroundColor: 'rgba(88,166,255,0.08)',
        borderWidth: 2, pointRadius: 0, fill: true, tension: 0.4,
      },
      {
        label: 'Bx (T)',
        data: [],
        borderColor: '#ff7b7b', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.4, hidden: true,
      },
      {
        label: 'By (T)',
        data: [],
        borderColor: '#3fb950', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.4, hidden: true,
      },
      {
        label: 'Bz (T)',
        data: [],
        borderColor: '#d29922', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.4, hidden: true,
      },
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: '#c9d1d9', font: { size: 11 } } },
      tooltip: {
        callbacks: {
          label: c => ` ${fmt(c.raw)} T  (${(c.raw * 1e6).toFixed(4)} µT)`
        }
      }
    },
    scales: {
      x: { ticks: { color: '#8b949e', maxTicksLimit: 8, maxRotation: 0 }, grid: { color: '#21262d' } },
      y: { ticks: { color: '#8b949e', callback: v => fmt(v) + ' T' },      grid: { color: '#21262d' } }
    }
  }
});

// ═══════════════════════════════════════════════════════════════════
//  GAUGE
// ═══════════════════════════════════════════════════════════════════
const gaugeCtx = document.getElementById('gauge-canvas').getContext('2d');
function drawGauge(fraction) {
  const W = 160, H = 90, cx = W / 2, cy = H - 10, r = 65;
  gaugeCtx.clearRect(0, 0, W, H);
  gaugeCtx.beginPath(); gaugeCtx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
  gaugeCtx.lineWidth = 14; gaugeCtx.strokeStyle = '#21262d'; gaugeCtx.stroke();
  const clamp = Math.min(1, Math.max(0, fraction));
  const angle = Math.PI + clamp * Math.PI;
  gaugeCtx.beginPath(); gaugeCtx.arc(cx, cy, r, Math.PI, angle);
  gaugeCtx.strokeStyle = clamp < 0.5 ? '#3fb950' : clamp < 0.8 ? '#d29922' : '#f85149'; gaugeCtx.stroke();
  const nx = cx + (r - 7) * Math.cos(angle), ny = cy + (r - 7) * Math.sin(angle);
  gaugeCtx.beginPath(); gaugeCtx.moveTo(cx, cy); gaugeCtx.lineTo(nx, ny);
  gaugeCtx.lineWidth = 2.5; gaugeCtx.strokeStyle = '#fff'; gaugeCtx.stroke();
}

// ═══════════════════════════════════════════════════════════════════
//  FORMATO / UTILIDADES
// ═══════════════════════════════════════════════════════════════════
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a === 0) return '0';
  if (a >= 1) return n.toFixed(4);
  return n.toExponential(3);
}
function level(uT) {
  if (uT < 60)  return { label: 'Normal', cls: 'level-low'    };
  if (uT < 100) return { label: 'Medio',  cls: 'level-medium' };
  return               { label: 'Alto',   cls: 'level-high'   };
}

// ═══════════════════════════════════════════════════════════════════
//  ACTUALIZAR MÉTRICAS + CHART + LOG
// ═══════════════════════════════════════════════════════════════════
function updateMetrics() {
  if (!readings.length) return;
  const vals = readings.map(r => r.value);
  const cur  = vals[vals.length - 1];
  const mx   = Math.max(...vals);
  const mn   = Math.min(...vals);
  const avg  = vals.reduce((a, b) => a + b, 0) / vals.length;
  document.getElementById('val-current').textContent = fmt(cur) + ' T';
  document.getElementById('val-max').textContent     = fmt(mx)  + ' T';
  document.getElementById('val-min').textContent     = fmt(mn)  + ' T';
  document.getElementById('val-avg').textContent     = fmt(avg) + ' T';
  drawGauge(cur / 200e-6);
  document.getElementById('gauge-label').textContent = (cur * 1e6).toFixed(2) + ' µT';
}

function updateChart() {
  const now    = Date.now();
  const cutoff = now - chartWindowSec * 1000;
  const slice  = readings.filter(r => r.time >= cutoff);
  chart.data.labels            = slice.map(r => new Date(r.time).toLocaleTimeString('es', { hour12: false }));
  chart.data.datasets[0].data = slice.map(r => r.value);
  chart.data.datasets[1].data = slice.map(r => r.bx ?? null);
  chart.data.datasets[2].data = slice.map(r => r.by ?? null);
  chart.data.datasets[3].data = slice.map(r => r.bz ?? null);
  chart.update();
}

function addLogRow(r) {
  rowIndex++;
  const uT    = r.value * 1e6;
  const lv    = level(uT);
  const tbody = document.getElementById('log-body');
  const tr    = document.createElement('tr');
  tr.innerHTML = `
    <td>${rowIndex}</td>
    <td>${r.sensorId || '—'}</td>
    <td>${new Date(r.time).toLocaleTimeString('es', { hour12: false })}</td>
    <td style="font-family:monospace">${fmt(r.value)}</td>
    <td style="font-family:monospace">${uT.toFixed(3)}</td>
    <td class="${lv.cls}">${lv.label}</td>
  `;
  tbody.insertBefore(tr, tbody.firstChild);
  while (tbody.rows.length > 300) tbody.deleteRow(tbody.rows.length - 1);
  applyFilter();
}

function ingestReading(r) {
  readings.push(r);
  if (readings.length > 5000) readings.shift();
  updateMetrics();
  updateChart();
  addLogRow(r);

  // Registrar telemetría del ESP32 si proviene de MySQL o prueba real
  if (r.sensorId !== 'SIMULADOR') {
    registerHardwarePulse(r);
  }
}

function registerHardwarePulse(r) {
  totalPacketsReceived++;
  lastPacketTimestamp = Date.now();
  activeSensorName = r.sensorId || 'ESP32';

  // Identificar si viene en modo prueba ESP32 o con sensor físico
  if (r.raw_json) {
    let parsed = null;
    if (typeof r.raw_json === 'string') {
      try { parsed = JSON.parse(r.raw_json); } catch (_) {}
    } else if (typeof r.raw_json === 'object') {
      parsed = r.raw_json;
    }
    if (parsed && parsed.hw_mode) {
      activeHwMode = parsed.hw_mode === 'PRUEBA_ESP32_SIN_SENSOR'
        ? 'Prueba ESP32 (Sintético sin sensor)'
        : 'Sensor Físico QMC5883L';
    } else {
      activeHwMode = 'ESP32 Conectado';
    }
  }

  // Destello en el LED virtual de la interfaz web
  const led = document.getElementById('esp-virtual-led');
  const ledTxt = document.getElementById('esp-virtual-led-text');
  if (led) {
    led.classList.add('flash');
    if (ledTxt) ledTxt.textContent = '¡Paquete entrante!';
    setTimeout(() => {
      led.classList.remove('flash');
      if (ledTxt) ledTxt.textContent = 'Activo';
    }, 280);
  }

  updateHardwareTelemetryUI();
}

function updateHardwareTelemetryUI() {
  const badge     = document.getElementById('esp-status-badge');
  const badgeText = document.getElementById('esp-status-text');
  const lastSeen  = document.getElementById('esp-last-seen');
  const sensorEl  = document.getElementById('esp-active-sensor');
  const countEl   = document.getElementById('esp-packet-count');
  const modeEl    = document.getElementById('esp-mode-label');

  if (!badge) return;

  if (sensorEl) sensorEl.textContent = activeSensorName;
  if (countEl)  countEl.textContent  = totalPacketsReceived;
  if (modeEl)   modeEl.textContent   = activeHwMode;

  if (lastPacketTimestamp === 0) {
    badge.className = 'esp-status-badge disconnected';
    badgeText.textContent = 'ESP32 SIN TRANSMISIÓN';
    if (lastSeen) lastSeen.textContent = 'Esperando primera transmisión del microcontrolador...';
    return;
  }

  const elapsedSec = Math.floor((Date.now() - lastPacketTimestamp) / 1000);

  if (elapsedSec <= 5) {
    badge.className = 'esp-status-badge online';
    badgeText.textContent = 'ESP32 EN LÍNEA 🟢';
    if (lastSeen) lastSeen.textContent = `Recibido hace ${elapsedSec}s (${new Date(lastPacketTimestamp).toLocaleTimeString('es')})`;
  } else if (elapsedSec <= 15) {
    badge.className = 'esp-status-badge idle';
    badgeText.textContent = 'ESP32 EN ESPERA 🟡';
    if (lastSeen) lastSeen.textContent = `Última señal hace ${elapsedSec}s (esperando siguiente paquete)`;
  } else {
    badge.className = 'esp-status-badge disconnected';
    badgeText.textContent = 'ESP32 DESCONECTADO ⚪';
    if (lastSeen) lastSeen.textContent = `Sin transmisiones hace ${elapsedSec}s`;
  }
}

// Timer para actualizar el contador de segundos transcurridos cada segundo
setInterval(updateHardwareTelemetryUI, 1000);

// ═══════════════════════════════════════════════════════════════════
//  POLLING (Monitoreo en tiempo real desde MySQL)
// ═══════════════════════════════════════════════════════════════════
async function pollNewReadings() {
  if (!useRealData) return;
  try {
    const qs = new URLSearchParams({ limit: 50, after_id: lastReadingId });
    if (currentSensor !== 'all') qs.set('sensor_id', currentSensor);

    const json = await safeFetch(`${READINGS_URL}?${qs}`, {}, 4000);
    if (!json.ok || !json.data.rows || !json.data.rows.length) return;

    let countNew = 0;
    json.data.rows.forEach(d => {
      lastReadingId = Math.max(lastReadingId, d.id);
      ingestReading({
        time:     new Date(d.recorded_at).getTime(),
        value:    d.field_tesla,
        bx:       d.field_x,
        by:       d.field_y,
        bz:       d.field_z,
        sensorId: d.sensor_id,
        raw_json: d.raw_json,
      });
      countNew++;
    });

    if (countNew > 0) {
      logConnection('info', `Polling: ${countNew} nueva(s) lectura(s) recibidas de MySQL.`);
    }
  } catch (err) {
    logConnection('warn', 'Fallo temporal en polling de lecturas', err.message);
  }
}

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(pollNewReadings, POLL_INTERVAL_MS);
}
function stopPolling() {
  clearInterval(pollInterval);
  pollInterval = null;
}

// ═══════════════════════════════════════════════════════════════════
//  CARGAR HISTORIAL INICIAL DESDE LA API
// ═══════════════════════════════════════════════════════════════════
async function loadInitialReadings() {
  try {
    logConnection('info', 'Contactando al servidor para cargar historial...');
    const qs = new URLSearchParams({ limit: 200 });
    if (currentSensor !== 'all') qs.set('sensor_id', currentSensor);

    const json = await safeFetch(`${READINGS_URL}?${qs}`, {}, 5000);

    if (json.ok && json.data && json.data.rows && json.data.rows.length > 0) {
      useRealData = true;
      stopSim();

      readings = [];
      lastReadingId = 0;
      json.data.rows.forEach(d => {
        lastReadingId = Math.max(lastReadingId, d.id);
        readings.push({
          time:     new Date(d.recorded_at).getTime(),
          value:    d.field_tesla,
          bx:       d.field_x,
          by:       d.field_y,
          bz:       d.field_z,
          sensorId: d.sensor_id,
          raw_json: d.raw_json,
        });
      });

      readings.forEach(r => addLogRow(r));
      updateMetrics();
      updateChart();
      setStatus(true, 'En vivo · Servidor Conectado', false);
      logConnection('success', `Historial cargado: ${readings.length} lecturas desde MySQL.`);
      showToast('Conectado exitosamente con MySQL. Monitoreo en vivo activado.', 'success');

      loadSensors();
      startPolling();
    } else {
      logConnection('warn', 'El servidor respondió pero no hay lecturas previas en la BD.');
      setStatus(true, 'Conectado (Sin datos previos)', false);
      loadSensors();
      startPolling();
      useRealData = true;
      stopSim();
    }
  } catch (err) {
    logConnection('error', 'Fallo al conectar con el servidor PHP / MySQL', err.message);
    setStatus(false, 'Sin conexión / Error MySQL', true);
    showToast(`Error de conexión con el servidor: ${err.message}`, 'error', 8000);
    // Simulación apagada por defecto para no saturar al usuario
  }
}

// ═══════════════════════════════════════════════════════════════════
//  SELECTOR DE SENSOR
// ═══════════════════════════════════════════════════════════════════
async function loadSensors() {
  try {
    const json = await safeFetch(SENSORS_URL, {}, 4000);
    if (!json.ok || !Array.isArray(json.data)) return;

    const sel = document.getElementById('sensor-filter');
    sel.innerHTML = '<option value="all">Todos los sensores</option>';
    json.data.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.sensor_id;
      opt.textContent = `${s.name} (${s.sensor_id})`;
      sel.appendChild(opt);
    });
    sel.style.display = '';
    logConnection('info', `Sensores cargados: ${json.data.length} dispositivo(s).`);
  } catch (err) {
    logConnection('warn', 'No se pudo listar los sensores', err.message);
  }
}

document.getElementById('sensor-filter')?.addEventListener('change', e => {
  currentSensor = e.target.value;
  clearChart();
  loadInitialReadings();
});

// ═══════════════════════════════════════════════════════════════════
//  SIMULADOR BROWNIANO (FALLBACK SIN HARDWARE)
// ═══════════════════════════════════════════════════════════════════
let simPhase = 0;
let brownianB = 50e-6;

function simulateReading() {
  simPhase += 0.12;
  const sinC  = 20e-6 * Math.sin(simPhase);
  const noise = (Math.random() - 0.5) * 10e-6;
  brownianB  += (Math.random() - 0.5) * 2e-6;
  brownianB   = Math.max(5e-6, Math.min(200e-6, brownianB));
  const B     = brownianB + sinC + noise;
  const angle = simPhase;
  return {
    time:     Date.now(),
    value:    B,
    bx:       B * Math.cos(angle) * 0.6,
    by:       B * Math.sin(angle) * 0.6,
    bz:       B * 0.3 + noise,
    sensorId: 'SIMULADOR',
  };
}

function startSim() {
  if (simRunning) return;
  simInterval = setInterval(() => ingestReading(simulateReading()), 1000);
  simRunning  = true;
  setStatus(true, 'Simulación activa', false);
  const btn = document.getElementById('toggle-sim-btn');
  if (btn) btn.textContent = '⏹ Detener Simulación';
  showToast('Simulación manual iniciada.', 'info', 3000);
  logConnection('info', 'Simulador manual de campo magnético activado.');
}

function stopSim() {
  if (simInterval) clearInterval(simInterval);
  simInterval = null;
  simRunning  = false;
  setStatus(false, 'En espera', true);
  const btn = document.getElementById('toggle-sim-btn');
  if (btn) btn.textContent = '▶ Simular';
  logConnection('info', 'Simulador manual detenido.');
}

document.getElementById('toggle-sim-btn')?.addEventListener('click', () => {
  if (simRunning) {
    stopSim();
    showToast('Simulación manual detenida.', 'info', 2500);
  } else {
    startSim();
  }
});

// ═══════════════════════════════════════════════════════════════════
//  CONTROLES GENERALES
// ═══════════════════════════════════════════════════════════════════
function setStatus(running, label, paused) {
  const dot = document.getElementById('status-dot');
  document.getElementById('status-label').textContent = label;
  dot.classList.toggle('paused', paused || !running);
}

function clearChart() {
  readings = [];
  chart.data.labels = [];
  chart.data.datasets.forEach(ds => ds.data = []);
  chart.update();
  ['val-current', 'val-max', 'val-min', 'val-avg'].forEach(id => {
    document.getElementById(id).textContent = '— T';
  });
  drawGauge(0);
  document.getElementById('gauge-label').textContent = '0 µT';
}

document.getElementById('window-select').addEventListener('change', e => {
  chartWindowSec = parseInt(e.target.value);
  updateChart();
});

document.getElementById('clear-chart-btn').addEventListener('click', clearChart);

document.getElementById('clear-log-btn').addEventListener('click', () => {
  document.getElementById('log-body').innerHTML = '';
  rowIndex = 0;
});

// ─── Exportar CSV ─────────────────────────────────────────────────
document.getElementById('export-csv-btn').addEventListener('click', () => {
  if (useRealData) {
    const qs = new URLSearchParams();
    if (currentSensor !== 'all') qs.set('sensor_id', currentSensor);
    window.open(`${EXPORT_URL}?${qs}`, '_blank');
    logConnection('info', 'Descargando exportación CSV desde MySQL.');
    return;
  }
  const rows = ['timestamp,sensor_id,B_T,B_uT,Bx_T,By_T,Bz_T'];
  readings.forEach(r => {
    rows.push(`${new Date(r.time).toISOString()},${r.sensorId || 'SIM'},` +
      `${r.value.toExponential(6)},${(r.value * 1e6).toFixed(4)},` +
      `${(r.bx ?? 0).toExponential(4)},${(r.by ?? 0).toExponential(4)},${(r.bz ?? 0).toExponential(4)}`);
  });
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `magnetmonitor_${Date.now()}.csv`
  }).click();
});

// ─── Filtro de historial ──────────────────────────────────────────
document.getElementById('log-search').addEventListener('input', applyFilter);
function applyFilter() {
  const q = document.getElementById('log-search').value.toLowerCase();
  document.querySelectorAll('#log-body tr').forEach(tr => {
    tr.style.display = q && !tr.textContent.toLowerCase().includes(q) ? 'none' : '';
  });
}

// ═══════════════════════════════════════════════════════════════════
//  PANEL DE PRUEBAS Y DIAGNÓSTICO EN VIVO
// ═══════════════════════════════════════════════════════════════════

/**
 * Ejecuta el diagnóstico integral contra api/diagnostics.php
 */
async function runDiagnostics() {
  showToast('🩺 Comprobando servidor PHP y base de datos MySQL...', 'info', 3000);
  logConnection('info', 'Iniciando diagnóstico completo del servidor...');
  const t0 = performance.now();

  const phpVal   = document.getElementById('val-php-status');
  const mysqlVal = document.getElementById('val-mysql-status');
  const tblVal   = document.getElementById('val-tables-status');
  const latVal   = document.getElementById('val-latency');
  const alertBox = document.getElementById('diag-alert-box');
  const alertTxt = document.getElementById('diag-alert-text');

  phpVal.textContent   = 'Comprobando...';
  mysqlVal.textContent = 'Comprobando...';
  tblVal.textContent   = 'Comprobando...';
  latVal.textContent   = '...';
  alertBox.style.display = 'none';

  try {
    const json = await safeFetch(DIAGNOSTICS_URL, {}, 6000);
    const latency = Math.round(performance.now() - t0);
    latVal.textContent = `${latency} ms`;

    const d = json.data;

    // 1. PHP
    if (d.php) {
      phpVal.textContent = `PHP v${d.php.version} ✓`;
      phpVal.className   = 'status-badge-val ok';
    }

    // 2. MySQL
    if (d.database && d.database.connected) {
      mysqlVal.textContent = `Conectado (${d.database.database}) ✓`;
      mysqlVal.className   = 'status-badge-val ok';
    } else {
      const err = d.database?.error || 'Sin conexión a MySQL';
      mysqlVal.textContent = 'ERROR ✗';
      mysqlVal.className   = 'status-badge-val err';
      alertBox.style.display = 'flex';
      alertTxt.innerHTML = `<strong>Fallo de Base de Datos:</strong> ${err}<br/><small>Verifica las credenciales en <code>config/db.php</code> o si el host de MySQL en InfinityFree es accesible.</small>`;
      showToast('Error de conexión con MySQL: ' + err, 'error', 6000);
      logConnection('error', 'Diagnóstico MySQL fallido', err);
    }

    // 3. Tablas
    if (d.tables) {
      const sOk = d.tables.sensors?.exists;
      const rOk = d.tables.readings?.exists;
      const sCnt = d.tables.sensors?.count ?? 0;
      const rCnt = d.tables.readings?.count ?? 0;

      if (sOk && rOk) {
        tblVal.textContent = `sensors (${sCnt}) | readings (${rCnt}) ✓`;
        tblVal.className   = 'status-badge-val ok';
      } else {
        tblVal.textContent = `Faltan tablas ✗`;
        tblVal.className   = 'status-badge-val err';
        alertBox.style.display = 'flex';
        alertTxt.innerHTML = `<strong>Tablas faltantes en MySQL:</strong> Las tablas <code>sensors</code> o <code>readings</code> no existen.<br/><small>Importa el archivo <code>schema_hosting.sql</code> en phpMyAdmin.</small>`;
        logConnection('error', 'Tablas requeridas no encontradas en MySQL');
      }
    }

    // 4. Última lectura
    renderLatestReading(d.latest_reading);

    logConnection('success', `Diagnóstico finalizado en ${latency} ms. Estado general: ${json.meta?.status || 'OK'}`);
    showToast('Diagnóstico del servidor completado con éxito.', 'success');

  } catch (err) {
    const latency = Math.round(performance.now() - t0);
    latVal.textContent = `${latency} ms`;
    phpVal.textContent = 'Inalcanzable ✗';
    phpVal.className   = 'status-badge-val err';
    mysqlVal.textContent = 'Desconocido';
    mysqlVal.className   = 'status-badge-val err';

    alertBox.style.display = 'flex';
    alertTxt.innerHTML = `<strong>Error de conexión al servidor:</strong> ${err.message}<br/><small>${err.detail || 'Revisa que tu hosting esté activo y los archivos en htdocs/'}</small>`;

    logConnection('error', 'Diagnóstico fallido', err.message);
    showToast(`Error al conectar con ${DIAGNOSTICS_URL}: ${err.message}`, 'error', 6000);
  }
}

/**
 * Renderiza la última lectura recibida en el inspector de diagnóstico
 */
function renderLatestReading(lr) {
  const emptyMsg = document.getElementById('latest-empty-msg');
  const details  = document.getElementById('latest-details');

  if (!lr) {
    emptyMsg.style.display = 'block';
    emptyMsg.textContent = 'Aún no hay ninguna lectura guardada en la base de datos MySQL.';
    details.style.display = 'none';
    return;
  }

  emptyMsg.style.display = 'none';
  details.style.display  = 'block';

  document.getElementById('lr-id').textContent     = `#${lr.id}`;
  document.getElementById('lr-sensor').textContent = lr.sensor_id;
  document.getElementById('lr-time').textContent   = lr.recorded_at;
  document.getElementById('lr-b').textContent      = `${fmt(lr.field_tesla)} T`;
  document.getElementById('lr-ut').textContent     = `${(lr.field_tesla * 1e6).toFixed(3)} µT`;
  document.getElementById('lr-vector').textContent = `[${fmt(lr.field_x)}, ${fmt(lr.field_y)}, ${fmt(lr.field_z)}]`;
  document.getElementById('lr-temp').textContent   = lr.temperature !== null ? `${lr.temperature} °C` : 'N/D';

  const rawEl = document.getElementById('lr-raw');
  try {
    const obj = typeof lr.raw_json === 'string' ? JSON.parse(lr.raw_json) : lr.raw_json;
    rawEl.textContent = JSON.stringify(obj, null, 2);
  } catch (_) {
    rawEl.textContent = lr.raw_json || 'Sin payload crudo';
  }
}

/**
 * Envía una lectura simulada al endpoint real api/readings
 */
async function sendTestReading() {
  const sensorId = document.getElementById('test-sensor-id').value.trim();
  const apiKey   = document.getElementById('test-api-key').value.trim();
  const bx       = parseFloat(document.getElementById('test-bx').value);
  const by       = parseFloat(document.getElementById('test-by').value);
  const bz       = parseFloat(document.getElementById('test-bz').value);
  const btInput  = parseFloat(document.getElementById('test-bt').value);
  const temp     = parseFloat(document.getElementById('test-temp').value);

  if (!sensorId) {
    showToast('Debes ingresar un Sensor ID para la prueba.', 'warn');
    return;
  }
  if (!apiKey) {
    showToast('Debes ingresar la X-API-Key para la prueba.', 'warn');
    return;
  }

  const payload = {
    sensor_id: sensorId,
    field_x: !isNaN(bx) ? bx : 0,
    field_y: !isNaN(by) ? by : 0,
    field_z: !isNaN(bz) ? bz : 0,
  };

  if (!isNaN(btInput)) {
    payload.field_tesla = btInput;
  }
  if (!isNaN(temp)) {
    payload.temperature = temp;
  }

  const resBox   = document.getElementById('test-send-result');
  const badge    = document.getElementById('test-res-badge');
  const timeEl   = document.getElementById('test-res-time');
  const payloadEl= document.getElementById('test-res-payload');

  resBox.style.display = 'block';
  badge.textContent = 'Enviando...';
  badge.className   = 'badge';
  payloadEl.textContent = 'Esperando respuesta del servidor...';

  showToast(`🚀 Enviando lectura de prueba para '${sensorId}'...`, 'info', 2500);
  logConnection('info', `Enviando lectura de prueba para '${sensorId}' a api/readings...`);
  const t0 = performance.now();

  try {
    const res = await fetch(READINGS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    const elapsed = Math.round(performance.now() - t0);
    timeEl.textContent = `${elapsed} ms`;
    badge.textContent = `HTTP ${res.status} ${res.statusText}`;

    badge.className = (res.status >= 200 && res.status < 300)
      ? 'badge badge-200'
      : 'badge badge-400';

    const text = await res.text();
    let jsonResp = null;
    try { jsonResp = JSON.parse(text); } catch (_) {}

    if (jsonResp) {
      payloadEl.textContent = JSON.stringify(jsonResp, null, 2);
    } else {
      payloadEl.textContent = text;
    }

    if (res.ok) {
      logConnection('success', `Lectura de prueba ACEPTADA por el servidor (ID: ${jsonResp?.data?.id ?? 'N/D'})`, jsonResp);
      showToast('¡Lectura de prueba guardada exitosamente en MySQL!', 'success');
      // Refrescar inmediatamente el inspector de última lectura
      runDiagnostics();
    } else {
      const errReason = jsonResp?.error || `HTTP ${res.status}`;
      logConnection('error', `El servidor RECHAZÓ la lectura de prueba (${errReason})`, jsonResp?.detail || text);
      showToast(`Servidor rechazó lectura (${errReason})`, 'error', 5000);
    }
  } catch (err) {
    const elapsed = Math.round(performance.now() - t0);
    timeEl.textContent = `${elapsed} ms`;
    badge.textContent = 'ERROR DE RED';
    badge.className = 'badge badge-500';
    payloadEl.textContent = `Error: ${err.message}\nNo se pudo establecer conexión HTTP con ${READINGS_URL}.`;
    logConnection('error', 'Fallo al enviar lectura de prueba', err.message);
    showToast(`Error al enviar: ${err.message}`, 'error', 5000);
  }
}

// ─── Listeners de diagnóstico ─────────────────────────────────────
document.getElementById('btn-run-diag')?.addEventListener('click', runDiagnostics);

document.getElementById('btn-refresh-latest')?.addEventListener('click', () => {
  runDiagnostics();
});

document.getElementById('btn-open-diag')?.addEventListener('click', () => {
  const sec = document.getElementById('diag-section');
  if (sec) {
    sec.scrollIntoView({ behavior: 'smooth' });
    runDiagnostics();
  }
});

document.getElementById('btn-send-test-reading')?.addEventListener('click', sendTestReading);

document.getElementById('btn-fill-random')?.addEventListener('click', () => {
  const rand = (min, max) => (Math.random() * (max - min) + min).toExponential(4);
  document.getElementById('test-bx').value = rand(-5e-5, 5e-5);
  document.getElementById('test-by').value = rand(-5e-5, 5e-5);
  document.getElementById('test-bz').value = rand(-5e-5, 5e-5);
  document.getElementById('test-temp').value = (20 + Math.random() * 12).toFixed(1);
  document.getElementById('test-bt').value = '';
  showToast('Valores aleatorios generados en el simulador.', 'info', 2000);
});

document.getElementById('btn-clear-console')?.addEventListener('click', () => {
  const c = document.getElementById('diag-console');
  if (c) c.innerHTML = '<div class="console-entry info">[SISTEMA] Consola limpiada por el usuario.</div>';
});

// ═══════════════════════════════════════════════════════════════════
//  TABS DE LEYES
// ═══════════════════════════════════════════════════════════════════
let currentLaw = 'biot-savart';
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t  => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    currentLaw = tab.dataset.law;
    document.getElementById(`panel-${currentLaw}`).classList.add('active');
    document.getElementById('result-box').classList.remove('show');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  LEYES FÍSICAS
// ═══════════════════════════════════════════════════════════════════
const v = id => parseFloat(document.getElementById(id).value);

function biotSavart() {
  const I = v('bs-I'), R = v('bs-R'), x = v('bs-x');
  if ([I, R, x].some(isNaN) || R <= 0) return { error: 'R debe ser > 0' };
  const B = (MU_0 * I * R * R) / (2 * Math.pow(R * R + x * x, 1.5));
  return {
    value: B, unit: 'T', label: 'Campo axial del lazo',
    detail: `µ₀=${MU_0.toExponential(2)}, I=${I} A, R=${R} m, x=${x} m → B=${fmt(B)} T (${(B * 1e6).toFixed(4)} µT)`
  };
}
function ampere() {
  const I = v('amp-I'), r = v('amp-r');
  if ([I, r].some(isNaN) || r <= 0) return { error: 'r debe ser > 0' };
  const B = (MU_0 * I) / (2 * Math.PI * r);
  return {
    value: B, unit: 'T', label: 'Campo a distancia r',
    detail: `I=${I} A, r=${r} m → B=${fmt(B)} T (${(B * 1e6).toFixed(4)} µT)`
  };
}
function solenoid() {
  const N = v('sol-N'), L = v('sol-L'), I = v('sol-I');
  if ([N, L, I].some(isNaN) || L <= 0) return { error: 'L debe ser > 0' };
  const B = MU_0 * (N / L) * I;
  return {
    value: B, unit: 'T', label: 'Campo interior de la solenoide',
    detail: `N=${N}, L=${L} m, I=${I} A → n=${(N / L).toFixed(1)} /m → B=${fmt(B)} T (${(B * 1e6).toFixed(4)} µT)`
  };
}
function toroid() {
  const N = v('tor-N'), r = v('tor-r'), I = v('tor-I');
  if ([N, r, I].some(isNaN) || r <= 0) return { error: 'r debe ser > 0' };
  const B = (MU_0 * N * I) / (2 * Math.PI * r);
  return {
    value: B, unit: 'T', label: 'Campo interior del toroide',
    detail: `N=${N}, r=${r} m, I=${I} A → B=${fmt(B)} T (${(B * 1e6).toFixed(4)} µT)`
  };
}
function faraday() {
  const B = v('far-B'), A = v('far-A'), theta = v('far-theta') * Math.PI / 180;
  const N = v('far-N'), dt = v('far-dt'), dB = v('far-dB');
  if ([B, A, theta, N, dt, dB].some(isNaN) || dt === 0) return { error: 'Δt debe ser ≠ 0' };
  const phi  = B * A * Math.cos(theta);
  const phi2 = (B + dB) * A * Math.cos(theta);
  const emf  = -N * (phi2 - phi) / dt;
  return {
    value: emf, unit: 'V', label: 'FEM inducida',
    detail: `Φ₁=${phi.toExponential(3)} Wb, Φ₂=${phi2.toExponential(3)} Wb → ε=${fmt(emf)} V`
  };
}
function lorentz() {
  const q = v('lor-q'), vel = v('lor-v'), B = v('lor-B'), theta = v('lor-theta') * Math.PI / 180;
  if ([q, vel, B, theta].some(isNaN)) return { error: 'Valores inválidos' };
  const F = Math.abs(q) * vel * B * Math.sin(theta);
  return {
    value: F, unit: 'N', label: 'Fuerza de Lorentz',
    detail: `q=${q.toExponential(2)} C, v=${vel.toExponential(2)} m/s, B=${fmt(B)} T, θ=${v('lor-theta')}° → F=${F.toExponential(3)} N`
  };
}

const calculators = { 'biot-savart': biotSavart, ampere, solenoid, toroid, faraday, lorentz };

document.getElementById('calc-btn').addEventListener('click', () => {
  const res = calculators[currentLaw]?.();
  if (!res) return;
  const box = document.getElementById('result-box');
  box.classList.add('show');
  if (res.error) {
    document.getElementById('result-title').textContent = '⚠ Error';
    document.getElementById('result-value').textContent = res.error;
    document.getElementById('result-value').style.color = '#f85149';
    document.getElementById('result-detail').textContent = '';
    return;
  }
  document.getElementById('result-value').style.color = '#3fb950';
  document.getElementById('result-title').textContent  = `✅ ${res.label}`;
  document.getElementById('result-value').textContent  = `${fmt(res.value)} ${res.unit}`;
  document.getElementById('result-detail').textContent = res.detail;
});

// ═══════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════
drawGauge(0);
setStatus(false, 'En espera del servidor...', true);
// 1. Cargar datos reales desde MySQL (sin simulación automática)
loadInitialReadings();
// 2. Ejecutar diagnóstico de conectividad inicial
setTimeout(runDiagnostics, 500);
