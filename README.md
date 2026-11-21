# 🧲 MagnetMonitor

> **Monitor y Calculadora de Campos Magnéticos** — Aplicación web para visualizar lecturas de un sensor ESP32 en tiempo real, almacenarlas en MySQL y aplicar cálculos con leyes del electromagnetismo.

---

## Tabla de contenidos

1. [Descripción general](#1-descripción-general)
2. [Arquitectura del sistema](#2-arquitectura-del-sistema)
3. [Estructura del proyecto](#3-estructura-del-proyecto)
4. [Requisitos previos](#4-requisitos-previos)
5. [Paso 1 — Base de datos MySQL](#5-paso-1--base-de-datos-mysql)
6. [Paso 2 — Configuración PHP](#6-paso-2--configuración-php)
7. [Paso 3 — Despliegue en hosting](#7-paso-3--despliegue-en-hosting)
8. [Paso 4 — Registrar el sensor ESP32](#8-paso-4--registrar-el-sensor-esp32)
9. [Paso 5 — Programar el ESP32](#9-paso-5--programar-el-esp32)
10. [API REST — referencia completa](#10-api-rest--referencia-completa)
11. [Panel de Pruebas y Diagnóstico en la Web](#11-panel-de-pruebas-y-diagnóstico-en-la-web)
12. [Leyes electromagnéticas implementadas](#12-leyes-electromagnéticas-implementadas)
13. [Modo simulación (sin hardware)](#13-modo-simulación-sin-hardware)
14. [Solución de problemas](#14-solución-de-problemas)

---

## 1. Descripción general

MagnetMonitor es una aplicación **PHP + MySQL + HTML/CSS/JS** que:

- Recibe lecturas de campo magnético desde un **ESP32 + sensor QMC5883L** vía HTTP POST.
- Almacena cada lectura (Bx, By, Bz, |B|, temperatura, timestamp) en una **base de datos MySQL**.
- Muestra un **monitor en tiempo real** con gráfica, gauge y tabla de historial (polling cada 2 s).
- Incluye una **calculadora electromagnética** con 6 leyes: Biot-Savart, Ampère, Solenoide, Toroide, Faraday y Lorentz.
- Funciona en modo **simulación** si el ESP32 no está conectado.
- Permite **exportar CSV** con toda la historia de lecturas.

> **Stack:** PHP 8+, MySQL 5.7+ / MariaDB 10.6+, JavaScript (vanilla), Chart.js.  
> **Sin Node.js.** No requiere ningún proceso de servidor adicional, funciona en cualquier hosting compartido con PHP.

---

## 2. Arquitectura del sistema

```
┌──────────────┐        HTTP POST          ┌─────────────────────────┐
│    ESP32     │  ─────────────────────▶  │  api/readings.php       │
│  QMC5883L   │  X-API-Key: CLAVE        │  (autenticación +       │
└──────────────┘                           │   INSERT en MySQL)      │
                                           └──────────┬──────────────┘
                                                      │ PDO
                                           ┌──────────▼──────────────┐
                                           │     MySQL / MariaDB     │
                                           │   tabla: readings       │
                                           │   tabla: sensors        │
                                           └──────────┬──────────────┘
                                                      │ SELECT
┌──────────────┐    GET polling (2 s)      ┌──────────▼──────────────┐
│   Browser    │  ◀─────────────────────  │  api/readings.php       │
│  index.html  │  JSON { rows: [...] }    │  api/sensors.php        │
│  script.js   │                           │  api/export.php         │
└──────────────┘                           │  api/stats.php          │
                                           └─────────────────────────┘
```

---

## 3. Estructura del proyecto

```
MONITOR-MAGNETICO/
│
├── index.html              # SPA del monitor (interfaz de usuario)
├── style.css               # Estilos (tema oscuro)
├── script.js               # Lógica: gráfica, polling, calculadora
├── .htaccess               # Reglas Apache (seguridad + cache)
│
├── schema_hosting.sql      # Esquema MySQL para ejecutar en phpMyAdmin
│
├── config/
│   ├── db.php              # ⚙️ Credenciales de MySQL  ← EDITAR
│   └── config.php          # ⚙️ Clave admin y zona horaria ← EDITAR
│
├── api/
│   ├── _base.php           # Helpers comunes (CORS, JSON, auth)
│   ├── readings.php        # POST (ESP32) + GET (frontend)
│   ├── sensors.php         # GET lista / POST registro
│   ├── stats.php           # Estadísticas por sensor
│   ├── diagnostics.php     # 🩺 Diagnóstico y prueba de recepción
│   └── export.php          # Descarga CSV
│
└── esp32/
    └── magnetometer.ino    # Firmware Arduino para ESP32 + QMC5883L
```

---

## 4. Requisitos previos

| Componente | Requisito mínimo |
|---|---|
| Hosting | PHP 8.0+, MySQL 5.7+ o MariaDB 10.6+ |
| Panel | InfinityFree, cPanel, Plesk o similar |
| FTP | FileZilla (o File Manager del panel) |
| Arduino IDE | 2.x con soporte ESP32 |
| ESP32 | Cualquier variante (DevKit v1 recomendado) |
| Sensor magnético | QMC5883L (I²C) — compatible con HMC5883L |

> **Hosting utilizado en este proyecto:** `miltonguerrero.rf.gd`  
> Panel: InfinityFree · IP: 185.27.134.139 · Directorio raíz: `htdocs/`

---

## 5. Paso 1 — Base de datos MySQL

### 5.1 Crear la base de datos en el panel

1. Entra a tu panel de **InfinityFree** → sección **MySQL Databases**.
2. Crea una nueva base de datos. El nombre completo tendrá el prefijo de tu cuenta, por ejemplo:  
   `if0_43469375_magnet`
3. Anota: **nombre de BD**, **usuario** y **contraseña** — los necesitarás en el Paso 2.
4. Anota también el **host del servidor MySQL** (aparece en el panel, ej. `sql309.infinityfree.com`).

### 5.2 Crear las tablas con phpMyAdmin

1. En el panel abre **phpMyAdmin**.
2. Selecciona tu base de datos en el panel izquierdo.
3. Haz clic en la pestaña **SQL**.
4. Copia y pega el contenido completo de `schema_hosting.sql`.
5. Haz clic en **Ejecutar**.

Verás creadas:

| Objeto | Tipo | Descripción |
|---|---|---|
| `sensors` | Tabla | Sensores ESP32 autorizados |
| `readings` | Tabla | Lecturas de campo magnético |

> Un sensor de demo (`ESP32-DEMO` / `DEMO_KEY_1234`) se inserta automáticamente para pruebas.

---

## 6. Paso 2 — Configuración PHP

### 6.1 `config/db.php` — Credenciales de base de datos

Abre el archivo y completa con los datos de tu panel:

```php
define('DB_HOST', 'sql309.infinityfree.com');  // ← host de tu panel MySQL
define('DB_NAME', 'if0_43469375_magnet');       // ← nombre de tu BD
define('DB_USER', 'if0_43469375');              // ← usuario MySQL
define('DB_PASS', 'TU_PASSWORD_REAL');          // ← contraseña MySQL
```

### 6.2 `config/config.php` — Clave de administrador

```php
define('ADMIN_KEY', 'una_clave_larga_y_muy_secreta_aqui');
```

> ⚠️ Esta clave protege el endpoint de registro de sensores. Usa al menos 24 caracteres aleatorios.

---

## 7. Paso 3 — Despliegue en hosting

### 7.1 Archivos a subir

Sube por **FTP** (FileZilla) o por el **File Manager** del panel los siguientes archivos al directorio `htdocs/`:

```
htdocs/
├── .htaccess
├── index.html
├── style.css
├── script.js
├── api/
│   ├── _base.php
│   ├── readings.php
│   ├── sensors.php
│   ├── stats.php
│   └── export.php
└── config/
    ├── db.php
    └── config.php
```

> **No subas:** `esp32/`, `schema_hosting.sql`, `schema.sql`.  
> **No subas:** Ninguna carpeta de Node.js (`backend/`, `node_modules/`).

### 7.2 Conexión FTP con FileZilla

| Campo | Valor |
|---|---|
| Host | `ftpupload.net` (InfinityFree) |
| Puerto | `21` |
| Usuario | Tu usuario FTP del panel |
| Contraseña | Tu contraseña FTP del panel |
| Directorio remoto | `/htdocs/` |

### 7.3 Verificar que funciona

Abre en el navegador:

```
https://miltonguerrero.rf.gd/api/sensors.php
```

Debes ver:
```json
{"ok": true, "data": [{"sensor_id": "ESP32-DEMO", ...}]}
```

---

## 8. Paso 4 — Registrar el sensor ESP32

Ejecuta este comando **una sola vez** desde tu terminal (PowerShell, cmd o Linux):

```bash
curl -X POST https://miltonguerrero.rf.gd/api/sensors/register \
  -H "Content-Type: application/json" \
  -H "X-API-Key: una_clave_larga_y_muy_secreta_aqui" \
  -d "{\"sensor_id\":\"ESP32-LAB1\",\"name\":\"Laboratorio 1\",\"location\":\"Sala A\",\"api_key\":\"MI_CLAVE_ESP32\"}"
```

**En PowerShell (Windows):**
```powershell
$body = '{"sensor_id":"ESP32-LAB1","name":"Laboratorio 1","location":"Sala A","api_key":"MI_CLAVE_ESP32"}'
Invoke-RestMethod -Uri "https://miltonguerrero.rf.gd/api/sensors/register" `
  -Method POST `
  -Headers @{"Content-Type"="application/json"; "X-API-Key"="una_clave_larga_y_muy_secreta_aqui"} `
  -Body $body
```

Respuesta esperada:
```json
{"ok": true, "data": {"sensor_id": "ESP32-LAB1"}}
```

---

## 9. Paso 5 — Programar el ESP32

### 9.1 Instalar librerías en Arduino IDE

Ve a **Herramientas → Gestor de bibliotecas** e instala:

| Librería | Autor |
|---|---|
| `QMC5883LCompass` | MPrograms |
| `ArduinoJson` | Benoit Blanchon |

También necesitas el **soporte de ESP32** en Arduino IDE:  
Ve a **Archivo → Preferencias** → URLs adicionales:
```
https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
```

Luego **Herramientas → Placa → Gestor de placas** → instala `esp32`.

### 9.2 Conexión del sensor QMC5883L al ESP32

| Pin QMC5883L | Pin ESP32 |
|---|---|
| VCC | 3.3V |
| GND | GND |
| SDA | GPIO 21 |
| SCL | GPIO 22 |

> ⚠️ El QMC5883L opera a **3.3V**. No conectes a 5V.

### 9.3 Configurar el sketch

Abre `esp32/magnetometer.ino` y edita estas variables:

```cpp
const char* WIFI_SSID     = "NOMBRE_DE_TU_RED";
const char* WIFI_PASSWORD = "CLAVE_DE_TU_WIFI";

const char* SERVER_URL    = "https://miltonguerrero.rf.gd/api/readings.php";

const char* SENSOR_ID     = "ESP32-LAB1";   // igual al registrado en BD
const char* API_KEY       = "MI_CLAVE_ESP32"; // igual al registrado en BD
```

### 9.4 Calibrar el magnetómetro

El QMC5883L requiere calibración para compensar el campo magnético local.  
En el sketch ajusta estos valores (obtenidos girando el sensor 360° en cada eje):

```cpp
compass.setCalibration(
  -2000, 2000,   // X min, X max
  -2000, 2000,   // Y min, Y max
  -2000, 2000    // Z min, Z max
);
```

### 9.5 Cargar el sketch

1. Selecciona la placa: **Herramientas → Placa → ESP32 Dev Module**
2. Puerto: **Herramientas → Puerto → COMx** (el que corresponda)
3. Haz clic en **Subir** (▶)
4. Abre el **Monitor Serial** a 115200 baud para ver las lecturas

Salida esperada en Monitor Serial:
```
🧲  MagnetMonitor ESP32 iniciando…
   Conectando a MI_RED_WIFI......
✅ WiFi conectado. IP: 192.168.1.105
B: 5.120e-05 T  (Bx=-3.120e-05  By=4.180e-05  Bz=1.980e-05)
   ✅ Enviado correctamente.
```

### 9.6 Payload que envía el ESP32

```json
POST https://miltonguerrero.rf.gd/api/readings.php
X-API-Key: MI_CLAVE_ESP32
Content-Type: application/json

{
  "sensor_id":   "ESP32-LAB1",
  "field_tesla":  5.12e-05,
  "field_x":     -3.12e-05,
  "field_y":      4.18e-05,
  "field_z":      1.98e-05,
  "temperature":  24.5
}
```

---

## 10. API REST — referencia completa

### Base URL
```
https://miltonguerrero.rf.gd
```

---

### `POST /api/sensors/register` — Registrar un ESP32 (Admin)

**Headers:**
```
Content-Type: application/json
X-API-Key: {ADMIN_KEY de config/config.php}
```

**Body JSON:**
```json
{
  "sensor_id": "ESP32-LAB1",
  "name": "Laboratorio 1",
  "location": "Sala A",
  "firmware": "v2.5",
  "api_key": "CLAVE_SECRETA_ESP32"
}
```

**Respuesta 201:**
```json
{
  "ok": true,
  "data": {
    "sensor_id": "ESP32-LAB1",
    "message": "Sensor 'ESP32-LAB1' registrado exitosamente en la base de datos."
  }
}
```

---

### `GET /api/sensors` — Listar dispositivos registrados

```
GET /api/sensors
```

**Respuesta 200:**
```json
{
  "ok": true,
  "data": [
    {
      "sensor_id": "ESP32-DEMO",
      "name": "Sensor demo",
      "location": "Laboratorio 1",
      "active": 1,
      "created_at": "2026-11-20 20:00:00"
    }
  ]
}
```

---

### `GET /api/sensors/{id}/stats` — Estadísticas de un sensor

Calcula el total de mediciones acumuladas, promedio, máximo y mínimo en µT, temperatura promedio y última vez visto.

```
GET /api/sensors/ESP32-DEMO/stats
```

**Respuesta 200:**
```json
{
  "ok": true,
  "data": {
    "sensor": {
      "sensor_id": "ESP32-DEMO",
      "name": "Sensor demo",
      "location": "Laboratorio 1"
    },
    "stats": {
      "total_readings": 1540,
      "avg_uT": 51.45,
      "max_uT": 88.12,
      "min_uT": 23.04,
      "avg_temp_c": 24.8,
      "last_seen": "2026-11-21 08:50:00"
    }
  }
}
```

---

### `GET /api/sensors/{id}/latest` — Última medición de un sensor

Obtiene la última medición registrada por un dispositivo específico en tiempo real.

```
GET /api/sensors/ESP32-DEMO/latest
```

**Respuesta 200:**
```json
{
  "ok": true,
  "data": {
    "id": 1540,
    "sensor_id": "ESP32-DEMO",
    "field_tesla": 0.0000512,
    "field_uT": 51.2,
    "field_x": -0.0000312,
    "field_y": 0.0000418,
    "field_z": 0.0000198,
    "temperature": 25.1,
    "recorded_at": "2026-11-21 08:50:00",
    "has_data": true,
    "raw_json_parsed": { ... }
  }
}
```

---

### `POST /api/readings` — Recibir medición del ESP32

**Headers requeridos:**
```
Content-Type: application/json
X-API-Key: {api_key del sensor en tabla sensors}
User-Agent: ESP32-MagnetMonitor/2.5
```

**Body JSON:**

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `sensor_id` | string | ✅ | ID del ESP32 registrado |
| `field_tesla` | float | ⚠️ | Magnitud total \|B\| en Tesla |
| `field_x` | float | ⚠️ | Componente Bx (Tesla) |
| `field_y` | float | ⚠️ | Componente By (Tesla) |
| `field_z` | float | ⚠️ | Componente Bz (Tesla) |
| `temperature` | float | ❌ | Temperatura del sensor (°C) |
| `latitude` | float | ❌ | Coordenada GPS (opcional) |
| `longitude` | float | ❌ | Coordenada GPS (opcional) |

> ⚠️ Se requiere `field_tesla` **o** los tres componentes `field_x/y/z`. Si se omite `field_tesla`, el backend calcula automáticamente √(Bx²+By²+Bz²).

**Respuesta 201:**
```json
{
  "ok": true,
  "data": {
    "id": 1541,
    "sensor_id": "ESP32-DEMO",
    "field_tesla": 0.0000512,
    "field_uT": 51.2,
    "server_time": "2026-11-21 08:55:00",
    "message": "Medición recibida e insertada exitosamente en MySQL."
  }
}
```

---

### `GET /api/readings` — Consultar histórico de mediciones

**Parámetros de consulta:**

| Param | Tipo | Default | Descripción |
|---|---|---|---|
| `sensor_id` | string | — | Filtrar por ID de sensor |
| `limit` | int | 200 | Máximo de registros (máx 1000) |
| `offset` | int | 0 | Paginación |
| `from` | datetime | — | Fecha inicio `YYYY-MM-DD HH:MM:SS` |
| `to` | datetime | — | Fecha fin `YYYY-MM-DD HH:MM:SS` |
| `after_id` | int | — | Solo registros con id > N (polling incremental) |

**Ejemplo:**
```
GET /api/readings?sensor_id=ESP32-DEMO&limit=100&after_id=1500
```

---

### `GET /api/export.php` — Exportar CSV

```
GET /api/export.php?sensor_id=ESP32-LAB1
GET /api/export.php?from=2026-11-20&to=2026-11-21
```

Descarga un archivo `.csv` con columnas:
`id, sensor_id, recorded_at, field_T, field_uT, field_x, field_y, field_z, temperature`

---

### `GET /api/diagnostics.php` — Salud y diagnóstico del sistema

Comprueba versión de PHP, conectividad y latencia de MySQL, existencia de tablas y devuelve la última lectura registrada en la base de datos.

```
GET /api/diagnostics.php
```

**Respuesta 200 (Saludable):**
```json
{
  "ok": true,
  "data": {
    "timestamp": "2026-11-21 08:30:00",
    "php": { "version": "8.2.0", "pdo_mysql": true },
    "database": { "connected": true, "database": "if0_43469375_magnet", "latency_ms": 14.5 },
    "tables": {
      "sensors": { "exists": true, "count": 2 },
      "readings": { "exists": true, "count": 1420 }
    },
    "latest_reading": {
      "id": 1420,
      "sensor_id": "ESP32-LAB1",
      "field_tesla": 0.0000512,
      "field_uT": 51.2,
      "temperature": 25.4,
      "recorded_at": "2026-11-21 08:29:58",
      "raw_json_parsed": { ... }
    }
  },
  "meta": { "status": "HEALTHY" }
}
```

---

### `POST /api/diagnostics.php` — Echo Test (Recepción en servidor)

Permite enviar cualquier JSON para verificar qué está recibiendo el servidor exactamente (cabeceras, IP, longitud, JSON parseado) sin insertar en la base de datos.

---

## 11. Panel de Pruebas y Diagnóstico en la Web

La aplicación web ahora incluye una sección dedicada **"🛠️ Panel de Pruebas & Diagnóstico del Servidor"**:

1. **Prueba de Conexión en 1 Clic (`🩺 Probar Conexión Completa`)**:
   - Diagnostica en vivo el servidor PHP, el acceso a MySQL, las tablas `sensors` y `readings` y la latencia en milisegundos.
   - Si la base de datos falla o faltan credenciales, muestra un mensaje de alerta guiando a la solución exacta.

2. **Inyector de Lecturas de Prueba (Simulador ESP32)**:
   - Permite enviar una lectura POST real a `api/readings.php` directamente desde el navegador con un Sensor ID, API Key y valores Bx, By, Bz o B total.
   - Muestra el código HTTP de respuesta en vivo (ej. 201 Created o 403 Forbidden si la clave es errónea) y el tiempo de respuesta.

3. **Inspector de Última Lectura Recibida en Servidor**:
   - Muestra la última medición almacenada en la base de datos MySQL por cualquier ESP32 o prueba (ID, Sensor, Fecha/Hora, B, µT, Vector X/Y/Z y el JSON crudo `raw_json`).

4. **Consola de Eventos y Red en Tiempo Real**:
   - Muestra cada llamada HTTP, respuestas del servidor y advertencias en una consola en vivo con timestamps.

---

## 12. Leyes electromagnéticas implementadas

| Ley | Fórmula | Calcula |
|---|---|---|
| **Biot‑Savart** | B = µ₀IR² / 2(R²+x²)^(3/2) | Campo axial de un lazo circular |
| **Ampère** | B = µ₀I / 2πr | Campo de un cable recto largo |
| **Solenoide** | B = µ₀(N/L)I | Campo interior de una solenoide |
| **Toroide** | B = µ₀NI / 2πr | Campo interior de un toroide |
| **Faraday** | ε = −NΔΦ/Δt | FEM inducida por variación de flujo |
| **Lorentz** | F = qvB sin(θ) | Fuerza sobre carga en movimiento |

Constante usada: **µ₀ = 4π × 10⁻⁷ T·m/A**

---

## 13. Modo simulación (sin hardware)

Si el backend PHP **no responde** (modo offline o durante desarrollo local), el frontend activa automáticamente un **simulador de señal** browniana + componente senoidal + ruido aleatorio. El monitor se ve exactamente igual que con datos reales.

Para forzar el modo simulación: abre `index.html` directamente como archivo local (`file:///`).

---

## 14. Solución de problemas

### El ESP32 recibe error HTTP 403
- Verifica que el `sensor_id` y `api_key` del sketch coincidan exactamente con los registrados en la tabla `sensors`.
- Verifica que el sensor esté `active = 1` en la BD.

### El ESP32 recibe error HTTP 500
- Revisa `config/db.php` — credenciales incorrectas o host de MySQL erróneo.
- En phpMyAdmin ejecuta `SHOW TABLES;` para confirmar que las tablas existen.

### La gráfica no recibe datos nuevos
- Abre la consola del navegador (F12) y busca errores de red en la pestaña **Network**.
- Comprueba que `READINGS_URL` en `script.js` apunta a tu dominio correcto.

### phpMyAdmin muestra error al ejecutar el schema
- InfinityFree limita el tamaño de las sentencias SQL. Ejecuta el schema en bloques: primero `CREATE TABLE sensors`, luego `CREATE TABLE readings`, luego la vista.

### El hosting bloquea las peticiones del ESP32
- Algunos hosting gratuitos bloquean peticiones sin cabecera `User-Agent`. Añade en el sketch:
  ```cpp
  http.addHeader("User-Agent", "ESP32-MagnetMonitor/2.0");
  ```

---

## Créditos

- **Chart.js** v4.4.3 — MIT License
- **QMC5883LCompass** library — MPrograms
- **ArduinoJson** — Benoit Blanchon

---

*Desarrollado para el proyecto Monitor Magnético · 2026*
