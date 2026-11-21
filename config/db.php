<?php
// ══════════════════════════════════════════════════════════════
// config/db.php  –  Conexión MySQL (PDO) con manejo de errores
// ══════════════════════════════════════════════════════════════

define('DB_HOST', 'sql309.infinityfree.com'); // host MySQL de tu panel
define('DB_NAME', 'if0_43469375_magnet');      // nombre de la base de datos
define('DB_USER', 'if0_43469375');             // usuario MySQL
define('DB_PASS', 'TU_PASSWORD_AQUI');         // contraseña MySQL

function getDB(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;

    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=utf8mb4;connect_timeout=5',
        DB_HOST, DB_NAME
    );

    try {
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_TIMEOUT            => 5,
        ]);
    } catch (PDOException $e) {
        // Loguear el error real, no exponerlo
        error_log('[MagnetMonitor] DB connection failed: ' . $e->getMessage());

        // Código específico para diagnóstico
        $code = (int)$e->getCode();
        $msg  = match (true) {
            str_contains($e->getMessage(), 'Access denied')       => 'Acceso denegado a la base de datos. Verifica usuario/contraseña en config/db.php.',
            str_contains($e->getMessage(), 'Unknown database')    => 'Base de datos no encontrada. Verifica DB_NAME en config/db.php.',
            str_contains($e->getMessage(), 'php_network_getaddresses'),
            str_contains($e->getMessage(), 'Connection refused'),
            str_contains($e->getMessage(), 'connect_timeout')     => 'No se puede conectar al servidor MySQL. Verifica DB_HOST en config/db.php.',
            default => 'Error de conexión a la base de datos.',
        };

        // Si ya tenemos _base.php cargado, usar json_error
        if (function_exists('json_error')) {
            json_error($msg, 503, ['db_code' => $code]);
        } else {
            http_response_code(503);
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['ok' => false, 'error' => $msg, 'db_code' => $code]);
            exit;
        }
    }

    return $pdo;
}

/** Prueba de conexión rápida, devuelve array con resultado */
function testDB(): array {
    try {
        $pdo = getDB();
        $ver = $pdo->query('SELECT VERSION() AS v')->fetchColumn();
        $db  = $pdo->query('SELECT DATABASE() AS d')->fetchColumn();
        return ['ok' => true, 'mysql_version' => $ver, 'database' => $db];
    } catch (PDOException $e) {
        return ['ok' => false, 'error' => $e->getMessage(), 'code' => $e->getCode()];
    }
}
