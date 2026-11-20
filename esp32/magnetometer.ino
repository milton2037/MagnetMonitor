// ══════════════════════════════════════════════════════════════════
// MagnetMonitor ESP32 – magnetometer.ino
//
// Sensor soportado: QMC5883L (compatible HMC5883L)
//                   También adaptable a MPU9250, LSM303, etc.
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
const char* SERVER_URL    = "http://192.168.1.100:3000/api/readings";
// Cambia la IP por la de tu PC donde corre el backend.
// En producción usa un dominio con HTTPS.

const char* SENSOR_ID     = "ESP32-LAB1";
const char* API_KEY       = "DEMO_KEY_1234";   // debe coincidir con la BD

// ─── Intervalo de muestreo ───────────────────────────────────────
const uint32_t SAMPLE_INTERVAL_MS = 1000;   // 1 lectura por segundo

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
  Serial.println("\n🧲  MagnetMonitor ESP32 iniciando…");

  // Inicializar I²C y sensor
  Wire.begin(21, 22);           // SDA=21, SCL=22  (pines por defecto ESP32)
  compass.init();
  compass.setCalibration(-2000, 2000, -2000, 2000, -2000, 2000);
  // ↑ Ajusta estos valores con tu calibración real

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

  // Reconexión automática WiFi
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠ WiFi desconectado. Reconectando…");
    connectWiFi();
  }
}

// ════════════════════════════════════════════════════════════════
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("   Conectando a ");
  Serial.print(WIFI_SSID);

  uint8_t tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 20) {
    delay(500);
    Serial.print('.');
    tries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi conectado. IP: " + WiFi.localIP().toString());
    failCount = 0;
  } else {
    Serial.println("\n❌ No se pudo conectar. Reintentando en el siguiente ciclo.");
  }
}

// ════════════════════════════════════════════════════════════════
void readAndSend() {
  // ── Leer magnetómetro ────────────────────────────────────────
  compass.read();
  int   raw_x = compass.getX();
  int   raw_y = compass.getY();
  int   raw_z = compass.getZ();

  // Convertir unidades: QMC5883L entrega en mGauss → pasar a Tesla
  // 1 Gauss = 1e-4 T  →  1 mGauss = 1e-7 T
  float Bx = raw_x * 1e-7f;
  float By = raw_y * 1e-7f;
  float Bz = raw_z * 1e-7f;

  float Btotal = sqrt(Bx*Bx + By*By + Bz*Bz);

  Serial.printf("B: %.4e T  (Bx=%.4e  By=%.4e  Bz=%.4e)\n",
                Btotal, Bx, By, Bz);

  if (WiFi.status() != WL_CONNECTED) return;

  // ── Construir JSON ───────────────────────────────────────────
  StaticJsonDocument<256> doc;
  doc["sensor_id"]   = SENSOR_ID;
  doc["field_tesla"] = Btotal;
  doc["field_x"]     = Bx;
  doc["field_y"]     = By;
  doc["field_z"]     = Bz;
  // doc["temperature"] = readTemp();   // descomenta si tienes sensor de temp

  String payload;
  serializeJson(doc, payload);

  // ── Enviar HTTP POST ─────────────────────────────────────────
  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key",    API_KEY);
  http.setTimeout(5000);

  int httpCode = http.POST(payload);

  if (httpCode == 201) {
    Serial.println("   ✅ Enviado correctamente.");
    failCount = 0;
  } else {
    failCount++;
    Serial.printf("   ❌ Error HTTP %d (fallo %d/%d)\n", httpCode, failCount, MAX_FAILS);
    if (failCount >= MAX_FAILS) {
      Serial.println("   🔄 Demasiados fallos. Reiniciando WiFi…");
      WiFi.disconnect();
      failCount = 0;
    }
  }

  http.end();
}

// ════════════════════════════════════════════════════════════════
// OPCIONAL: si tu sensor tiene termómetro interno (ej. MPU9250)
// float readTemp() {
//   return compass.getTemperature(); // ajusta según librería
// }
// ════════════════════════════════════════════════════════════════
