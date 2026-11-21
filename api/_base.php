<?php
// ══════════════════════════════════════════════
// api/_base.php  –  Helpers comunes y manejo
//                   global de excepciones/errores
// ══════════════════════════════════════════════
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/db.php';

// ── CORS ──────────────────────────────────────
header('Access-Control-Allow-Origin: '  . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key, User-Agent');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── Manejo global de excepciones no capturadas ─────────────────
set_exception_handler(function (Throwable $e) {
    $code = $e->getCode();
    $httpStatus = ($code >= 400 && $code < 600) ? (int)$code : 500;
    json_error($e->getMessage(), $httpStatus, [
        'type' => get_class($e),
        'file' => basename($e->getFile()) . ':' . $e->getLine()
    ]);
});

// ── Manejo de errores fatales / warnings de PHP ────────────────
set_error_handler(function ($severity, $message, $file, $line) {
    if (!(error_reporting() & $severity)) return false;
    throw new ErrorException($message, 500, $severity, $file, $line);
});

// ── Helpers de respuesta JSON ─────────────────
function json_ok(mixed $data, int $code = 200, array $meta = []): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    $payload = ['ok' => true, 'data' => $data];
    if (!empty($meta)) {
        $payload['meta'] = $meta;
    }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function json_error(string $msg, int $code = 400, mixed $detail = null): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    $payload = ['ok' => false, 'error' => $msg];
    if ($detail !== null) {
        $payload['detail'] = $detail;
    }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function get_body(): array {
    $raw = file_get_contents('php://input');
    if (empty(trim($raw))) {
        return [];
    }
    $decoded = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        json_error(
            'El cuerpo de la petición no es un JSON válido: ' . json_last_error_msg(),
            400,
            ['raw_input_sample' => substr($raw, 0, 200)]
        );
    }
    return $decoded;
}

function api_key(): string {
    return trim($_SERVER['HTTP_X_API_KEY'] ?? $_SERVER['X_API_KEY'] ?? '');
}

function require_admin(): void {
    $key = api_key();
    if (empty($key)) {
        json_error('Se requiere la cabecera X-API-Key con la clave de administrador.', 401);
    }
    if ($key !== ADMIN_KEY) {
        json_error('Clave de administrador incorrecta.', 403);
    }
}

/**
 * Verifica autenticación del sensor con validación y mensajes específicos
 */
function auth_sensor(string $sensorId): array {
    $key = api_key();
    if (empty($sensorId)) {
        json_error('Falta el parámetro sensor_id en la petición.', 400);
    }
    if (empty($key)) {
        json_error("Falta la cabecera X-API-Key para autenticar el sensor '{$sensorId}'.", 401);
    }

    try {
        $db = getDB();
        $st = $db->prepare('SELECT sensor_id, api_key, active, name FROM sensors WHERE sensor_id = ?');
        $st->execute([$sensorId]);
        $sensor = $st->fetch();

        if (!$sensor) {
            json_error(
                "El sensor '{$sensorId}' no está registrado en la base de datos.",
                403,
                "Registra el sensor primero mediante POST /api/sensors.php o usa 'ESP32-DEMO' con clave 'DEMO_KEY_1234'."
            );
        }

        if ((int)$sensor['active'] !== 1) {
            json_error("El sensor '{$sensorId}' está marcado como INACTIVO en la base de datos.", 403);
        }

        if ($sensor['api_key'] !== $key) {
            json_error("La clave X-API-Key proporcionada no coincide con la registrada para el sensor '{$sensorId}'.", 403);
        }

        return $sensor;
    } catch (PDOException $e) {
        if ($e->getCode() == 1146 || str_contains($e->getMessage(), "Table") || str_contains($e->getMessage(), "doesn't exist")) {
            json_error(
                "La tabla 'sensors' no existe en la base de datos MySQL. Debes importar el archivo 'schema_hosting.sql' en phpMyAdmin.",
                500,
                $e->getMessage()
            );
        }
        throw $e;
    }
}
