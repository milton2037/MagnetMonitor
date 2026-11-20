<?php
// ══════════════════════════════════════════════════════════════════
// api/stats.php  –  Estadísticas por sensor
// ══════════════════════════════════════════════════════════════════
require_once __DIR__ . '/_base.php';

$db = getDB();
$st = $db->query('SELECT * FROM v_sensor_stats');
json_ok($st->fetchAll());
