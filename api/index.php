<?php
// ══════════════════════════════════════════════════════════════════
// api/index.php  –  Front Controller / Router API REST para MagnetMonitor
// Compatible 100% con hosting compartido Apache/InfinityFree
//
// Endpoints soportados:
//   POST /api/sensors/register      → Registrar un ESP32
//   GET  /api/sensors               → Listar dispositivos registrados
//   GET  /api/sensors/{id}/stats    → Consultar estadísticas de un sensor
//   GET  /api/sensors/{id}/latest   → Obtener última medición de un sensor
//   POST /api/readings              → Recibir medición desde el ESP32
//   GET  /api/readings              → Consultar históricos con filtros
//   GET  /api/readings/export       → Exportar mediciones en CSV
//   GET  /api/diagnostics           → Diagnóstico de salud (PHP, MySQL, tablas)
//   POST /api/diagnostics           → Echo test para depuración
// ══════════════════════════════════════════════════════════════════
require_once __DIR__ . '/_base.php';

// ── Determinar Método HTTP y Ruta Solicitada ─────────────────────
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$uri    = $_SERVER['REQUEST_URI'] ?? '/';

// Remover query string (?foo=bar)
if (($pos = strpos($uri, '?')) !== false) {
    $uri = substr($uri, 0, $pos);
}

// Extraer el path relativo a /api
// Maneja casos como /api/readings, /MONITOR-MAGNETICO/api/readings, etc.
$apiPos = strpos($uri, '/api');
if ($apiPos !== false) {
    $route = substr($uri, $apiPos + 4); // después de "/api"
} else {
    // Si se pasa como query parameter: index.php?route=/sensors/register
    $route = $_GET['route'] ?? '/';
}

$route = '/' . trim($route, '/');
if (empty($route) || $route === '/') {
    // Si llaman a /api o /api/ directamente, mostrar documentación y estado
    json_ok([
        'api'         => 'MagnetMonitor REST API v2.5',
        'status'      => 'online',
        'server_time' => date('Y-m-d H:i:s'),
        'endpoints'   => [
            'POST /api/sensors/register'    => 'Registrar nuevo sensor ESP32 (requiere X-API-Key admin)',
            'GET  /api/sensors'             => 'Listar todos los sensores registrados',
            'GET  /api/sensors/{id}/stats'  => 'Estadísticas acumuladas de un sensor específico',
            'GET  /api/sensors/{id}/latest' => 'Última medición registrada para un sensor',
            'POST /api/readings'            => 'Ingestar medición enviada por ESP32 (requiere X-API-Key sensor)',
            'GET  /api/readings'            => 'Histórico de lecturas con filtros (?sensor_id=&limit=&after_id=)',
            'GET  /api/readings/export'     => 'Descarga CSV de mediciones',
            'GET  /api/diagnostics'         => 'Diagnóstico completo de PHP, MySQL y tablas',
        ]
    ]);
}

// ══════════════════════════════════════════════════════════════════
//  ENRUTAMIENTO REST
// ══════════════════════════════════════════════════════════════════

// ── 1. POST /api/sensors/register  (o POST /api/sensors) ────────
if ($method === 'POST' && ($route === '/sensors/register' || $route === '/sensors')) {
    require_admin();
    $b   = get_body();
    $sid = trim($b['sensor_id'] ?? '');
    $key = trim($b['api_key']   ?? '');

    if (empty($sid)) json_error("El campo 'sensor_id' es obligatorio.", 400);
    if (empty($key)) json_error("El campo 'api_key' es obligatorio.", 400);

    try {
        $db = getDB();
        $st = $db->prepare(
            'INSERT INTO sensors (sensor_id, name, location, firmware, api_key)
             VALUES (?, ?, ?, ?, ?)'
        );
        $st->execute([
            $sid,
            !empty($b['name']) ? trim($b['name']) : 'Sin nombre',
            $b['location'] ?? null,
            $b['firmware'] ?? null,
            $key,
        ]);

        json_ok([
            'sensor_id' => $sid,
            'message'   => "Sensor '{$sid}' registrado exitosamente en la base de datos."
        ], 201);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000' || str_contains($e->getMessage(), 'Duplicate entry')) {
            json_error("El sensor_id '{$sid}' ya se encuentra registrado.", 409);
        }
        if ($e->getCode() == 1146 || str_contains($e->getMessage(), "doesn't exist")) {
            json_error("La tabla 'sensors' no existe en MySQL. Importa schema_hosting.sql.", 500, $e->getMessage());
        }
        json_error('Error al registrar sensor: ' . $e->getMessage(), 500);
    }
}

