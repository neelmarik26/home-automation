// ============================================================
// ESP8266 HOME AUTOMATION - WebSocket Client (simplified)
// ============================================================

#include <ESP8266WiFi.h>
#include <ArduinoOTA.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <WiFiManager.h>
#include <EEPROM.h>

// ------------------------------------------------------------
// PIN DEFINITIONS (NodeMCU labels shown - adjust to your board)
// Avoided GPIO0/D3, GPIO15/D8, GPIO16/D0 (boot-strapping pins)
// ------------------------------------------------------------
#define RELAY_1       5   // D1
#define RELAY_2       4   // D2
#define RELAY_3       14  // D5
#define RELAY_4       12  // D6
#define BUILTIN_LED   2   // D4 (onboard LED, active-low on most boards)

// ------------------------------------------------------------
// WEBSOCKET SERVER
// ------------------------------------------------------------
const char* WS_HOST = "80.225.216.53";
const uint16_t WS_PORT = 3000;
const char* WS_PATH = "/ws";

// ------------------------------------------------------------
// OTA SETTINGS
// ------------------------------------------------------------
const char* OTA_HOSTNAME = "esp8266-home";
const char* OTA_PASSWORD = "123456";   // Change this!

// ------------------------------------------------------------
// WIFI MANAGER SETTINGS
// ------------------------------------------------------------
const char* WM_AP_NAME = "ESP8266-Setup";
const int WM_TIMEOUT = 180;            // seconds

// ------------------------------------------------------------
// EEPROM SETTINGS (used instead of ESP32's Preferences)
// ------------------------------------------------------------
#define EEPROM_SIZE   96
#define EEPROM_ADDR   0
#define ID_MAX_LEN    50

// ------------------------------------------------------------
// GLOBAL OBJECTS
// ------------------------------------------------------------
WebSocketsClient wsClient;
WiFiManager wm;

// for user to send data from the wifi manager portal (custom)
char USER_ID[50] = "";
WiFiManagerParameter custom_name(
    "name",
    "User ID",
    USER_ID,
    50
);

// ------------------------------------------------------------
// HELPER: EEPROM-based string storage (replaces Preferences)
// ------------------------------------------------------------
void saveUserId(const String &id) {
  EEPROM.begin(EEPROM_SIZE);
  int len = id.length();
  if (len > ID_MAX_LEN - 1) len = ID_MAX_LEN - 1;

  EEPROM.write(EEPROM_ADDR, len);  // store length byte first
  for (int i = 0; i < len; i++) {
    EEPROM.write(EEPROM_ADDR + 1 + i, id[i]);
  }
  EEPROM.commit();
  EEPROM.end();
}

String loadUserId() {
  EEPROM.begin(EEPROM_SIZE);
  int len = EEPROM.read(EEPROM_ADDR);
  if (len <= 0 || len > ID_MAX_LEN - 1) {
    EEPROM.end();
    return "";
  }
  char buf[ID_MAX_LEN];
  for (int i = 0; i < len; i++) {
    buf[i] = EEPROM.read(EEPROM_ADDR + 1 + i);
  }
  buf[len] = '\0';
  EEPROM.end();
  return String(buf);
}

// ------------------------------------------------------------
// HELPER: set relay on/off
// ------------------------------------------------------------
void setRelay(int pin, bool on) {
  digitalWrite(pin, on ? HIGH : LOW);
}

