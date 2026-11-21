<?php
// ══════════════════════════════════════════════════════════════════
// api/diagnostics.php  –  Endpoint de prueba de conexión, salud del
//                         sistema y verificación de lecturas
//
// GET  → Diagnóstico integral (PHP, MySQL, tablas, última lectura)
// POST → Echo test (para verificar payload recibido desde ESP32)
// ══════════════════════════════════════════════════════════════════
require_once __DIR__ . '/_base.php';

$method = $_SERVER['REQUEST_METHOD'];

// ════════════════════════════════════════════
//  POST: Echo test para depurar el ESP32
// ════════════════════════════════════════════
if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    $decoded = json_decode($raw ?: '{}', true);

    json_ok([
        'message'          => 'Echo test recibido exitosamente por el servidor.',
        'received_at'      => date('Y-m-d H:i:s'),
        'content_type'     => $_SERVER['CONTENT_TYPE'] ?? 'no definido',
        'content_length'   => strlen($raw),
        'api_key_header'   => !empty(api_key()) ? 'PRESENTE' : 'AUSENTE',
        'json_valid'       => (json_last_error() === JSON_ERROR_NONE),
        'parsed_payload'   => $decoded,
        'raw_payload'      => $raw,
        'client_ip'        => $_SERVER['REMOTE_ADDR'] ?? 'desconocida',
        'user_agent'       => $_SERVER['HTTP_USER_AGENT'] ?? 'desconocido'
    ]);
}

// ════════════════════════════════════════════
//  GET: Diagnóstico completo del sistema
// ════════════════════════════════════════════
$report = [
    'timestamp'      => date('Y-m-d H:i:s'),
    'timezone'       => date_default_timezone_get(),
    'php' => [
        'version'    => PHP_VERSION,
        'pdo_mysql'  => extension_loaded('pdo_mysql'),
        'json'       => extension_loaded('json'),
        'mbstring'   => extension_loaded('mbstring'),
    ],
    'database'       => testDBConnection(),
    'tables' => [
        'sensors'    => ['exists' => false, 'count' => 0],
        'readings'   => ['exists' => false, 'count' => 0],
    ],
    'sensors_list'   => [],
    'latest_reading' => null,
    'client' => [
        'ip'         => $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1',
        'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? 'desconocido',
        'https'      => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['SERVER_PORT'] ?? 80) == 443,
    ]
];

// Si la base de datos conectó, verificar tablas y última lectura
if ($report['database']['connected']) {
    try {
        $db = getDB();

        // 1. Verificar tabla sensors
        try {
            $cnt = $db->query('SELECT COUNT(*) AS c FROM sensors')->fetch()['c'] ?? 0;
            $report['tables']['sensors'] = ['exists' => true, 'count' => (int)$cnt];

            $sensors = $db->query('SELECT sensor_id, name, location, active, created_at FROM sensors LIMIT 20')->fetchAll();
            $report['sensors_list'] = $sensors;
        } catch (Throwable $e) {
            $report['tables']['sensors'] = ['exists' => false, 'count' => 0, 'error' => $e->getMessage()];
        }

        // 2. Verificar tabla readings
        try {
            $cnt = $db->query('SELECT COUNT(*) AS c FROM readings')->fetch()['c'] ?? 0;
            $report['tables']['readings'] = ['exists' => true, 'count' => (int)$cnt];

            // 3. Obtener la última lectura registrada
            $latest = $db->query(
                'SELECT id, sensor_id, field_tesla, field_x, field_y, field_z,
                        temperature, recorded_at, raw_json
                 FROM readings
                 ORDER BY id DESC
                 LIMIT 1'
            )->fetch();

            if ($latest) {
                $latest['id']          = (int)$latest['id'];
                $latest['field_tesla'] = (float)$latest['field_tesla'];
                $latest['field_uT']    = round($latest['field_tesla'] * 1e6, 4);
                $latest['field_x']     = $latest['field_x'] !== null ? (float)$latest['field_x'] : null;
                $latest['field_y']     = $latest['field_y'] !== null ? (float)$latest['field_y'] : null;
                $latest['field_z']     = $latest['field_z'] !== null ? (float)$latest['field_z'] : null;
                $latest['temperature'] = $latest['temperature'] !== null ? (float)$latest['temperature'] : null;
                // Parsear el raw_json si es JSON válido
                $parsedRaw = json_decode($latest['raw_json'] ?? '', true);
                $latest['raw_json_parsed'] = $parsedRaw ?: $latest['raw_json'];
                $report['latest_reading']  = $latest;
            }
        } catch (Throwable $e) {
            $report['tables']['readings'] = ['exists' => false, 'count' => 0, 'error' => $e->getMessage()];
        }

    } catch (Throwable $e) {
        $report['database']['inspection_error'] = $e->getMessage();
    }
}

// Determinar estado de salud general
$isHealthy = $report['database']['connected'] &&
             $report['tables']['sensors']['exists'] &&
             $report['tables']['readings']['exists'];

json_ok($report, $isHealthy ? 200 : 503, [
    'status' => $isHealthy ? 'HEALTHY' : 'NEEDS_ATTENTION'
]);
