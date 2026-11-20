<?php
// ══════════════════════════════════════════════════════════════════
// api/export.php  –  Descarga CSV de lecturas
// ══════════════════════════════════════════════════════════════════
require_once __DIR__ . '/_base.php';

$sensor = $_GET['sensor_id'] ?? null;
$from   = $_GET['from']      ?? null;
$to     = $_GET['to']        ?? null;

$where  = ['1=1'];
$params = [];
if ($sensor) { $where[] = 'sensor_id = ?'; $params[] = $sensor; }
if ($from)   { $where[] = 'recorded_at >= ?'; $params[] = $from; }
if ($to)     { $where[] = 'recorded_at <= ?'; $params[] = $to;   }

$sql = 'SELECT id, sensor_id, recorded_at, field_tesla, field_x, field_y, field_z, temperature
        FROM readings WHERE ' . implode(' AND ', $where) . '
        ORDER BY recorded_at ASC LIMIT 100000';

$db = getDB();
$st = $db->prepare($sql);
$st->execute($params);

$filename = 'magnetmonitor_' . date('Ymd_His') . '.csv';
header('Content-Type: text/csv; charset=utf-8');
header("Content-Disposition: attachment; filename=\"$filename\"");

$out = fopen('php://output', 'w');
fputcsv($out, ['id','sensor_id','recorded_at','field_T','field_uT','field_x','field_y','field_z','temperature']);

while ($row = $st->fetch()) {
    fputcsv($out, [
        $row['id'],
        $row['sensor_id'],
        $row['recorded_at'],
        $row['field_tesla'],
        round($row['field_tesla'] * 1e6, 4),
        $row['field_x']     ?? '',
        $row['field_y']     ?? '',
        $row['field_z']     ?? '',
        $row['temperature'] ?? '',
    ]);
}
fclose($out);