// ------------------------------------------------------------
// WEBSOCKET EVENT HANDLER (called automatically by library)
// ------------------------------------------------------------
void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      Serial.println("[WS] Connected to server");

      String userId = loadUserId();
      Serial.println("userId==>");
      Serial.println(userId);

      String json = "{\"userId\":\"" + userId +
              "\",\"deviceId\":\"" + userId + "-esp" +
              "\",\"type\":\"register\"}";
      wsClient.sendTXT(json);
      break;
    }
    case WStype_DISCONNECTED:
      Serial.println("[WS] Disconnected");
      break;

    case WStype_TEXT:
      {
        // Parse JSON safely
        StaticJsonDocument<512> doc;
        DeserializationError err = deserializeJson(doc, payload, length);
        if (err) {
          Serial.print("[WS] JSON error: ");
          Serial.println(err.c_str());
          return;
        }

        // ---- NEW WI-FI CREDENTIALS ----
        if (doc.containsKey("ssid") && doc.containsKey("password")) {
          String newSSID = doc["ssid"].as<String>();
          String newPass = doc["password"].as<String>();

          Serial.println("[WiFi] Received new credentials:");
          Serial.print("       SSID: "); Serial.println(newSSID);

          // 1. Disconnect WebSocket BEFORE switching networks
          wsClient.disconnect();
          delay(200);

          // 2. Connect to new network
          // (WiFiManager on ESP8266 auto-persists sta credentials via
          //  WiFi.begin, so no manual Preferences-style save needed here)
          Serial.print("[WiFi] Connecting to new network...");
          WiFi.disconnect();
          WiFi.begin(newSSID.c_str(), newPass.c_str());

          int attempts = 0;
          while (WiFi.status() != WL_CONNECTED && attempts < 40) {
            delay(500);
            Serial.print(".");
            attempts++;
          }

          if (WiFi.status() == WL_CONNECTED) {
            Serial.println("\n[WiFi] Connected!");
            Serial.print("[WiFi] IP: "); Serial.println(WiFi.localIP());

            // 3. Reconnect WebSocket on the new network
            Serial.println("[WS] Reconnecting WebSocket...");
            wsClient.begin(WS_HOST, WS_PORT, WS_PATH);
          } else {
            Serial.println("\n[WiFi] Failed. Restarting device...");
            delay(500);
            ESP.restart();
          }
          return;  // done handling this message
        }

        // ---- RELAY / BUTTON CONTROL ----
        if (doc.containsKey("button") && doc.containsKey("status")) {
          String button = doc["button"].as<String>();
          int status = doc["status"].as<int>();

          Serial.print("[CTRL] Button: "); Serial.print(button);
          Serial.print(" -> "); Serial.println(status);

          if (button == "all") {
            if (status == 0) {  // turn all OFF
              setRelay(RELAY_1, false);
              setRelay(RELAY_2, false);
              setRelay(RELAY_3, false);
              setRelay(RELAY_4, false);
            }
            // ignore "all" status=1 (usually means "on" but let's not turn on all)
          } else if (button == "btn1") setRelay(RELAY_1, status);
          else if (button == "btn2") setRelay(RELAY_2, status);
          else if (button == "btn3") setRelay(RELAY_3, status);
          else if (button == "btn4") setRelay(RELAY_4, status);
          return;
        }

        // Handle ping from server (application-level heartbeat)
        if (doc.containsKey("type") && doc["type"] == "ping") {
          wsClient.sendTXT("{\"type\":\"pong\"}");
          return;
        }

        // Handle register_ack from server
        if (doc.containsKey("type") && doc["type"] == "register_ack") {
          Serial.println("[WS] Registration acknowledged");
          return;
        }

        // Handle button_update from server (initial state sync)
        if (doc.containsKey("type") && doc["type"] == "button_update") {
          String button = doc["button"].as<String>();
          int status = doc["status"].as<int>();

          Serial.print("[SYNC] Button: "); Serial.print(button);
          Serial.print(" -> "); Serial.println(status);

          if (button == "btn1") setRelay(RELAY_1, status);
          else if (button == "btn2") setRelay(RELAY_2, status);
          else if (button == "btn3") setRelay(RELAY_3, status);
          else if (button == "btn4") setRelay(RELAY_4, status);
          return;
        }

        Serial.println("[WS] Unknown JSON message");
      }
      break;

    case WStype_ERROR:
      Serial.println("[WS] Error");
      break;

    default:
      break;
  }
}

// Add reconnection logic
unsigned long lastReconnectAttempt = 0;
const unsigned long RECONNECT_INTERVAL = 5000; // 5 seconds

void checkWebSocketConnection() {
  if (!wsClient.isConnected() && WiFi.status() == WL_CONNECTED) {
    unsigned long now = millis();
    if (now - lastReconnectAttempt > RECONNECT_INTERVAL) {
      Serial.println("[WS] Attempting to reconnect...");
      wsClient.begin(WS_HOST, WS_PORT, WS_PATH);
      lastReconnectAttempt = now;
    }
  }
}

