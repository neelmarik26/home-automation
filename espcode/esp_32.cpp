#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

// ─── Hardware Pin Mapping (NodeMCU D5..D8 → ESP32 GPIO) ──────────
#define LED_BUILTIN   2      // Built‑in LED (active LOW on most dev boards)
#define PIN_BTN1     14      // D5
#define PIN_BTN2     12      // D6
#define PIN_BTN3     13      // D7
#define PIN_BTN4     15      // D8

// ─── EEPROM Configuration ─────────────────────────────────────────
#define EEPROM_SIZE   128

// ─── Fallback / Hard‑coded Wi‑Fi Credentials ──────────────────────
const char* FALLBACK_SSID     = "neel pc";
const char* FALLBACK_PASSWORD = "neel2006";

// ─── WebSocket Server Config ──────────────────────────────────────
const char* WS_HOST = "home-automation-1-8kqb.onrender.com";
const uint16_t WS_PORT = 443;
const char* WS_PATH = "/ws";

// ─── Global Objects & State ───────────────────────────────────────
WebSocketsClient webSocket;
bool webSocketConnected = false;
unsigned long lastWebSocketAttempt = 0;
const unsigned long WEBSOCKET_RETRY_INTERVAL = 5000; // ms

unsigned long lastWiFiCheck = 0;
const unsigned long WIFI_CHECK_INTERVAL = 2000;      // ms

// ─── Forward Declarations ─────────────────────────────────────────
void connectToWiFi(const char* ssid, const char* password);
void saveCredentials(String ssid, String pass);
String readSSID();
String readPassword();
void clearCredentials();
void connectWebSocket();
void handleWebSocketConnection();
void checkWiFiStatus();
void fallbackToSavedCredentials();
void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length);

// ─── WebSocket Event Handler ──────────────────────────────────────
void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] Disconnected");
      webSocketConnected = false;
      break;

    case WStype_CONNECTED:
      Serial.printf("[WS] Connected to: wss://%s%s\n", WS_HOST, WS_PATH);
      webSocketConnected = true;
      webSocket.sendTXT("Hello from ESP32!");
      break;

    case WStype_TEXT:
      {
        Serial.printf("[WS] Message received (%d bytes)\n", length);

        // Parse JSON
        StaticJsonDocument<512> doc;
        DeserializationError err = deserializeJson(doc, payload, length);
        if (err) {
          Serial.print("JSON parse error: ");
          Serial.println(err.c_str());
          break;
        }

        // ── 1. Button control (same as original second snippet) ──
        if (doc.containsKey("button") && doc.containsKey("status")) {
          const char* btn = doc["button"];
          int sts = doc["status"];
          Serial.printf("%s status: %d\n", btn, sts);

          if (strcmp(btn, "all") == 0) {
            digitalWrite(PIN_BTN1, LOW);
            digitalWrite(PIN_BTN2, LOW);
            digitalWrite(PIN_BTN3, LOW);
            digitalWrite(PIN_BTN4, LOW);
          } else if (strcmp(btn, "btn1") == 0) {
            digitalWrite(PIN_BTN1, sts == 1 ? HIGH : LOW);
          } else if (strcmp(btn, "btn2") == 0) {
            digitalWrite(PIN_BTN2, sts == 1 ? HIGH : LOW);
          } else if (strcmp(btn, "btn3") == 0) {
            digitalWrite(PIN_BTN3, sts == 1 ? HIGH : LOW);
          } else if (strcmp(btn, "btn4") == 0) {
            digitalWrite(PIN_BTN4, sts == 1 ? HIGH : LOW);
          }
        }

        // ── 2. New Wi‑Fi credentials ──
        else if (doc.containsKey("ssid") && doc.containsKey("password")) {
          const char* newSSID = doc["ssid"];
          const char* newPASS = doc["password"];
          Serial.println("New credentials received via WebSocket!");

          // Try new credentials
          connectToWiFi(newSSID, newPASS);
          if (WiFi.status() == WL_CONNECTED) {
            Serial.println("✅ Connected with new credentials, saving...");
            saveCredentials(newSSID, newPASS);
            // Re‑establish WebSocket because Wi‑Fi may have changed
            webSocketConnected = false;
            lastWebSocketAttempt = 0;
          } else {
            Serial.println("❌ New credentials failed, reverting.");
            fallbackToSavedCredentials();
          }
        }
      }
      break;

    case WStype_BIN:
      Serial.printf("[WS] Binary data: %d bytes\n", length);
      break;

    case WStype_PING:
      Serial.println("[WS] Ping");
      break;

    case WStype_PONG:
      Serial.println("[WS] Pong");
      break;

    case WStype_ERROR:
      Serial.println("[WS] Error");
      break;
  }
}

