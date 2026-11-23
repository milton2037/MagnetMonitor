// ══════════════════════════════════════════════════════════════════
// MagnetMonitor ESP32 – magnetometer.ino  (v3.3 Hotspot Móvil Estable)
//
// ⚠️ ESTÁS EN MODO PRUEBA (SIN SENSOR FÍSICO):
//    El ESP32 NO bloqueará el bus I2C. Arrancará al instante,
//    conectará a tu WiFi y enviará mediciones simuladas de prueba
//    cada 2 segundos a tu servidor para comprobar la conexión y MySQL.
//
//    Cuando compres el sensor magnetómetro (QMC5883L/HMC5883L),
//    solo debes cambiar USAR_SENSOR_FISICO a 'true'.
// ══════════════════════════════════════════════════════════════════

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

// ─── ¿TIENES EL SENSOR FÍSICO CONECTADO AHORA? ───────────────────
// Como NO tienes el sensor conectado, déjalo en FALSE para evitar
// que el ESP32 se congele intentando leer los pines I2C vacíos.
#define USAR_SENSOR_FISICO  false

#if USAR_SENSOR_FISICO
  #include <Wire.h>
  #include <QMC5883LCompass.h>
  QMC5883LCompass compass;
#endif

// ─── 1. CONFIGURACIÓN DE RED WIFI ────────────────────────────────
const char* WIFI_SSID     = "Andres-3737-2G";              // ← Tu red WiFi conectada
const char* WIFI_PASSWORD = "00A00MG2.5";                  // ← Tu contraseña WiFi

// ─── 2. CONFIGURACIÓN DEL SERVIDOR (ALWAYSDATA) ──────────────────
const char* SERVER_URL    = "https://magnetmonitor.alwaysdata.net/api/readings.php";
const char* SENSOR_ID     = "ESP32-DEMO";        // Sensor registrado en la BD
const char* API_KEY       = "DEMO_KEY_1234";     // Clave del sensor en la BD

// ─── 3. INTERVALO DE TRANSMISIÓN ─────────────────────────────────
const uint32_t SAMPLE_INTERVAL_MS = 3000;        // 1 paquete cada 3 segundos

// ─── 4. PINES Y ESTADO ───────────────────────────────────────────
#define LED_PIN 2   // LED azul integrado en la placa ESP32 DevKit

uint32_t lastSendTime     = 0;
uint32_t lastReconnectTry = 0;
uint32_t packetCounter    = 0;
int failCount             = 0;
float testAngle           = 0.0f;

// ════════════════════════════════════════════════════════════════
void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  Serial.begin(115200);
  delay(1000);

  // Destello inicial de confirmación
  digitalWrite(LED_PIN, LOW);
  delay(150);
  digitalWrite(LED_PIN, HIGH);
  delay(150);
  digitalWrite(LED_PIN, LOW);

  Serial.println("\n");
  Serial.println("==================================================");
  Serial.println(">>> 🧲 MAGNETIC LAB - MAGNETOMETER ESP32        <<<");
  Serial.println("==================================================");

#if USAR_SENSOR_FISICO
  Serial.println("🔌 Modo: Sensor Físico I2C (QMC5883L/HMC5883L)");
  pinMode(21, INPUT_PULLUP);
  pinMode(22, INPUT_PULLUP);
  Wire.begin(21, 22);
  compass.init();
#else
  Serial.println("ℹ️  Modo: PRUEBA DE CONECTIVIDAD (Sin sensor físico)");
  Serial.println("    Generando ondas de prueba matemáticas.");
  Serial.println("    Destino: " + String(SERVER_URL));
#endif

  Serial.println("--------------------------------------------------");
  Serial.printf("📡 Conectando a WiFi '%s'...\n", WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int intentos = 0;
  while (WiFi.status() != WL_CONNECTED && intentos < 30) {
    delay(500);
    Serial.print(".");
    digitalWrite(LED_PIN, !digitalRead(LED_PIN)); // Parpadeo suave
    intentos++;
  }

  digitalWrite(LED_PIN, LOW);

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi conectado exitosamente!");
    Serial.print("   → IP del ESP32: ");
    Serial.println(WiFi.localIP());
    Serial.print("   → Intensidad de señal (RSSI): ");
    Serial.println(WiFi.RSSI());
  } else {
    Serial.println("\n❌ No fue posible conectar al WiFi todavía.");
    Serial.println("   El ESP32 continuará intentando en segundo plano.");
  }

  Serial.println("==================================================\n");
}

// ════════════════════════════════════════════════════════════════
void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    readAndSend();
    delay(SAMPLE_INTERVAL_MS);
  } else {
    Serial.println("⚠️ WiFi desconectado. Esperando que el ESP32 reconecte...");
    delay(3000);
  }
}

// ════════════════════════════════════════════════════════════════
void readAndSend() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  packetCounter++;
  float Bx = 0.0f;
  float By = 0.0f;
  float Bz = 0.0f;
  float Btotal = 0.0f;
  float temp = 24.5f;

#if USAR_SENSOR_FISICO
  compass.read();
  Bx = compass.getX() * 1e-7f;
  By = compass.getY() * 1e-7f;
  Bz = compass.getZ() * 1e-7f;
  Btotal = sqrt(Bx * Bx + By * By + Bz * Bz);
