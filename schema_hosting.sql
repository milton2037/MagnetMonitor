-- ═══════════════════════════════════════════════════════════════
-- schema_hosting.sql  –  Para hosting compartido (InfinityFree)
-- 100% compatible sin privilegios especiales (No requiere CREATE VIEW)
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Tabla de sensores registrados ────────────────────────────
CREATE TABLE IF NOT EXISTS `sensors` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `sensor_id`   VARCHAR(64)  NOT NULL UNIQUE COMMENT 'ID único del ESP32',
  `name`        VARCHAR(120) NOT NULL DEFAULT 'Sin nombre',
  `location`    VARCHAR(200),
  `firmware`    VARCHAR(50),
  `api_key`     VARCHAR(64)  NOT NULL,
  `active`      TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_sensor_id` (`sensor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── 2. Tabla de lecturas ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `readings` (
  `id`           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `sensor_id`    VARCHAR(64)   NOT NULL,
  `field_tesla`  DOUBLE        NOT NULL,
  `field_x`      DOUBLE,
  `field_y`      DOUBLE,
  `field_z`      DOUBLE,
  `temperature`  FLOAT,
  `latitude`     DECIMAL(10,7),
  `longitude`    DECIMAL(10,7),
  `raw_json`     TEXT,
  `recorded_at`  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`sensor_id`) REFERENCES `sensors`(`sensor_id`) ON UPDATE CASCADE,
  INDEX `idx_sensor_time` (`sensor_id`, `recorded_at`),
  INDEX `idx_time`        (`recorded_at`),
  INDEX `idx_id`          (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── 3. Sensor demo (para pruebas sin ESP32) ──────────────────────
INSERT IGNORE INTO `sensors` (`sensor_id`, `name`, `location`, `api_key`)
VALUES ('ESP32-DEMO', 'Sensor demo', 'Laboratorio 1', 'DEMO_KEY_1234');