// ─── Wi‑Fi Connection Helper ──────────────────────────────────────
void connectToWiFi(const char* ssid, const char* password) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.printf("Connecting to '%s'", ssid);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWi‑Fi connected!");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWi‑Fi connection failed.");
    WiFi.disconnect();
  }
}

// ─── EEPROM Helpers ───────────────────────────────────────────────
void saveCredentials(String ssid, String pass) {
  EEPROM.begin(EEPROM_SIZE);
  // Write SSID at address 0..31
  for (int i = 0; i < 32; i++) {
    EEPROM.write(i, (i < ssid.length()) ? ssid[i] : 0);
  }
  // Write password at address 32..63
  for (int i = 0; i < 32; i++) {
    EEPROM.write(32 + i, (i < pass.length()) ? pass[i] : 0);
  }
  EEPROM.commit();
  Serial.println("Credentials saved to EEPROM");
}

String readSSID() {
  EEPROM.begin(EEPROM_SIZE);
  char buf[33] = {0};
  for (int i = 0; i < 32; i++) {
    byte c = EEPROM.read(i);
    if (c == 0 || c == 0xFF) break;
    buf[i] = (char)c;
  }
  return String(buf);
}

String readPassword() {
  EEPROM.begin(EEPROM_SIZE);
  char buf[33] = {0};
  for (int i = 0; i < 32; i++) {
    byte c = EEPROM.read(32 + i);
    if (c == 0 || c == 0xFF) break;
    buf[i] = (char)c;
  }
  return String(buf);
}

void clearCredentials() {
  EEPROM.begin(EEPROM_SIZE);
  for (int i = 0; i < EEPROM_SIZE; i++) EEPROM.write(i, 0);
  EEPROM.commit();
  Serial.println("EEPROM cleared");
}

void fallbackToSavedCredentials() {
  String savedSSID = readSSID();
  String savedPASS = readPassword();
  if (savedSSID.length() > 0 && savedSSID.length() <= 31) {
    Serial.println("Reverting to saved credentials...");
    connectToWiFi(savedSSID.c_str(), savedPASS.c_str());
    // Force WebSocket reconnection
    webSocketConnected = false;
    lastWebSocketAttempt = 0;
  } else {
    Serial.println("No valid saved credentials, using fallback.");
    connectToWiFi(FALLBACK_SSID, FALLBACK_PASSWORD);
    webSocketConnected = false;
    lastWebSocketAttempt = 0;
  }
}

// ─── WebSocket Connection Management ─────────────────────────────
void connectWebSocket() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WS] Cannot connect – no Wi‑Fi");
    webSocketConnected = false;
    return;
  }

  Serial.println("[WS] Connecting to server...");
  webSocket.beginSSL(WS_HOST, WS_PORT, WS_PATH);
  // On ESP32, beginSSL sets up TLS automatically
  // (Certificates are validated using the built‑in root store)
}

void handleWebSocketConnection() {
  // Attempt reconnect if Wi‑Fi is up but WS is down
  if (WiFi.status() == WL_CONNECTED && !webSocketConnected) {
    unsigned long now = millis();
    if (now - lastWebSocketAttempt >= WEBSOCKET_RETRY_INTERVAL) {
      lastWebSocketAttempt = now;
      connectWebSocket();
    }
  }
}

// ─── Wi‑Fi Status Monitor ─────────────────────────────────────────
void checkWiFiStatus() {
  static bool lastWiFiStatus = false;
  bool currentWiFiStatus = (WiFi.status() == WL_CONNECTED);
  if (currentWiFiStatus != lastWiFiStatus) {
    if (currentWiFiStatus) {
      Serial.println("✅ Wi‑Fi reconnected");
      webSocketConnected = false;
      lastWebSocketAttempt = 0;
    } else {
      Serial.println("❌ Wi‑Fi disconnected");
      webSocketConnected = false;
    }
    lastWiFiStatus = currentWiFiStatus;
  }
}