// ------------------------------------------------------------
// SETUP OTA
// ------------------------------------------------------------
void setupOTA() {
  ArduinoOTA.setHostname(OTA_HOSTNAME);
  ArduinoOTA.setPassword(OTA_PASSWORD);   // required when uploading

  ArduinoOTA.onStart([]() {
    Serial.println("[OTA] Update started");
  });
  ArduinoOTA.onEnd([]() {
    Serial.println("[OTA] Update complete, restarting...");
  });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    Serial.printf("[OTA] Progress: %u%%\r", (progress * 100) / total);
  });
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("[OTA] Error[%u]: ", error);
    if (error == OTA_AUTH_ERROR) Serial.println("Auth Failed");
    else if (error == OTA_BEGIN_ERROR) Serial.println("Begin Failed");
    else if (error == OTA_CONNECT_ERROR) Serial.println("Connect Failed");
    else if (error == OTA_RECEIVE_ERROR) Serial.println("Receive Failed");
    else if (error == OTA_END_ERROR) Serial.println("End Failed");
  });

  ArduinoOTA.begin();
  Serial.println("[OTA] Ready");
}

// ------------------------------------------------------------
// SETUP
// ------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  Serial.println("\n====================================");
  Serial.println(" ESP8266 Home Automation Booting...");
  Serial.println("====================================");

  // Pin modes
  pinMode(BUILTIN_LED, OUTPUT);
  digitalWrite(BUILTIN_LED, LOW);  // off (active-low)
  pinMode(RELAY_1, OUTPUT); digitalWrite(RELAY_1, LOW);
  pinMode(RELAY_2, OUTPUT); digitalWrite(RELAY_2, LOW);
  pinMode(RELAY_3, OUTPUT); digitalWrite(RELAY_3, LOW);
  pinMode(RELAY_4, OUTPUT); digitalWrite(RELAY_4, LOW);

  // ---- WiFiManager ----
  wm.addParameter(&custom_name);
  wm.setConfigPortalTimeout(WM_TIMEOUT);
  if (!wm.autoConnect(WM_AP_NAME)) {
    Serial.println("[WiFi] Portal timeout, restarting...");
    delay(3000);
    ESP.restart();
  }
  Serial.println("[WiFi] Connected!");
  Serial.print("[WiFi] IP: "); Serial.println(WiFi.localIP());
  Serial.print("[WiFi] USER ID (from portal): "); Serial.println(custom_name.getValue());

  // Save the User ID entered in the portal (if any) to EEPROM
  if (strlen(custom_name.getValue()) > 0) {
    saveUserId(String(custom_name.getValue()));
  }
  Serial.print("[EEPROM] Stored USER ID: ");
  Serial.println(loadUserId());

  // ---- OTA ----
  setupOTA();

  // ---- WebSocket ----
  wsClient.onEvent(webSocketEvent);
  wsClient.begin(WS_HOST, WS_PORT, WS_PATH);
  Serial.println("[WS] Initialising WebSocket...");
}

// ------------------------------------------------------------
// MAIN LOOP
// ------------------------------------------------------------
void loop() {
  // OTA handler - must be called frequently
  ArduinoOTA.handle();

  // WebSocket handler - triggers our event callback
  wsClient.loop();

  // Check and attempt WebSocket reconnection
  checkWebSocketConnection();

  // LED indicator
  if (WiFi.status() == WL_CONNECTED) {
    if (wsClient.isConnected()) {
      digitalWrite(BUILTIN_LED, HIGH);   // solid ON = all good
    } else {
      // blink slowly while Wi-Fi ok but WS not connected
      digitalWrite(BUILTIN_LED, (millis() / 500) % 2 == 0 ? LOW : HIGH);
    }
  } else {
    digitalWrite(BUILTIN_LED, LOW);     // OFF = no Wi-Fi
  }

  // ---- Serial commands for debugging ----
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd == "STATUS") {
      Serial.println("--- DEVICE STATUS ---");
      Serial.print("WiFi : "); Serial.println(WiFi.status() == WL_CONNECTED ? "Connected" : "Offline");
      Serial.print("WS   : "); Serial.println(wsClient.isConnected() ? "Connected" : "Disconnected");
      Serial.print("IP   : "); Serial.println(WiFi.localIP());
    } else if (cmd == "RESET_WIFI") {
      Serial.println("[WiFi] Clearing saved credentials...");
      wm.resetSettings();
      delay(500);
      ESP.restart();
    } else if (cmd == "RESTART") {
      Serial.println("[System] Restarting...");
      delay(500);
      ESP.restart();
    } else {
      Serial.println("Available commands: STATUS | RESET_WIFI | RESTART");
    }
  }

  delay(10);
}