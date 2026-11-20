<?php
// ══════════════════════════════════════════════════════════════════
// api/sensors.php
//
// GET  → Lista sensores activos
// POST + X-API-Key admin → Registrar nuevo sensor
// ══════════════════════════════════════════════════════════════════
require_once __DIR__ . '/_base.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $db = getDB();
    $st = $db->query(
        'SELECT sensor_id, name, location, firmware, active, created_at
         FROM sensors ORDER BY created_at'
    );
    json_ok($st->fetchAll());
}

if ($method === 'POST') {
    require_admin();
    $b = get_body();
    $sid = trim($b['sensor_id'] ?? '');
    $key = trim($b['api_key']   ?? '');
    if (!$sid || !$key) json_error('Faltan sensor_id y api_key');

    $db = getDB();
    try {
        $st = $db->prepare(
            'INSERT INTO sensors (sensor_id, name, location, firmware, api_key)
             VALUES (?,?,?,?,?)'
        );
        $st->execute([
            $sid,
            $b['name']     ?? 'Sin nombre',
            $b['location'] ?? null,
            $b['firmware'] ?? null,
            $key,
        ]);
        json_ok(['sensor_id' => $sid], 201);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') json_error('sensor_id ya existe', 409);
        json_error('Error de BD: ' . $e->getMessage(), 500);
    }
}

json_error('Método no permitido', 405);
