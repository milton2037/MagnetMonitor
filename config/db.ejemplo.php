<?php
// ══════════════════════════════════════════════
// config/db.php  –  Conexión MySQL (PDO) con
//                   diagnóstico y manejo de errores
// ══════════════════════════════════════════════

// 1. Servidor MySQL asignado por InfinityFree (Panel -> MySQL Details -> MySQL Hostname)
// Ejemplos comunes: sql105.infinityfree.com, sql202.infinityfree.com, sql309.infinityfree.com
define('DB_HOST', 'sql309.infinityfree.com'); // ← Cambia si tu panel muestra otro hostname

// 2. Nombre de tu base de datos (según tu panel de InfinityFree)
define('DB_NAME', 'if0_43494190_magnet');

// 3. Usuario de tu cuenta de InfinityFree
define('DB_USER', 'if0_43494190');

// 4. Contraseña de tu cuenta de InfinityFree (la misma de vPanel / FTP)
define('DB_PASS', 'TU_PASSWORD_AQUI');

/**
 * Obtiene la conexión PDO a MySQL con manejo explícito de errores
 *
 * @throws PDOException
 */
function getDB(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;

    // Validación preventiva de configuración
    if (DB_PASS === 'TU_PASSWORD_AQUI' || trim(DB_PASS) === '') {
        throw new PDOException(
            "La contraseña de MySQL no está configurada en config/db.php. Debes reemplazar 'TU_PASSWORD_AQUI' por la contraseña de tu cuenta de InfinityFree (la misma que usas para el panel de control o FTP).",
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
            $friendly = "Acceso denegado a MySQL para el usuario '" . DB_USER . "'. Verifica DB_PASS en config/db.php (debe ser la contraseña de tu cuenta de InfinityFree).";
        } elseif ($code === 1049 || str_contains($msg, 'Unknown database')) {
            $friendly = "La base de datos '" . DB_NAME . "' no existe en '" . DB_HOST . "'. Verifica el nombre en tu panel de InfinityFree.";
        } elseif ($code === 2002 || str_contains($msg, 'Connection refused') || str_contains($msg, 'timed out')) {
            $friendly = "No se pudo contactar al servidor MySQL '" . DB_HOST . "'. Ve a tu panel de InfinityFree -> 'MySQL Details' y copia el 'MySQL Hostname' exacto asignado a tu cuenta.";
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
    } catch (Throwable $e) {
        $latencyMs = round((microtime(true) - $start) * 1000, 2);
        return [
            'connected'  => false,
            'host'       => DB_HOST,
            'database'   => DB_NAME,
            'user'       => DB_USER,
            'version'    => null,
            'latency_ms' => $latencyMs,
            'error'      => $e->getMessage()
        ];
    }
}
