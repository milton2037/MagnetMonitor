// ══════════════════════════════════════════════════════════════════
// server.js  –  MagnetMonitor Backend v2
//
// Endpoints:
//   POST /api/readings            ← ESP32 envía sus mediciones
//   GET  /api/readings            ← Frontend obtiene historial
//   GET  /api/readings/stats      ← Estadísticas por sensor
//   GET  /api/readings/export     ← Descarga CSV
//   GET  /api/sensors             ← Lista de sensores registrados
//   POST /api/sensors             ← Registrar nuevo sensor (admin)
//   GET  /api/events              ← Server-Sent Events (tiempo real)
// ══════════════════════════════════════════════════════════════════
'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const pool    = require('./db');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// ─── Clientes SSE conectados ──────────────────────────────────────
const sseClients = new Set();

// ── Middleware ────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Permite requests sin origen (curl, Postman, ESP32) y orígenes listados
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS bloqueado para: ${origin}`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key'],
}));

app.use(express.json({ limit: '64kb' }));

// Sirve el frontend directamente desde /
app.use(express.static(path.join(__dirname, '..')));

// ─── Helpers ─────────────────────────────────────────────────────
function sendError(res, status, message) {
  return res.status(status).json({ ok: false, error: message });
}

/** Calcula la magnitud del vector a partir de x,y,z si no viene field_tesla */
function magnitude(x, y, z) {
  if (x == null && y == null && z == null) return null;
  return Math.sqrt((x||0)**2 + (y||0)**2 + (z||0)**2);
}

/** Difunde un evento a todos los clientes SSE conectados */
function broadcastSSE(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => {
    try { res.write(payload); } catch (_) { sseClients.delete(res); }
  });
}

// ── Middleware de autenticación de sensor ─────────────────────────
async function authSensor(req, res, next) {
  const apiKey   = req.headers['x-api-key'];
  const sensorId = req.body?.sensor_id || req.query?.sensor_id;

  if (!apiKey)    return sendError(res, 401, 'Falta X-API-Key');
  if (!sensorId)  return sendError(res, 400, 'Falta sensor_id');

  try {
    const [rows] = await pool.query(
      'SELECT sensor_id FROM sensors WHERE sensor_id = ? AND api_key = ? AND active = 1',
      [sensorId, apiKey]
    );
    if (!rows.length) return sendError(res, 403, 'Sensor no autorizado o inactivo');
    req.sensorId = sensorId;
    next();
  } catch (err) {
    console.error('[authSensor]', err);
    sendError(res, 500, 'Error de base de datos');
  }
}

/** Autenticación de administrador para endpoints de gestión */
function authAdmin(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== process.env.ADMIN_KEY) return sendError(res, 403, 'No autorizado');
  next();
}

// ════════════════════════════════════════════════════════════════
//  RUTAS – ESP32
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/readings
 * Payload JSON del ESP32:
 * {
 *   "sensor_id":   "ESP32-LAB1",
 *   "field_tesla":  0.0000512,          // magnitud |B| (opcional si envía xyz)
 *   "field_x":     -0.0000312,          // componente X (opcional)
 *   "field_y":      0.0000418,          // componente Y (opcional)
 *   "field_z":      0.0000198,          // componente Z (opcional)
 *   "temperature":  24.5,               // °C (opcional)
 *   "latitude":     4.6097,             // GPS (opcional)
 *   "longitude":   -74.0817             // GPS (opcional)
 * }
 */
app.post('/api/readings', authSensor, async (req, res) => {
  const {
    field_tesla, field_x, field_y, field_z,
    temperature, latitude, longitude,
  } = req.body;

  // Calcular magnitud si no viene explícita
  const finalTesla = field_tesla ?? magnitude(field_x, field_y, field_z);
  if (finalTesla == null || isNaN(finalTesla)) {
    return sendError(res, 422, 'Se requiere field_tesla o al menos field_x/y/z');
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO readings
         (sensor_id, field_tesla, field_x, field_y, field_z, temperature, latitude, longitude, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.sensorId,
        finalTesla,
        field_x     ?? null,
        field_y     ?? null,
        field_z     ?? null,
        temperature ?? null,
        latitude    ?? null,
        longitude   ?? null,
        JSON.stringify(req.body),
      ]
    );

    const reading = {
      id:          result.insertId,
      sensor_id:   req.sensorId,
      field_tesla: finalTesla,
      field_x, field_y, field_z,
      temperature,
      recorded_at: new Date().toISOString(),
    };

    // Difundir a clientes SSE en tiempo real
    broadcastSSE({ type: 'reading', data: reading });

    res.status(201).json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error('[POST /api/readings]', err);
    sendError(res, 500, 'Error al insertar lectura');
  }
});

// ════════════════════════════════════════════════════════════════
//  RUTAS – Frontend
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/readings
 * Query params: sensor_id, limit (default 200), offset, from, to
 */
app.get('/api/readings', async (req, res) => {
  const { sensor_id, limit = 200, offset = 0, from, to } = req.query;
  const lim = Math.min(parseInt(limit, 10) || 200, 1000);
  const off = parseInt(offset, 10) || 0;

  let sql  = 'SELECT id, sensor_id, field_tesla, field_x, field_y, field_z, temperature, recorded_at FROM readings WHERE 1=1';
  const params = [];

  if (sensor_id) { sql += ' AND sensor_id = ?'; params.push(sensor_id); }
  if (from)      { sql += ' AND recorded_at >= ?'; params.push(from); }
  if (to)        { sql += ' AND recorded_at <= ?'; params.push(to); }

  sql += ' ORDER BY recorded_at DESC LIMIT ? OFFSET ?';
  params.push(lim, off);

  try {
    const [rows] = await pool.query(sql, params);
    res.json({ ok: true, count: rows.length, data: rows.reverse() });
  } catch (err) {
    console.error('[GET /api/readings]', err);
    sendError(res, 500, 'Error de consulta');
  }
});

/**
 * GET /api/readings/stats
 */
app.get('/api/readings/stats', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM v_sensor_stats');
    res.json({ ok: true, data: rows });
  } catch (err) {
    sendError(res, 500, 'Error de estadísticas');
  }
});

/**
 * GET /api/readings/export  → CSV descargable
 */
app.get('/api/readings/export', async (req, res) => {
  const { sensor_id, from, to } = req.query;
  let sql = 'SELECT id, sensor_id, field_tesla, field_x, field_y, field_z, temperature, recorded_at FROM readings WHERE 1=1';
  const params = [];
  if (sensor_id) { sql += ' AND sensor_id = ?'; params.push(sensor_id); }
  if (from)      { sql += ' AND recorded_at >= ?'; params.push(from); }
  if (to)        { sql += ' AND recorded_at <= ?'; params.push(to); }
  sql += ' ORDER BY recorded_at ASC LIMIT 100000';

  try {
    const [rows] = await pool.query(sql, params);
    const header = 'id,sensor_id,recorded_at,field_tesla,field_uT,field_x,field_y,field_z,temperature\n';
    const csv = rows.map(r =>
      `${r.id},${r.sensor_id},${new Date(r.recorded_at).toISOString()},` +
      `${r.field_tesla},${(r.field_tesla*1e6).toFixed(4)},` +
      `${r.field_x??''},${r.field_y??''},${r.field_z??''},${r.temperature??''}`
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="magnetmonitor_${Date.now()}.csv"`);
    res.send(header + csv);
  } catch (err) {
    sendError(res, 500, 'Error al exportar');
  }
});

