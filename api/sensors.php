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
    try {
        $db = getDB();
        $st = $db->query(
            'SELECT sensor_id, name, location, firmware, active, created_at
             FROM sensors ORDER BY created_at ASC'
        );
        json_ok($st->fetchAll());
    } catch (PDOException $e) {
        if ($e->getCode() == 1146 || str_contains($e->getMessage(), "doesn't exist")) {
            json_error("La tabla 'sensors' no existe en la base de datos MySQL. Importa schema_hosting.sql.", 500, $e->getMessage());
        }
        json_error("Error al consultar la lista de sensores: " . $e->getMessage(), 500);
    }
}

if ($method === 'POST') {
    require_admin();
    $b = get_body();
    $sid = trim($b['sensor_id'] ?? '');
    $key = trim($b['api_key']   ?? '');

    if (empty($sid)) json_error("El campo 'sensor_id' es obligatorio.", 400);
    if (empty($key)) json_error("El campo 'api_key' es obligatorio.", 400);

    try {
        $db = getDB();
        $st = $db->prepare(
            'INSERT INTO sensors (sensor_id, name, location, firmware, api_key)
             VALUES (?,?,?,?,?)'
        );
        $st->execute([
            $sid,
            !empty($b['name']) ? trim($b['name']) : 'Sin nombre',
            $b['location'] ?? null,
            $b['firmware'] ?? null,
            $key,
        ]);
        json_ok(['sensor_id' => $sid, 'message' => "Sensor '{$sid}' registrado exitosamente."], 201);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000' || str_contains($e->getMessage(), 'Duplicate entry')) {
            json_error("El sensor_id '{$sid}' ya está registrado en la base de datos.", 409);
        }
        if ($e->getCode() == 1146 || str_contains($e->getMessage(), "doesn't exist")) {
            json_error("La tabla 'sensors' no existe en la base de datos. Importa schema_hosting.sql.", 500, $e->getMessage());
        }
        json_error('Error al registrar sensor: ' . $e->getMessage(), 500);
    }
}

json_error('Método HTTP no permitido. Use GET o POST.', 405);
