<?php
// ══════════════════════════════════════════════
// api/_base.php  –  Helpers comunes para todos
//                   los endpoints de la API
// ══════════════════════════════════════════════
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/db.php';

// ── CORS ──────────────────────────────────────
header('Access-Control-Allow-Origin: '  . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// ── Helpers ───────────────────────────────────
function json_ok(mixed $data, int $code = 200): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit;
}

function json_error(string $msg, int $code = 400): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

function get_body(): array {
    $raw = file_get_contents('php://input');
    return json_decode($raw ?: '{}', true) ?? [];
}

function api_key(): string {
    return $_SERVER['HTTP_X_API_KEY'] ?? '';
}

function require_admin(): void {
    if (api_key() !== ADMIN_KEY) json_error('No autorizado', 403);
}

/** Verifica sensor y devuelve su sensor_id o muere */
function auth_sensor(string $sensorId): void {
    $key = api_key();
    if (!$sensorId || !$key) json_error('Falta sensor_id o X-API-Key', 401);
    $db  = getDB();
    $st  = $db->prepare(
        'SELECT 1 FROM sensors WHERE sensor_id=? AND api_key=? AND active=1'
    );
    $st->execute([$sensorId, $key]);
    if (!$st->fetch()) json_error('Sensor no autorizado', 403);
}
