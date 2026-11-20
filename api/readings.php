<?php
// ══════════════════════════════════════════════════════════════════
// api/readings.php
//
// GET  ?sensor_id=&limit=200&offset=0&from=&to=&after_id=
//      → Devuelve lecturas (el frontend hace polling con after_id)
//
// POST (body JSON) + X-API-Key
//      → El ESP32 guarda una lectura
// ══════════════════════════════════════════════════════════════════
require_once __DIR__ . '/_base.php';

$method = $_SERVER['REQUEST_METHOD'];

// ════════════════════════════════════════════
//  POST – ESP32 envía lectura
// ════════════════════════════════════════════
if ($method === 'POST') {
    $body      = get_body();
    $sensorId  = trim($body['sensor_id'] ?? '');

    auth_sensor($sensorId);  // muere si no está autorizado

    $bx = isset($body['field_x']) ? (float)$body['field_x'] : null;
    $by = isset($body['field_y']) ? (float)$body['field_y'] : null;
    $bz = isset($body['field_z']) ? (float)$body['field_z'] : null;

    // Magnitud total
    $bt = isset($body['field_tesla'])
        ? (float)$body['field_tesla']
        : ($bx !== null ? sqrt($bx**2 + $by**2 + $bz**2) : null);

    if ($bt === null) json_error('Se requiere field_tesla o field_x/y/z', 422);

    $temp = isset($body['temperature']) ? (float)$body['temperature'] : null;
    $lat  = isset($body['latitude'])    ? (float)$body['latitude']    : null;
    $lon  = isset($body['longitude'])   ? (float)$body['longitude']   : null;
    $raw  = json_encode($body, JSON_UNESCAPED_UNICODE);

    $db = getDB();
    $st = $db->prepare(
        'INSERT INTO readings
           (sensor_id, field_tesla, field_x, field_y, field_z,
            temperature, latitude, longitude, raw_json)
         VALUES (?,?,?,?,?,?,?,?,?)'
    );
    $st->execute([$sensorId, $bt, $bx, $by, $bz, $temp, $lat, $lon, $raw]);
    json_ok(['id' => (int)$db->lastInsertId()], 201);
}

// ════════════════════════════════════════════
//  GET – Frontend obtiene lecturas
// ════════════════════════════════════════════
if ($method === 'GET') {
    $sensor   = $_GET['sensor_id'] ?? null;
    $limit    = min((int)($_GET['limit']  ?? 200), 1000);
    $offset   = (int)($_GET['offset'] ?? 0);
    $from     = $_GET['from']     ?? null;
    $to       = $_GET['to']       ?? null;
    $afterId  = isset($_GET['after_id']) ? (int)$_GET['after_id'] : null;

    $where  = ['1=1'];
    $params = [];

    if ($sensor)  { $where[] = 'sensor_id = ?';    $params[] = $sensor; }
    if ($from)    { $where[] = 'recorded_at >= ?';  $params[] = $from;   }
    if ($to)      { $where[] = 'recorded_at <= ?';  $params[] = $to;     }
    if ($afterId) { $where[] = 'id > ?';            $params[] = $afterId;}

    $sql = 'SELECT id, sensor_id, field_tesla, field_x, field_y, field_z,
                   temperature, recorded_at
            FROM readings
            WHERE ' . implode(' AND ', $where) . '
            ORDER BY ' . ($afterId ? 'id ASC' : 'recorded_at DESC') . '
            LIMIT ? OFFSET ?';

    $params[] = $limit;
    $params[] = $offset;

    $db = getDB();
    $st = $db->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll();

    // Si era paginación normal, invertir para orden cronológico
    if (!$afterId) $rows = array_reverse($rows);

    // Convertir campos numéricos
    foreach ($rows as &$r) {
        $r['id']          = (int)$r['id'];
        $r['field_tesla'] = (float)$r['field_tesla'];
        $r['field_x']     = $r['field_x'] !== null ? (float)$r['field_x'] : null;
        $r['field_y']     = $r['field_y'] !== null ? (float)$r['field_y'] : null;
        $r['field_z']     = $r['field_z'] !== null ? (float)$r['field_z'] : null;
        $r['temperature'] = $r['temperature'] !== null ? (float)$r['temperature'] : null;
    }

    json_ok(['count' => count($rows), 'rows' => $rows]);
}

json_error('Método no permitido', 405);
