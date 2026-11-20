/* ══════════════════════════════════════════
   MagnetMonitor v2 – script.js
   Modo real: SSE + REST API del backend Node.js
   Modo demo: simulación local como fallback
   ══════════════════════════════════════════ */

// ─── Constantes físicas ─────────────────────────────────────────
const MU_0 = 4 * Math.PI * 1e-7;

// ─── Configuración de la API ─────────────────────────────────────
// En producción: 'https://miltonguerrero.rf.gd'
// En local/dev:  '' (mismo origen si el backend corre local)
const API_BASE = (() => {
  const h = window.location.hostname;
  if (h === 'miltonguerrero.rf.gd') return 'https://miltonguerrero.rf.gd';
  if (h === 'localhost' || h === '127.0.0.1') return '';
  return '';  // ajusta si usas otro host
})();

const READINGS_URL = `${API_BASE}/api/readings.php`;
const SENSORS_URL  = `${API_BASE}/api/sensors.php`;
const EXPORT_URL   = `${API_BASE}/api/export.php`;

// Polling cada 2 segundos (reemplaza SSE para hosting compartido PHP)
const POLL_INTERVAL_MS = 2000;

// ─── Estado global ───────────────────────────────────────────────
let readings      = [];
let simRunning    = false;
let simInterval   = null;
let pollInterval  = null;   // polling PHP API
let chartWindowSec = 60;
let rowIndex      = 0;
let useRealData   = false;
let currentSensor = 'all';
let lastReadingId = 0;      // para polling incremental (after_id)
let eventSource   = null;   // mantenido por compatibilidad, no usado en PHP mode

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
          label: c => ` ${fmt(c.raw)} T  (${(c.raw*1e6).toFixed(4)} µT)`
        }
      }
    },
    scales: {
      x: { ticks: { color: '#8b949e', maxTicksLimit: 8, maxRotation: 0 }, grid: { color: '#21262d' } },
      y: { ticks: { color: '#8b949e', callback: v => fmt(v)+' T' },      grid: { color: '#21262d' } }
    }
  }
});

// ═══════════════════════════════════════════════════════════════════
//  GAUGE
// ═══════════════════════════════════════════════════════════════════
const gaugeCtx = document.getElementById('gauge-canvas').getContext('2d');
function drawGauge(fraction) {
  const W=160, H=90, cx=W/2, cy=H-10, r=65;
  gaugeCtx.clearRect(0,0,W,H);
  gaugeCtx.beginPath(); gaugeCtx.arc(cx,cy,r,Math.PI,2*Math.PI);
  gaugeCtx.lineWidth=14; gaugeCtx.strokeStyle='#21262d'; gaugeCtx.stroke();
  const clamp = Math.min(1,Math.max(0,fraction));
  const angle = Math.PI + clamp*Math.PI;
  gaugeCtx.beginPath(); gaugeCtx.arc(cx,cy,r,Math.PI,angle);
  gaugeCtx.strokeStyle = clamp<0.5?'#3fb950':clamp<0.8?'#d29922':'#f85149'; gaugeCtx.stroke();
  const nx=cx+(r-7)*Math.cos(angle), ny=cy+(r-7)*Math.sin(angle);
  gaugeCtx.beginPath(); gaugeCtx.moveTo(cx,cy); gaugeCtx.lineTo(nx,ny);
  gaugeCtx.lineWidth=2.5; gaugeCtx.strokeStyle='#fff'; gaugeCtx.stroke();
}

// ═══════════════════════════════════════════════════════════════════
//  FORMATO / UTILIDADES
// ═══════════════════════════════════════════════════════════════════
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a === 0)    return '0';
  if (a >= 1)     return n.toFixed(4);
  return n.toExponential(3);
}
function level(uT) {
  if (uT < 60)  return { label:'Normal', cls:'level-low'    };
  if (uT < 100) return { label:'Medio',  cls:'level-medium' };
  return                { label:'Alto',   cls:'level-high'   };
}
function nowStr() {
  return new Date().toLocaleTimeString('es', { hour12:false });
}

