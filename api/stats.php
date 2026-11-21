<?php
// ══════════════════════════════════════════════════════════════════
// api/stats.php  –  Estadísticas por sensor
// ══════════════════════════════════════════════════════════════════
require_once __DIR__ . '/_base.php';

try {
    $db = getDB();
    $st = $db->query('SELECT * FROM v_sensor_stats');
    json_ok($st->fetchAll());
} catch (PDOException $e) {
    if ($e->getCode() == 1146 || str_contains($e->getMessage(), "doesn't exist")) {
        json_error("La vista 'v_sensor_stats' no existe en la base de datos. Importa schema_hosting.sql.", 500, $e->getMessage());
    }
    json_error("Error al obtener estadísticas: " . $e->getMessage(), 500);
}