/**
 * GET /api/sensors
 */
app.get('/api/sensors', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT sensor_id, name, location, firmware, active, created_at FROM sensors ORDER BY created_at'
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    sendError(res, 500, 'Error al listar sensores');
  }
});

/**
 * POST /api/sensors  (admin)
 * Body: { sensor_id, name, location, firmware, api_key }
 */
app.post('/api/sensors', authAdmin, async (req, res) => {
  const { sensor_id, name, location, firmware, api_key } = req.body;
  if (!sensor_id || !api_key) return sendError(res, 400, 'Faltan sensor_id y api_key');

  try {
    await pool.query(
      'INSERT INTO sensors (sensor_id, name, location, firmware, api_key) VALUES (?,?,?,?,?)',
      [sensor_id, name||'Sin nombre', location||null, firmware||null, api_key]
    );
    res.status(201).json({ ok: true, sensor_id });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return sendError(res, 409, 'sensor_id ya existe');
    sendError(res, 500, 'Error al crear sensor');
  }
});

// ════════════════════════════════════════════════════════════════
//  Server-Sent Events  (GET /api/events)
// ════════════════════════════════════════════════════════════════
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // Para Nginx
  res.flushHeaders();

  // Enviar latido cada 20 s para mantener la conexión
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (_) {}
  }, 20_000);

  sseClients.add(res);
  console.log(`[SSE] Cliente conectado. Total: ${sseClients.size}`);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    console.log(`[SSE] Cliente desconectado. Total: ${sseClients.size}`);
  });
});

// ─── Ruta catch-all → frontend ───────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ─── Iniciar servidor ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🧲  MagnetMonitor Backend corriendo en http://localhost:${PORT}`);
  console.log(`    POST /api/readings  ← ESP32`);
  console.log(`    GET  /api/events    ← SSE tiempo real`);
  console.log(`    GET  /api/readings  ← historial\n`);
});
