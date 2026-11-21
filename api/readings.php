<?php
// ══════════════════════════════════════════════════════════════════
// api/readings.php
//
// GET  ?sensor_id=&limit=200&offset=0&from=&to=&after_id=
//      → Devuelve lecturas con manejo de errores y validación
//
// POST (body JSON) + X-API-Key
//      → El ESP32 guarda una lectura con comprobaciones de integridad
// ══════════════════════════════════════════════════════════════════
require_once __DIR__ . '/_base.php';

$method = $_SERVER['REQUEST_METHOD'];

// ════════════════════════════════════════════
//  POST – ESP32 envía lectura
// ════════════════════════════════════════════
if ($method === 'POST') {
    $body = get_body();
    if (empty($body)) {
        json_error(
            'El cuerpo de la petición está vacío. Se requiere un objeto JSON con las mediciones.',
            400,
            ['ejemplo_esperado' => ['sensor_id' => 'ESP32-DEMO', 'field_tesla' => 0.00005, 'field_x' => 0, 'field_y' => 0, 'field_z' => 0]]
        );
    }

    $sensorId = trim($body['sensor_id'] ?? '');

    // Autenticar sensor (valida existencia, activo y API Key)
    auth_sensor($sensorId);

    // Extracción y validación de componentes vectoriales
    $bx = isset($body['field_x']) && is_numeric($body['field_x']) ? (float)$body['field_x'] : null;
    $by = isset($body['field_y']) && is_numeric($body['field_y']) ? (float)$body['field_y'] : null;
    $bz = isset($body['field_z']) && is_numeric($body['field_z']) ? (float)$body['field_z'] : null;

    // Magnitud total |B|
    if (isset($body['field_tesla']) && is_numeric($body['field_tesla'])) {
        $bt = (float)$body['field_tesla'];
    } elseif ($bx !== null && $by !== null && $bz !== null) {
        $bt = sqrt($bx**2 + $by**2 + $bz**2);
    } elseif ($bx !== null || $by !== null || $bz !== null) {
        $bt = sqrt(($bx ?? 0)**2 + ($by ?? 0)**2 + ($bz ?? 0)**2);
    } else {
        $bt = null;
    }

    if ($bt === null) {
        json_error(
            'No se proporcionó un valor de campo magnético válido.',
            422,
            "Debes enviar 'field_tesla' (número) o al menos uno de los componentes 'field_x', 'field_y', 'field_z'."
        );
    }

    $temp = isset($body['temperature']) && is_numeric($body['temperature']) ? (float)$body['temperature'] : null;
    $lat  = isset($body['latitude']) && is_numeric($body['latitude']) ? (float)$body['latitude'] : null;
    $lon  = isset($body['longitude']) && is_numeric($body['longitude']) ? (float)$body['longitude'] : null;
    $raw  = json_encode($body, JSON_UNESCAPED_UNICODE);

    try {
        $db = getDB();
        $st = $db->prepare(
            'INSERT INTO readings
               (sensor_id, field_tesla, field_x, field_y, field_z,
                temperature, latitude, longitude, raw_json)
             VALUES (?,?,?,?,?,?,?,?,?)'
        );
        $st->execute([$sensorId, $bt, $bx, $by, $bz, $temp, $lat, $lon, $raw]);
        $insertedId = (int)$db->lastInsertId();

        json_ok([
            'id'          => $insertedId,
            'sensor_id'   => $sensorId,
            'field_tesla' => $bt,
            'field_uT'    => round($bt * 1e6, 4),
            'server_time' => date('Y-m-d H:i:s'),
            'message'     => 'Lectura guardada exitosamente en la base de datos.'
        ], 201);
    } catch (PDOException $e) {
        if ($e->getCode() == 1146 || str_contains($e->getMessage(), "Table") || str_contains($e->getMessage(), "doesn't exist")) {
            json_error("La tabla 'readings' no existe en la base de datos. Importa 'schema_hosting.sql'.", 500, $e->getMessage());
        }
        json_error('Error al insertar la lectura en la base de datos.', 500, $e->getMessage());
    }
}

// ════════════════════════════════════════════
//  GET – Frontend obtiene lecturas
// ════════════════════════════════════════════
if ($method === 'GET') {
    $sensor   = isset($_GET['sensor_id']) && trim($_GET['sensor_id']) !== '' && $_GET['sensor_id'] !== 'all' ? trim($_GET['sensor_id']) : null;
    $limit    = min(max((int)($_GET['limit'] ?? 200), 1), 1000);
    $offset   = max((int)($_GET['offset'] ?? 0), 0);
    $from     = !empty($_GET['from']) ? trim($_GET['from']) : null;
    $to       = !empty($_GET['to']) ? trim($_GET['to']) : null;
    $afterId  = isset($_GET['after_id']) && is_numeric($_GET['after_id']) ? (int)$_GET['after_id'] : null;

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

    try {
        $db = getDB();
        $st = $db->prepare($sql);
        $st->execute($params);
        $rows = $st->fetchAll();

        // Si era paginación normal, invertir para orden cronológico
        if (!$afterId) {
            $rows = array_reverse($rows);
        }

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
    } catch (PDOException $e) {
        if ($e->getCode() == 1146 || str_contains($e->getMessage(), "Table") || str_contains($e->getMessage(), "doesn't exist")) {
            json_error("La tabla 'readings' no existe en la base de datos MySQL. Importa schema_hosting.sql.", 500, $e->getMessage());
        }
        json_error('Error al consultar lecturas en la base de datos.', 500, $e->getMessage());
    }
}

json_error('Método HTTP no permitido. Use GET o POST.', 405);