// ═══════════════════════════════════════════════════════════════════
//  ACTUALIZAR MÉTRICAS + CHART + LOG
// ═══════════════════════════════════════════════════════════════════
function updateMetrics() {
  if (!readings.length) return;
  const vals = readings.map(r => r.value);
  const cur  = vals[vals.length-1];
  const mx   = Math.max(...vals);
  const mn   = Math.min(...vals);
  const avg  = vals.reduce((a,b)=>a+b,0) / vals.length;
  document.getElementById('val-current').textContent = fmt(cur)+' T';
  document.getElementById('val-max').textContent     = fmt(mx) +' T';
  document.getElementById('val-min').textContent     = fmt(mn) +' T';
  document.getElementById('val-avg').textContent     = fmt(avg)+' T';
  drawGauge(cur / 200e-6);
  document.getElementById('gauge-label').textContent = (cur*1e6).toFixed(2)+' µT';
}

function updateChart() {
  const now    = Date.now();
  const cutoff = now - chartWindowSec * 1000;
  const slice  = readings.filter(r => r.time >= cutoff);
  chart.data.labels              = slice.map(r => new Date(r.time).toLocaleTimeString('es',{hour12:false}));
  chart.data.datasets[0].data   = slice.map(r => r.value);
  chart.data.datasets[1].data   = slice.map(r => r.bx ?? null);
  chart.data.datasets[2].data   = slice.map(r => r.by ?? null);
  chart.data.datasets[3].data   = slice.map(r => r.bz ?? null);
  chart.update();
}

