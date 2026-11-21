// ══════════════════════════════════════════════════════════════════
// MagnetMonitor ESP32 – magnetometer.ino  (v2.5 REST)
//
// Sensor soportado: QMC5883L (compatible HMC5883L)
//                   También adaptable a MPU9250, LSM303, etc.
//
// Protocolo: Solicitudes periódicas HTTP POST (sin MQTT persistente)
//            100% compatible con InfinityFree y hosting compartido.
//
// Librerías requeridas (Gestor de bibliotecas de Arduino IDE):
//   - QMC5883LCompass  by MPrograms
//   - ArduinoJson      by Benoit Blanchon
//   - WiFi             (incluida en ESP32 core)
//   - HTTPClient       (incluida en ESP32 core)
// ══════════════════════════════════════════════════════════════════

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <QMC5883LCompass.h>

// ─── Configuración WiFi ──────────────────────────────────────────
const char* WIFI_SSID     = "TU_RED_WIFI";
const char* WIFI_PASSWORD = "TU_CLAVE_WIFI";

// ─── Configuración del servidor ──────────────────────────────────
// En producción usa tu dominio (ej. https://miltonguerrero.rf.gd/api/readings)
// O en red local con XAMPP (ej. http://192.168.1.100/MONITOR-MAGNETICO/api/readings)
const char* SERVER_URL    = "https://miltonguerrero.rf.gd/api/readings";

const char* SENSOR_ID     = "ESP32-DEMO";       // debe coincidir con la BD
const char* API_KEY       = "DEMO_KEY_1234";   // debe coincidir con la BD

// ─── Intervalo de muestreo (HTTP periódico) ──────────────────────
// En InfinityFree 2000 ms (2 s) es el ritmo óptimo para evitar rate limits
const uint32_t SAMPLE_INTERVAL_MS = 2000;

// ─── Objeto del magnetómetro ─────────────────────────────────────
QMC5883LCompass compass;

// ─── Estado interno ──────────────────────────────────────────────
uint32_t lastSendTime = 0;
int      failCount    = 0;
const int MAX_FAILS   = 5;      // reiniciar WiFi tras N fallos consecutivos

// ════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n🧲  MagnetMonitor ESP32 v2.5 iniciando…");

  // Inicializar I²C y sensor
  Wire.begin(21, 22);           // SDA=21, SCL=22  (pines por defecto ESP32)
  compass.init();
  compass.setCalibration(-2000, 2000, -2000, 2000, -2000, 2000);
  // ↑ Ajusta estos valores con tu calibración real girando el sensor

  // Conectar WiFi
  connectWiFi();
}

// ════════════════════════════════════════════════════════════════
void loop() {
  uint32_t now = millis();
  if (now - lastSendTime >= SAMPLE_INTERVAL_MS) {
    lastSendTime = now;
    readAndSend();
  }

  // Reconexión automática WiFi si se cae
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠ WiFi desconectado. Reconectando…");
    connectWiFi();
  }
}

// ════════════════════════════════════════════════════════════════
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("   Conectando a WiFi ");
  Serial.print(WIFI_SSID);

  uint8_t tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 25) {
    delay(400);
    Serial.print('.');
    tries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi conectado exitosamente.");
    Serial.print("   IP local: ");
    Serial.println(WiFi.localIP());
    failCount = 0;
  } else {
    Serial.println("\n❌ No se pudo conectar a WiFi. Reintentando en el siguiente ciclo.");
  }
}

// ════════════════════════════════════════════════════════════════
void readAndSend() {
  // ── Leer magnetómetro ────────────────────────────────────────
  compass.read();
  int raw_x = compass.getX();
  int raw_y = compass.getY();
  int raw_z = compass.getZ();

  // Convertir unidades: QMC5883L entrega en mGauss → pasar a Tesla
  // 1 Gauss = 1e-4 T  →  1 mGauss = 1e-7 T
  float Bx = raw_x * 1e-7f;
  float By = raw_y * 1e-7f;
  float Bz = raw_z * 1e-7f;

  float Btotal = sqrt(Bx*Bx + By*By + Bz*Bz);

  Serial.printf("📊 B: %.4e T (%.2f µT) | Bx=%.2e By=%.2e Bz=%.2e\n",
                Btotal, Btotal * 1e6, Bx, By, Bz);

  if (WiFi.status() != WL_CONNECTED) return;

  // ── Construir JSON ───────────────────────────────────────────
  StaticJsonDocument<256> doc;
  doc["sensor_id"]   = SENSOR_ID;
  doc["field_tesla"] = Btotal;
  doc["field_x"]     = Bx;
  doc["field_y"]     = By;
  doc["field_z"]     = Bz;
  // doc["temperature"] = 24.5; // opcional

  String payload;
  serializeJson(doc, payload);

  // ── Enviar HTTP POST al servidor REST ─────────────────────────
  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key",    API_KEY);
  http.addHeader("User-Agent",   "ESP32-MagnetMonitor/2.5"); // Requerido para InfinityFree
  http.setTimeout(5000);

  int httpCode = http.POST(payload);

  if (httpCode == 201 || httpCode == 200) {
    Serial.printf("   ✅ POST OK [%d] -> Medición guardada en MySQL.\n", httpCode);
    failCount = 0;
  } else {
    failCount++;
    String responseBody = http.getString();
    Serial.printf("   ❌ Error HTTP %d (fallo %d/%d)\n", httpCode, failCount, MAX_FAILS);
    if (responseBody.length() > 0 && responseBody.length() < 200) {
      Serial.printf("      Servidor: %s\n", responseBody.c_str());
    }

    if (failCount >= MAX_FAILS) {
      Serial.println("   🔄 Demasiados fallos consecutivos. Reiniciando WiFi…");
      WiFi.disconnect();
      failCount = 0;
    }
  }

  http.end();
}