// ── 2. GET /api/sensors/{id}/stats ───────────────────────────────
if ($method === 'GET' && preg_match('#^/sensors/([^/]+)/stats$#', $route, $matches)) {
    $sensorId = urldecode($matches[1]);
    try {
        $db = getDB();

        // Verificar si el sensor existe
        $stCheck = $db->prepare('SELECT sensor_id, name, location, active, created_at FROM sensors WHERE sensor_id = ?');
        $stCheck->execute([$sensorId]);
        $sensorInfo = $stCheck->fetch();

        if (!$sensorInfo) {
            json_error("Sensor con ID '{$sensorId}' no encontrado.", 404);
        }

        // Consultar estadísticas directamente de readings
        $stStats = $db->prepare(
            'SELECT
                COUNT(*)                           AS total_readings,
                ROUND(AVG(field_tesla) * 1e6, 4)   AS avg_uT,
                ROUND(MAX(field_tesla) * 1e6, 4)   AS max_uT,
                ROUND(MIN(field_tesla) * 1e6, 4)   AS min_uT,
                ROUND(AVG(temperature), 2)         AS avg_temp,
                MAX(recorded_at)                   AS last_seen
             FROM readings
             WHERE sensor_id = ?'
        );
        $stStats->execute([$sensorId]);
        $stats = $stStats->fetch();

        json_ok([
            'sensor' => $sensorInfo,
            'stats'  => [
                'total_readings' => (int)($stats['total_readings'] ?? 0),
                'avg_uT'         => $stats['avg_uT'] !== null ? (float)$stats['avg_uT'] : null,
                'max_uT'         => $stats['max_uT'] !== null ? (float)$stats['max_uT'] : null,
                'min_uT'         => $stats['min_uT'] !== null ? (float)$stats['min_uT'] : null,
                'avg_temp_c'     => $stats['avg_temp'] !== null ? (float)$stats['avg_temp'] : null,
                'last_seen'      => $stats['last_seen'],
            ]
        ]);
    } catch (PDOException $e) {
        json_error("Error al consultar estadísticas del sensor '{$sensorId}': " . $e->getMessage(), 500);
    }
}

// ── 3. GET /api/sensors/{id}/latest ──────────────────────────────
if ($method === 'GET' && preg_match('#^/sensors/([^/]+)/latest$#', $route, $matches)) {
    $sensorId = urldecode($matches[1]);
    try {
        $db = getDB();

        $st = $db->prepare(
            'SELECT id, sensor_id, field_tesla, field_x, field_y, field_z,
                    temperature, latitude, longitude, recorded_at, raw_json
             FROM readings
             WHERE sensor_id = ?
             ORDER BY id DESC
             LIMIT 1'
        );
        $st->execute([$sensorId]);
        $latest = $st->fetch();

        if (!$latest) {
            json_ok([
                'sensor_id' => $sensorId,
                'has_data'  => false,
                'message'   => "No hay mediciones registradas para el sensor '{$sensorId}'."
            ]);
        }

        $latest['id']          = (int)$latest['id'];
        $latest['field_tesla'] = (float)$latest['field_tesla'];
        $latest['field_uT']    = round($latest['field_tesla'] * 1e6, 4);
        $latest['field_x']     = $latest['field_x'] !== null ? (float)$latest['field_x'] : null;
        $latest['field_y']     = $latest['field_y'] !== null ? (float)$latest['field_y'] : null;
        $latest['field_z']     = $latest['field_z'] !== null ? (float)$latest['field_z'] : null;
        $latest['temperature'] = $latest['temperature'] !== null ? (float)$latest['temperature'] : null;
        $latest['has_data']    = true;

        $parsedRaw = json_decode($latest['raw_json'] ?? '', true);
        $latest['raw_json_parsed'] = $parsedRaw ?: $latest['raw_json'];

        json_ok($latest);
    } catch (PDOException $e) {
        json_error("Error al consultar última medición del sensor '{$sensorId}': " . $e->getMessage(), 500);
    }
}

// ── 4. GET /api/sensors  (Listar dispositivos) ───────────────────
if ($method === 'GET' && $route === '/sensors') {
    try {
        $db = getDB();
        $st = $db->query(
            'SELECT sensor_id, name, location, firmware, active, created_at
             FROM sensors
             ORDER BY created_at ASC'
        );
        json_ok($st->fetchAll());
    } catch (PDOException $e) {
        json_error("Error al listar sensores: " . $e->getMessage(), 500);
    }
}

