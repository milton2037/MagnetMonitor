<?php
// ══════════════════════════════════════════════
// config/db.php  –  Conexión MySQL (PDO)
// Edita estos valores con los datos de tu panel
// de control de hosting (InfinityFree / cPanel)
// ══════════════════════════════════════════════

define('DB_HOST', 'sql309.infinityfree.com'); // cambia al host de tu panel
define('DB_NAME', 'if0_43469375_magnet');      // nombre de la base de datos
define('DB_USER', 'if0_43469375');             // usuario MySQL
define('DB_PASS', 'TU_PASSWORD_AQUI');         // contraseña MySQL

function getDB(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;

    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4',
                   DB_HOST, DB_NAME);
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    return $pdo;
}