#else
  // Generar datos senoidales suaves simulando campo terrestre (~30 a 60 uT)
  testAngle += 0.20f;
  Bx = (32.0f + 14.0f * sin(testAngle)) * 1e-6f;
  By = (-18.0f + 10.0f * cos(testAngle * 0.8f)) * 1e-6f;
  Bz = (40.0f + 8.0f * sin(testAngle * 1.4f)) * 1e-6f;
  Btotal = sqrt(Bx * Bx + By * By + Bz * Bz);
  temp = 24.0f + 2.0f * sin(testAngle * 0.1f);
#endif

  // ── 1. IMPRIMIR EN MONITOR SERIAL ─────────────────────────────
  Serial.println("\n--------------------------------------------------");
  Serial.printf("📤 ENVIANDO PAQUETE #%lu A INFINITYFREE\n", packetCounter);
  Serial.printf("   Campo |B|: %.2f µT (%.4e T)\n", Btotal * 1e6, Btotal);
  Serial.printf("   Vector:    Bx=%.2f µT | By=%.2f µT | Bz=%.2f µT\n", Bx * 1e6, By * 1e6, Bz * 1e6);
  Serial.printf("   Temp:      %.1f °C\n", temp);

  // ── 2. PREPARAR JSON ──────────────────────────────────────────
  StaticJsonDocument<384> doc;
  doc["sensor_id"]   = SENSOR_ID;
  doc["field_tesla"] = Btotal;
  doc["field_x"]     = Bx;
  doc["field_y"]     = By;
  doc["field_z"]     = Bz;
  doc["temperature"] = temp;
  doc["packet_num"]  = packetCounter;
  doc["hw_mode"]     = "PRUEBA_ESP32_SIN_SENSOR";

  String payload;
  serializeJson(doc, payload);

  // ── 3. ENVIAR HTTP POST A INFINITYFREE ────────────────────────
  HTTPClient http;
  String urlStr = String(SERVER_URL);
  bool isHttps  = urlStr.startsWith("https://");

  WiFiClient plainClient;
  WiFiClientSecure secureClient;

  if (isHttps) {
    secureClient.setInsecure(); // Vital: el ESP32 no tiene el certificado raíz de Let's Encrypt/Cloudflare
    secureClient.setTimeout(10);
    http.begin(secureClient, SERVER_URL);
  } else {
    plainClient.setTimeout(10);
    http.begin(plainClient, SERVER_URL);
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key",    API_KEY);
  http.addHeader("User-Agent",   "ESP32-MagnetMonitor/3.0");
  http.setTimeout(10000);

  uint32_t tStart = millis();
  int httpCode = http.POST(payload);
  uint32_t elapsed = millis() - tStart;

  // ── 4. EVALUAR RESPUESTA ──────────────────────────────────────
  String resp = http.getString();

  if (httpCode == 201) {
    // ¡ÉXITO REAL! La base de datos confirmó la inserción con código 201 Created
    digitalWrite(LED_PIN, HIGH);
    delay(120);
    digitalWrite(LED_PIN, LOW);

    failCount = 0;
    Serial.printf("✅ LECTURA GUARDADA [201 Created] (%lu ms)\n", elapsed);

    StaticJsonDocument<256> respDoc;
    if (deserializeJson(respDoc, resp) == DeserializationError::Ok) {
      long insertedId = respDoc["data"]["id"] | 0;
      float fUt       = respDoc["data"]["field_uT"] | 0.0f;
      Serial.printf("   → ID generado en MySQL: #%ld\n", insertedId);
      Serial.printf("   → Campo guardado: %.2f µT\n", fUt);
    }
  } else if (httpCode == 200) {
    // El servidor respondió 200 OK. Verificamos si es JSON o si devolvió HTML
    StaticJsonDocument<384> respDoc;
    DeserializationError err = deserializeJson(respDoc, resp);

    if (err == DeserializationError::Ok && respDoc["ok"] == true) {
      digitalWrite(LED_PIN, HIGH); delay(120); digitalWrite(LED_PIN, LOW);
      long insertedId = respDoc["data"]["id"] | 0;
      Serial.printf("✅ LECTURA GUARDADA [200 OK] (%lu ms) → ID #%ld\n", elapsed, insertedId);
    } else {
      // ⚠️ El servidor devolvió 200 OK pero NO es nuestra API (devolvió index.html o filtro de hosting)
      Serial.printf("⚠️ ALERTA: Servidor devolvió 200 pero NO es la API de base de datos (%lu ms)\n", elapsed);
      Serial.println("   Contenido recibido del servidor:");
      Serial.println(resp.substring(0, 300));
    }
  } else {
    // Parpadeo de error (3 veces)
    for (int i = 0; i < 3; i++) {
      digitalWrite(LED_PIN, HIGH); delay(70);
      digitalWrite(LED_PIN, LOW); delay(70);
    }

    failCount++;
    Serial.printf("❌ RESPUESTA SERVIDOR ERROR [%d] (%lu ms)\n", httpCode, elapsed);

    if (httpCode == 403) {
      Serial.println("   → Causa: Clave X-API-Key rechazada o sensor no registrado.");
    } else if (httpCode == 500) {
      Serial.println("   → Causa: Error 500 en MySQL. Revisa que config/db.php tenga la clave correcta de InfinityFree.");
    } else if (httpCode < 0) {
      Serial.printf("   → Causa de red/SSL: %s\n", http.errorToString(httpCode).c_str());
    }

    if (resp.length() > 0) {
      Serial.print("   Detalle: ");
      Serial.println(resp.substring(0, 300));
    }
  }

  Serial.println("--------------------------------------------------");
  http.end();
}