// ── 5. POST /api/readings  (Recibir mediciones del ESP32) ────────
if ($method === 'POST' && $route === '/readings') {
    $body = get_body();
    if (empty($body)) {
        json_error(
            'Cuerpo de petición vacío. Se requiere JSON con mediciones del sensor.',
            400,
            ['ejemplo' => ['sensor_id' => 'ESP32-DEMO', 'field_x' => 0.00003, 'field_y' => -0.00001, 'field_z' => 0.00004]]
        );
    }

    $sensorId = trim($body['sensor_id'] ?? '');

    // Valida existencia, activo y coincidencia de API Key del sensor
    auth_sensor($sensorId);

    $bx = isset($body['field_x']) && is_numeric($body['field_x']) ? (float)$body['field_x'] : null;
    $by = isset($body['field_y']) && is_numeric($body['field_y']) ? (float)$body['field_y'] : null;
    $bz = isset($body['field_z']) && is_numeric($body['field_z']) ? (float)$body['field_z'] : null;

    if (isset($body['field_tesla']) && is_numeric($body['field_tesla'])) {
        $bt = (float)$body['field_tesla'];
    } elseif ($bx !== null || $by !== null || $bz !== null) {
        $bt = sqrt(($bx ?? 0)**2 + ($by ?? 0)**2 + ($bz ?? 0)**2);
    } else {
        $bt = null;
    }

    if ($bt === null) {
        json_error("Se requiere 'field_tesla' numérico o al menos una componente 'field_x/y/z'.", 422);
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
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $st->execute([$sensorId, $bt, $bx, $by, $bz, $temp, $lat, $lon, $raw]);
        $newId = (int)$db->lastInsertId();

        json_ok([
            'id'          => $newId,
            'sensor_id'   => $sensorId,
            'field_tesla' => $bt,
            'field_uT'    => round($bt * 1e6, 4),
            'server_time' => date('Y-m-d H:i:s'),
            'message'     => 'Medición recibida e insertada exitosamente en MySQL.'
        ], 201);
    } catch (PDOException $e) {
        json_error('Error al insertar medición en la base de datos: ' . $e->getMessage(), 500);
    }
}

// ── 6. GET /api/readings/export  (Descargar CSV) ──────────────────
if ($method === 'GET' && ($route === '/readings/export' || $route === '/export')) {
    require __DIR__ . '/export.php';
    exit;
}

// ── 7. GET /api/readings  (Consultar históricos) ─────────────────
if ($method === 'GET' && $route === '/readings') {
    $sensor   = isset($_GET['sensor_id']) && trim($_GET['sensor_id']) !== '' && $_GET['sensor_id'] !== 'all' ? trim($_GET['sensor_id']) : null;
    $limit    = min(max((int)($_GET['limit'] ?? 200), 1), 1000);
    $offset   = max((int)($_GET['offset'] ?? 0), 0);
    $from     = !empty($_GET['from']) ? trim($_GET['from']) : null;
    $to       = !empty($_GET['to']) ? trim($_GET['to']) : null;
    $afterId  = isset($_GET['after_id']) && is_numeric($_GET['after_id']) ? (int)$_GET['after_id'] : null;

    $where  = ['1=1'];
    $params = [];

    if ($sensor)  { $where[] = 'sensor_id = ?';   $params[] = $sensor; }
    if ($from)    { $where[] = 'recorded_at >= ?'; $params[] = $from;   }
    if ($to)      { $where[] = 'recorded_at <= ?'; $params[] = $to;     }
    if ($afterId) { $where[] = 'id > ?';           $params[] = $afterId;}

    $sql = 'SELECT id, sensor_id, field_tesla, field_x, field_y, field_z,
                   temperature, recorded_at, raw_json
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

        if (!$afterId) {
            $rows = array_reverse($rows);
        }

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
        json_error('Error al consultar mediciones en la base de datos: ' . $e->getMessage(), 500);
    }
}

// ── 8. GET /api/diagnostics o POST /api/diagnostics ──────────────
if ($route === '/diagnostics') {
    require __DIR__ . '/diagnostics.php';
    exit;
}

// ── Ruta no encontrada ───────────────────────────────────────────
json_error(
    "Ruta '{$method} /api{$route}' no encontrada en la API.",
    404,
    [
        'rutas_disponibles' => [
            'POST /api/sensors/register',
            'GET  /api/sensors',
            'GET  /api/sensors/{id}/stats',
            'GET  /api/sensors/{id}/latest',
            'POST /api/readings',
            'GET  /api/readings',
            'GET  /api/readings/export',
            'GET  /api/diagnostics'
        ]
    ]
);