function addLogRow(r) {
  rowIndex++;
  const uT  = r.value * 1e6;
  const lv  = level(uT);
  const tbody = document.getElementById('log-body');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${rowIndex}</td>
    <td>${r.sensorId || '—'}</td>
    <td>${new Date(r.time).toLocaleTimeString('es',{hour12:false})}</td>
    <td style="font-family:monospace">${fmt(r.value)}</td>
    <td style="font-family:monospace">${uT.toFixed(3)}</td>
    <td class="${lv.cls}">${lv.label}</td>
  `;
  tbody.insertBefore(tr, tbody.firstChild);
  while (tbody.rows.length > 300) tbody.deleteRow(tbody.rows.length-1);
  applyFilter();
}

// ═══════════════════════════════════════════════════════════════════
//  INGESTAR UNA LECTURA (desde SSE, polling o simulador)
// ═══════════════════════════════════════════════════════════════════
function ingestReading(r) {
  readings.push(r);
  if (readings.length > 5000) readings.shift();
  updateMetrics();
  updateChart();
  addLogRow(r);
}

// ═══════════════════════════════════════════════════════════════════
//  POLLING  (reemplaza SSE – compatible con hosting PHP compartido)
// ═══════════════════════════════════════════════════════════════════
async function pollNewReadings() {
  if (!useRealData) return;
  try {
    const qs  = new URLSearchParams({ limit: 50, after_id: lastReadingId });
    if (currentSensor !== 'all') qs.set('sensor_id', currentSensor);
    const res  = await fetch(`${READINGS_URL}?${qs}`, { signal: AbortSignal.timeout(4000) });
    const json = await res.json();
    if (!json.ok || !json.data.rows.length) return;

    json.data.rows.forEach(d => {
      lastReadingId = Math.max(lastReadingId, d.id);
      ingestReading({
        time:     new Date(d.recorded_at).getTime(),
        value:    d.field_tesla,
        bx:       d.field_x,
        by:       d.field_y,
        bz:       d.field_z,
        sensorId: d.sensor_id,
      });
    });
  } catch (_) { /* silencioso – el servidor puede tardar */ }
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
//  CONEXIÓN INICIAL (carga historial + arranca polling)
// ═══════════════════════════════════════════════════════════════════
async function loadInitialReadings() {
  try {
    const qs = new URLSearchParams({ limit: 200 });
    if (currentSensor !== 'all') qs.set('sensor_id', currentSensor);
    const res  = await fetch(`${READINGS_URL}?${qs}`, { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    if (!json.ok || !json.data.rows.length) return;

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
      });
    });

    readings.forEach(r => addLogRow(r));
    updateMetrics();
    updateChart();
    setStatus(true, 'En vivo · miltonguerrero.rf.gd', false);

    loadSensors();
    startPolling();   // 🔄 polling cada 2 s en lugar de SSE
  } catch (err) {
    console.info('[API] Backend PHP no disponible. Modo simulación.', err.message);
    setStatus(true, 'Simulando (sin backend)', false);
    startSim();
  }
}

// ═══════════════════════════════════════════════════════════════════
//  SELECTOR DE SENSOR
// ═══════════════════════════════════════════════════════════════════
async function loadSensors() {
  try {
    const res  = await fetch(SENSORS_URL, { signal: AbortSignal.timeout(3000) });
    const json = await res.json();

    const sel = document.getElementById('sensor-filter');
    sel.innerHTML = '<option value="all">Todos los sensores</option>';
    json.data.forEach(s => {      const opt = document.createElement('option');
      opt.value = s.sensor_id;
      opt.textContent = `${s.name} (${s.sensor_id})`;
      sel.appendChild(opt);
    });
    sel.style.display = '';
  } catch (_) {}
}

document.getElementById('sensor-filter')?.addEventListener('change', e => {
  currentSensor = e.target.value;
  clearChart();
  loadInitialReadings();
});

// ═══════════════════════════════════════════════════════════════════
//  SIMULADOR BROWNIANO (fallback sin hardware)
// ═══════════════════════════════════════════════════════════════════
let simPhase = 0;
let brownianB = 50e-6;

function simulateReading() {
  simPhase += 0.12;
  const sinC  = 20e-6 * Math.sin(simPhase);
  const noise = (Math.random()-0.5) * 10e-6;
  brownianB  += (Math.random()-0.5) * 2e-6;
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
  simInterval = setInterval(() => ingestReading(simulateReading()), 1000);
  simRunning  = true;
  setStatus(true, 'Simulando…', false);
  document.getElementById('toggle-sim-btn').textContent = '⏸ Pausar';
}
function stopSim() {
  clearInterval(simInterval);
  simRunning  = false;
  setStatus(false, 'Pausado', true);
  document.getElementById('toggle-sim-btn').textContent = '▶ Reanudar';
}

document.getElementById('toggle-sim-btn').addEventListener('click', () => {
  // Backend PHP real → pausar/reanudar polling
  if (useRealData) {
    if (pollInterval) {
      stopPolling();
      setStatus(false, 'Pausado', true);
      document.getElementById('toggle-sim-btn').textContent = '▶ Reanudar';
    } else {
      startPolling();
      setStatus(true, 'En vivo · miltonguerrero.rf.gd', false);
      document.getElementById('toggle-sim-btn').textContent = '⏸ Pausar';
    }
    return;
  }
  simRunning ? stopSim() : startSim();
});

// ═══════════════════════════════════════════════════════════════════
//  CONTROLES
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
  ['val-current','val-max','val-min','val-avg'].forEach(id => {
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
    // Descargar desde backend PHP
    const qs = new URLSearchParams();
    if (currentSensor !== 'all') qs.set('sensor_id', currentSensor);
    window.open(`${EXPORT_URL}?${qs}`, '_blank');
    return;
  }
  // Exportar datos simulados localmente
  const rows = ['timestamp,sensor_id,B_T,B_uT,Bx_T,By_T,Bz_T'];
  readings.forEach(r => {
    rows.push(`${new Date(r.time).toISOString()},${r.sensorId||'SIM'},` +
      `${r.value.toExponential(6)},${(r.value*1e6).toFixed(4)},` +
      `${(r.bx??0).toExponential(4)},${(r.by??0).toExponential(4)},${(r.bz??0).toExponential(4)}`);
  });
  const blob = new Blob([rows.join('\n')], { type:'text/csv' });
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
  const I=v('bs-I'), R=v('bs-R'), x=v('bs-x');
  if ([I,R,x].some(isNaN)||R<=0) return { error:'R debe ser > 0' };
  const B = (MU_0*I*R*R) / (2*Math.pow(R*R+x*x,1.5));
  return { value:B, unit:'T', label:'Campo axial del lazo',
    detail:`µ₀=${MU_0.toExponential(2)}, I=${I} A, R=${R} m, x=${x} m → B=${fmt(B)} T (${(B*1e6).toFixed(4)} µT)` };
}
function ampere() {
  const I=v('amp-I'), r=v('amp-r');
  if ([I,r].some(isNaN)||r<=0) return { error:'r debe ser > 0' };
  const B = (MU_0*I)/(2*Math.PI*r);
  return { value:B, unit:'T', label:'Campo a distancia r',
    detail:`I=${I} A, r=${r} m → B=${fmt(B)} T (${(B*1e6).toFixed(4)} µT)` };
}
function solenoid() {
  const N=v('sol-N'), L=v('sol-L'), I=v('sol-I');
  if ([N,L,I].some(isNaN)||L<=0) return { error:'L debe ser > 0' };
  const B = MU_0*(N/L)*I;
  return { value:B, unit:'T', label:'Campo interior de la solenoide',
    detail:`N=${N}, L=${L} m, I=${I} A → n=${(N/L).toFixed(1)} /m → B=${fmt(B)} T (${(B*1e6).toFixed(4)} µT)` };
}
function toroid() {
  const N=v('tor-N'), r=v('tor-r'), I=v('tor-I');
  if ([N,r,I].some(isNaN)||r<=0) return { error:'r debe ser > 0' };
  const B = (MU_0*N*I)/(2*Math.PI*r);
  return { value:B, unit:'T', label:'Campo interior del toroide',
    detail:`N=${N}, r=${r} m, I=${I} A → B=${fmt(B)} T (${(B*1e6).toFixed(4)} µT)` };
}
function faraday() {
  const B=v('far-B'), A=v('far-A'), theta=v('far-theta')*Math.PI/180;
  const N=v('far-N'), dt=v('far-dt'), dB=v('far-dB');
  if ([B,A,theta,N,dt,dB].some(isNaN)||dt===0) return { error:'Δt debe ser ≠ 0' };
  const phi  = B*A*Math.cos(theta);
  const phi2 = (B+dB)*A*Math.cos(theta);
  const emf  = -N*(phi2-phi)/dt;
  return { value:emf, unit:'V', label:'FEM inducida',
    detail:`Φ₁=${phi.toExponential(3)} Wb, Φ₂=${phi2.toExponential(3)} Wb → ε=${fmt(emf)} V` };
}
function lorentz() {
  const q=v('lor-q'), vel=v('lor-v'), B=v('lor-B'), theta=v('lor-theta')*Math.PI/180;
  if ([q,vel,B,theta].some(isNaN)) return { error:'Valores inválidos' };
  const F = Math.abs(q)*vel*B*Math.sin(theta);
  return { value:F, unit:'N', label:'Fuerza de Lorentz',
    detail:`q=${q.toExponential(2)} C, v=${vel.toExponential(2)} m/s, B=${fmt(B)} T, θ=${v('lor-theta')}° → F=${F.toExponential(3)} N` };
}

const calculators = { 'biot-savart':biotSavart, ampere, solenoid, toroid, faraday, lorentz };

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
//  INICIO
// ═══════════════════════════════════════════════════════════════════
drawGauge(0);
// Arrancar simulación de placeholder mientras se contacta el backend
startSim();
// Intentar conectar al backend PHP; si responde, reemplaza la simulación
loadInitialReadings();
