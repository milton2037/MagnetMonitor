<?php
// ══════════════════════════════════════════════════════════════════
// api/stats.php  –  Estadísticas por sensor (consulta nativa directa)
// Compatible con InfinityFree (no requiere CREATE VIEW)
// ══════════════════════════════════════════════════════════════════
require_once __DIR__ . '/_base.php';

try {
    $db = getDB();
    $sql = 'SELECT
              r.sensor_id,
              s.name                              AS sensor_name,
              s.location,
              COUNT(*)                            AS total_readings,
              ROUND(AVG(r.field_tesla) * 1e6, 4) AS avg_uT,
              ROUND(MAX(r.field_tesla) * 1e6, 4) AS max_uT,
              ROUND(MIN(r.field_tesla) * 1e6, 4) AS min_uT,
              MAX(r.recorded_at)                 AS last_seen
            FROM readings r
            JOIN sensors  s ON s.sensor_id = r.sensor_id
            GROUP BY r.sensor_id, s.name, s.location';

    $st = $db->query($sql);
    json_ok($st->fetchAll());
} catch (PDOException $e) {
    if ($e->getCode() == 1146 || str_contains($e->getMessage(), "doesn't exist")) {
        json_error("Las tablas 'sensors' o 'readings' no existen en MySQL. Importa schema_hosting.sql.", 500, $e->getMessage());
    }
    json_error("Error al obtener estadísticas: " . $e->getMessage(), 500);
}
