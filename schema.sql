-- ═══════════════════════════════════════════════════════════════
-- MagnetMonitor – schema.sql
-- Motor: MySQL 8+ / MariaDB 10.6+
-- ═══════════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS magnetmonitor
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE magnetmonitor;

-- ─── Tabla de sensores registrados ───────────────────────────────
CREATE TABLE IF NOT EXISTS sensors (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sensor_id   VARCHAR(64)  NOT NULL UNIQUE COMMENT 'ID único del ESP32 (MAC o nombre)',
  name        VARCHAR(120) NOT NULL DEFAULT 'Sin nombre',
  location    VARCHAR(200),
  firmware    VARCHAR(50),
  api_key     VARCHAR(64)  NOT NULL COMMENT 'Clave de autenticación del dispositivo',
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sensor_id (sensor_id)
) ENGINE=InnoDB;

-- ─── Tabla principal de lecturas ──────────────────────────────────
CREATE TABLE IF NOT EXISTS readings (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sensor_id    VARCHAR(64)   NOT NULL,
  field_tesla  DOUBLE        NOT NULL COMMENT 'Magnitud total del campo |B| en Tesla',
  field_x      DOUBLE                 COMMENT 'Componente Bx (Tesla)',
  field_y      DOUBLE                 COMMENT 'Componente By (Tesla)',
  field_z      DOUBLE                 COMMENT 'Componente Bz (Tesla)',
  temperature  FLOAT                  COMMENT 'Temperatura del sensor en °C',
  latitude     DECIMAL(10,7)          COMMENT 'GPS opcional',
  longitude    DECIMAL(10,7)          COMMENT 'GPS opcional',
  raw_json     JSON                   COMMENT 'Payload completo del ESP32',
  recorded_at  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (sensor_id) REFERENCES sensors(sensor_id) ON UPDATE CASCADE,
  INDEX idx_sensor_time  (sensor_id, recorded_at),
  INDEX idx_time         (recorded_at)
) ENGINE=InnoDB;

-- ─── Vista de estadísticas por sensor ────────────────────────────
CREATE OR REPLACE VIEW v_sensor_stats AS
SELECT
  r.sensor_id,
  s.name                            AS sensor_name,
  s.location,
  COUNT(*)                          AS total_readings,
  ROUND(AVG(r.field_tesla) * 1e6, 4) AS avg_uT,
  ROUND(MAX(r.field_tesla) * 1e6, 4) AS max_uT,
  ROUND(MIN(r.field_tesla) * 1e6, 4) AS min_uT,
  MAX(r.recorded_at)                AS last_seen
FROM readings r
JOIN sensors  s ON s.sensor_id = r.sensor_id
GROUP BY r.sensor_id, s.name, s.location;

-- ─── Sensor de demo (para pruebas sin ESP32) ─────────────────────
INSERT IGNORE INTO sensors (sensor_id, name, location, api_key)
VALUES ('ESP32-DEMO', 'Sensor demo', 'Laboratorio 1', 'DEMO_KEY_1234');
