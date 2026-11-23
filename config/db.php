<?php
// ══════════════════════════════════════════════
// config/db.php  –  Conexión MySQL Alwaysdata (PDO)
// ══════════════════════════════════════════════

// 1. Servidor MySQL en Alwaysdata
// En Alwaysdata suele ser: mysql-[tu_cuenta].alwaysdata.net
define('DB_HOST', 'mysql-magnetmonitor.alwaysdata.net');

// 2. Nombre de tu base de datos creada en Alwaysdata
// Formato: [cuenta]_[nombre]  Ej: magnetmonitor_magnet
define('DB_NAME', 'magnetmonitor_magnet');

// 3. Usuario de la base de datos creado en Alwaysdata
define('DB_USER', 'magnetmonitor');

// 4. Contraseña que le asignaste al usuario en Alwaysdata
define('DB_PASS', 'TU_PASSWORD_AQUI');

/**
 * Obtiene la conexión PDO a MySQL con manejo explícito de errores
 *
 * @throws PDOException
 */
function getDB(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;

    if (DB_PASS === 'TU_PASSWORD_AQUI' || trim(DB_PASS) === '') {
        throw new PDOException(
            "Debes configurar la contraseña de MySQL en config/db.php.",
            1045
        );
    }

    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', DB_HOST, DB_NAME);

    try {
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_TIMEOUT            => 5,
        ]);
        return $pdo;
    } catch (PDOException $e) {
        $code = (int)$e->getCode();
        $msg  = $e->getMessage();

        if ($code === 1045 || str_contains($msg, 'Access denied')) {
            $friendly = "Acceso denegado para el usuario '" . DB_USER . "'. Verifica usuario y contraseña en config/db.php.";
        } elseif ($code === 1049 || str_contains($msg, 'Unknown database')) {
            $friendly = "La base de datos '" . DB_NAME . "' no existe. Verifica el nombre en Alwaysdata.";
        } elseif ($code === 2002 || str_contains($msg, 'Connection refused') || str_contains($msg, 'timed out')) {
            $friendly = "No se pudo contactar al servidor MySQL '" . DB_HOST . "'.";
        } else {
            $friendly = "Error de conexión a MySQL: " . $msg;
        }

        throw new PDOException($friendly, $code, $e);
    }
}

/**
 * Prueba la conexión a la base de datos y retorna un reporte de estado
 */
function testDBConnection(): array {
    $start = microtime(true);
    try {
        $db = getDB();
        $latencyMs = round((microtime(true) - $start) * 1000, 2);
        $version   = $db->query('SELECT VERSION() AS v')->fetch()['v'] ?? 'Desconocida';

        return [
            'connected'  => true,
            'host'       => DB_HOST,
            'database'   => DB_NAME,
            'user'       => DB_USER,
            'version'    => $version,
            'latency_ms' => $latencyMs,
            'error'      => null
        ];
    } catch (PDOException $e) {
        return [
            'connected'  => false,
            'host'       => DB_HOST,
            'database'   => DB_NAME,
            'user'       => DB_USER,
            'version'    => null,
            'latency_ms' => null,
            'error'      => $e->getMessage(),
            'error_code' => $e->getCode()
        ];
    }
}