// ─── Setup ────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n====================================");
  Serial.println("   ESP32 Home Automation Client");
  Serial.println("====================================");

  // Init pins
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);  // LED off (active LOW on most ESP32 boards)
  pinMode(PIN_BTN1, OUTPUT); digitalWrite(PIN_BTN1, LOW);
  pinMode(PIN_BTN2, OUTPUT); digitalWrite(PIN_BTN2, LOW);
  pinMode(PIN_BTN3, OUTPUT); digitalWrite(PIN_BTN3, LOW);
  pinMode(PIN_BTN4, OUTPUT); digitalWrite(PIN_BTN4, LOW);

  // Try stored Wi‑Fi credentials first, then fallback
  String ssid = readSSID();
  String pass = readPassword();
  if (ssid.length() > 0 && ssid.length() <= 31) {
    Serial.println("Using stored Wi‑Fi credentials.");
    connectToWiFi(ssid.c_str(), pass.c_str());
  } else {
    Serial.println("No stored credentials, using fallback.");
    connectToWiFi(FALLBACK_SSID, FALLBACK_PASSWORD);
  }

  // Configure WebSocket
  webSocket.onEvent(onWebSocketEvent);
  webSocket.setReconnectInterval(5000);          // auto‑reconnect every 5s
  webSocket.enableHeartbeat(15000, 3000, 2);     // ping every 15s, 3s timeout, 2 failures = disconnect

  // Start first connection attempt
  connectWebSocket();
  lastWebSocketAttempt = millis();
  lastWiFiCheck = millis();
}

// ─── Main Loop ────────────────────────────────────────────────────
void loop() {
  // 1. Monitor Wi‑Fi status
  checkWiFiStatus();

  // 2. Handle WebSocket reconnection / polling
  handleWebSocketConnection();
  webSocket.loop();

  // 3. Status LED
  if (WiFi.status() == WL_CONNECTED) {
    if (webSocketConnected) {
      digitalWrite(LED_BUILTIN, LOW); // LED ON = both connected
    } else {
      // Blink when Wi‑Fi is OK but WS is not connected
      digitalWrite(LED_BUILTIN, (millis() / 500) % 2 == 0 ? LOW : HIGH);
    }
  } else {
    digitalWrite(LED_BUILTIN, HIGH); // LED OFF = no Wi‑Fi
  }

  // 4. Serial command interface (same as original second snippet)
  if (Serial.available()) {
    String data = Serial.readStringUntil('\n');
    data.trim();

    if (data == "CLEAR_EEPROM") {
      clearCredentials();
      Serial.println("EEPROM cleared. Restarting...");
      ESP.restart();
      return;
    }
    if (data == "SHOW_EEPROM") {
      Serial.println("EEPROM contents (first 64 bytes):");
      EEPROM.begin(EEPROM_SIZE);
      for (int i = 0; i < 64; i++) {
        byte val = EEPROM.read(i);
        if (i % 16 == 0) { Serial.println(); Serial.print(i); Serial.print(": "); }
        if (val < 16) Serial.print("0");
        Serial.print(val, HEX); Serial.print(" ");
      }
      Serial.println();
      return;
    }
    if (data == "STATUS") {
      Serial.print("Wi‑Fi: ");
      Serial.println(WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected");
      Serial.print("WebSocket: ");
      Serial.println(webSocketConnected ? "Connected" : "Disconnected");
      Serial.print("IP: ");
      Serial.println(WiFi.localIP());
      return;
    }
    if (data == "RECONNECT_WS") {
      webSocketConnected = false;
      lastWebSocketAttempt = 0;
      Serial.println("Manual WebSocket reconnection triggered");
      return;
    }

    int separator = data.indexOf(',');
    if (separator > 0) {
      String newSSID = data.substring(0, separator);
      String newPASS = data.substring(separator + 1);
      newSSID.trim();
      newPASS.trim();

      Serial.println("Trying new credentials from Serial...");
      connectToWiFi(newSSID.c_str(), newPASS.c_str());

      if (WiFi.status() == WL_CONNECTED) {
        Serial.println("✅ Connected! Saving...");
        saveCredentials(newSSID, newPASS);
        webSocketConnected = false;
        lastWebSocketAttempt = 0;
        connectWebSocket();
      } else {
        Serial.println("❌ Connection failed. Keeping old credentials.");
        fallbackToSavedCredentials();
      }
    } else {
      Serial.println("Invalid format. Use: SSID,PASSWORD");
      Serial.println("Other commands: CLEAR_EEPROM, SHOW_EEPROM, STATUS, RECONNECT_WS");
    }
  }

  delay(10); // slight delay to prevent watchdog issues
}