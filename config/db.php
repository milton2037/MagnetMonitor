<?php
// ══════════════════════════════════════════════
// config/db.php  –  Conexión MySQL (PDO) con
//                   diagnóstico y manejo de errores
// ══════════════════════════════════════════════

define('DB_HOST', 'sql309.infinityfree.com'); // cambia al host de tu panel
define('DB_NAME', 'if0_43469375_magnet');      // nombre de la base de datos
define('DB_USER', 'if0_43469375');             // usuario MySQL
define('DB_PASS', 'TU_PASSWORD_AQUI');         // contraseña MySQL

/**
 * Obtiene la conexión PDO a MySQL con manejo explícito de errores
 *
 * @throws PDOException
 */
function getDB(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;

    // Validación preventiva de configuración
    if (DB_PASS === 'TU_PASSWORD_AQUI' || empty(DB_PASS)) {
        throw new PDOException(
            "La contraseña de base de datos no está configurada en config/db.php. Reemplaza 'TU_PASSWORD_AQUI' por tu contraseña real del panel de hosting.",
            1045
        );
    }

    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', DB_HOST, DB_NAME);

    try {
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_TIMEOUT            => 5, // 5 segundos de timeout
        ]);
        return $pdo;
    } catch (PDOException $e) {
        $code = (int)$e->getCode();
        $msg  = $e->getMessage();

        // Diagnóstico amigable según el código de error MySQL
        if ($code === 1045 || str_contains($msg, 'Access denied')) {
            $friendly = "Acceso denegado a MySQL para el usuario '" . DB_USER . "'. Verifica DB_USER y DB_PASS en config/db.php.";
        } elseif ($code === 1049 || str_contains($msg, 'Unknown database')) {
            $friendly = "La base de datos '" . DB_NAME . "' no existe en el servidor '" . DB_HOST . "'. Créala en el panel de control de tu hosting.";
        } elseif ($code === 2002 || str_contains($msg, 'Connection refused') || str_contains($msg, 'timed out')) {
            $friendly = "No se pudo contactar el host MySQL '" . DB_HOST . "'. Verifica el nombre del servidor en tu panel de hosting.";
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
