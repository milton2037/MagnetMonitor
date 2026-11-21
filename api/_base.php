<?php
// ══════════════════════════════════════════════════════════════
// api/_base.php  –  Helpers comunes + manejo global de errores
// ══════════════════════════════════════════════════════════════
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/db.php';

// ── Registrar errores PHP en log (no exponerlos al cliente) ──
error_reporting(E_ALL);
ini_set('display_errors', '0');         // nunca mostrar al cliente
ini_set('log_errors',     '1');
ini_set('error_log', __DIR__ . '/../logs/php_errors.log');

// ── Capturar errores fatales y devolverlos como JSON ─────────
register_shutdown_function(function () {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode([
            'ok'    => false,
            'error' => 'Error interno del servidor',
            'debug' => (defined('APP_DEBUG') && APP_DEBUG)
                       ? $err['message'] . ' en ' . $err['file'] . ':' . $err['line']
                       : null,
        ]);
    }
});

// ── Excepción no capturada ────────────────────────────────────
set_exception_handler(function (Throwable $e) {
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    error_log('[MagnetMonitor] Excepción: ' . $e->getMessage() . ' en ' . $e->getFile() . ':' . $e->getLine());
    echo json_encode([
        'ok'    => false,
        'error' => 'Error interno del servidor',
        'debug' => (defined('APP_DEBUG') && APP_DEBUG) ? $e->getMessage() : null,
    ]);
    exit;
});

// ── CORS ──────────────────────────────────────────────────────
header('Access-Control-Allow-Origin: '  . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── Helpers de respuesta ──────────────────────────────────────
function json_ok(mixed $data, int $code = 200): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok'        => true,
        'timestamp' => date('c'),
        'data'      => $data,
    ], JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}

function json_error(string $msg, int $code = 400, ?array $details = null): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    error_log("[MagnetMonitor] Error $code: $msg");
    $payload = ['ok' => false, 'error' => $msg, 'timestamp' => date('c')];
    if ($details !== null) $payload['details'] = $details;
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Leer body JSON con validación ─────────────────────────────
function get_body(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $data = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        json_error('JSON inválido: ' . json_last_error_msg(), 400);
    }
    return $data ?? [];
}

// ── Cabecera API Key ──────────────────────────────────────────
function api_key(): string {
    return trim($_SERVER['HTTP_X_API_KEY'] ?? '');
}

function require_admin(): void {
    $key = api_key();
    if (!$key)              json_error('Falta cabecera X-API-Key', 401);
    if ($key !== ADMIN_KEY) json_error('Clave de administrador incorrecta', 403);
}

// ── Autenticación de sensor ───────────────────────────────────
function auth_sensor(string $sensorId): void {
    $key = api_key();
    if (!$key)       json_error('Falta cabecera X-API-Key', 401);
    if (!$sensorId)  json_error('Falta sensor_id en el body', 400);

    try {
        $db = getDB();
        $st = $db->prepare(
            'SELECT active FROM sensors WHERE sensor_id = ? AND api_key = ?'
        );
        $st->execute([$sensorId, $key]);
        $row = $st->fetch();
        if (!$row)             json_error('Sensor no encontrado o API key incorrecta', 403);
        if (!$row['active'])   json_error('Sensor desactivado. Contacta al administrador.', 403);
    } catch (PDOException $e) {
        error_log('[MagnetMonitor] auth_sensor DB error: ' . $e->getMessage());
        json_error('Error de base de datos al autenticar', 500);
    }
}

// ── Validar número en rango ───────────────────────────────────
function validate_float(mixed $val, string $name, ?float $min = null, ?float $max = null): float {
    if (!is_numeric($val)) json_error("El campo '$name' debe ser numérico", 422);
    $f = (float)$val;
    if ($min !== null && $f < $min) json_error("El campo '$name' debe ser ≥ $min", 422);
    if ($max !== null && $f > $max) json_error("El campo '$name' debe ser ≤ $max", 422);
    return $f;
}
