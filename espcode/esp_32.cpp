// ============================================================
// ESP32 HOME AUTOMATION - WebSocket Client (simplified)
// ============================================================

#include <WiFi.h>
#include <ArduinoOTA.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <WiFiManager.h>
#include <Preferences.h>

// ------------------------------------------------------------
// PIN DEFINITIONS (adjust to your board)
// ------------------------------------------------------------
#define RELAY_1       18
#define RELAY_2       19
#define RELAY_3       21
#define RELAY_4       22
#define BUILTIN_LED   2

// ------------------------------------------------------------
// WEBSOCKET SERVER
// ------------------------------------------------------------
const char* WS_HOST = "192.168.31.63";
const uint16_t WS_PORT = 3000;
const char* WS_PATH = "/ws";

// ------------------------------------------------------------
// OTA SETTINGS
// ------------------------------------------------------------
const char* OTA_HOSTNAME = "esp32-home";
const char* OTA_PASSWORD = "123456";   // Change this!

// ------------------------------------------------------------
// WIFI MANAGER SETTINGS
// ------------------------------------------------------------
const char* WM_AP_NAME = "ESP32-Setup";
const int WM_TIMEOUT = 180;            // seconds

// ------------------------------------------------------------
// GLOBAL OBJECTS
// ------------------------------------------------------------
WebSocketsClient wsClient;
WiFiManager wm;

// for user send data from the fiwi manager portal {custom}
char USER_ID[50] = "";
WiFiManagerParameter custom_name(
    "name",
    "User ID",
    USER_ID,
    50
);

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
    case WStype_CONNECTED:{
      Serial.println("[WS] ✅ Connected to server");
      Preferences prefs;
      prefs.begin("user", false);
      // Serial.print("[WiFi] USER ID: "); Serial.println(prefs.getString("id",""));
      // Ask server for current relay states
      // String json = "{\"request\":\"status\",\"device\":\"ESP32\",\"id\":\""+prefs.getString("id", "")+"\"}";
      String userId = prefs.getString("id", "");
      Serial.println("userId==>");      
      Serial.println(userId);

      String json = "{\"userId\":\"" + userId +
              "\",\"deviceId\":\"" + userId + "-esp" +
              "\",\"type\":\"register\"}";
      wsClient.sendTXT(json);
      prefs.end();
      break;
    }
    case WStype_DISCONNECTED:
      Serial.println("[WS] ❌ Disconnected");
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

          // 2. Save credentials for next boot
          wm.setAPStaticIPConfig(IPAddress(0,0,0,0), IPAddress(0,0,0,0), IPAddress(0,0,0,0));
          wm.setConfigPortalBlocking(false);
          // WiFiManager uses "wifi_cred" namespace internally – we must use Preferences directly
          {
            Preferences prefs;
            prefs.begin("wifi_cred", false);
            prefs.putString("sta_ssid", newSSID);
            prefs.putString("sta_pswd", newPass);
            prefs.end();
          }

          // 3. Connect to new network
          Serial.print("[WiFi] Connecting to new network...");
          WiFi.disconnect(false, true);
          WiFi.begin(newSSID.c_str(), newPass.c_str());

          int attempts = 0;
          while (WiFi.status() != WL_CONNECTED && attempts < 40) {
            delay(500);
            Serial.print(".");
            attempts++;
          }

          if (WiFi.status() == WL_CONNECTED) {
            Serial.println("\n[WiFi] ✅ Connected!");
            Serial.print("[WiFi] IP: "); Serial.println(WiFi.localIP());

            // 4. Reconnect WebSocket on the new network
            Serial.println("[WS] Reconnecting WebSocket...");
            wsClient.begin(WS_HOST, WS_PORT, WS_PATH);
            // Wait a moment for the connection to settle,
            // then wsClient.loop() will trigger the event (and request status)
          } else {
            Serial.println("\n[WiFi] ❌ Failed. Restarting device...");
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
            // ignore "all" status=1 (usually means "on" but let’s not turn on all)
          } else if (button == "btn1") setRelay(RELAY_1, status);
          else if (button == "btn2") setRelay(RELAY_2, status);
          else if (button == "btn3") setRelay(RELAY_3, status);
          else if (button == "btn4") setRelay(RELAY_4, status);
          return;
        }

        Serial.println("[WS] Unknown JSON message");
      }
      break;

    case WStype_ERROR:
      Serial.println("[WS] ⚠️ Error");
      break;

    default:
      break;
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
  Serial.println(" ESP32 Home Automation Booting...");
  Serial.println("====================================");

  // Pin modes
  pinMode(BUILTIN_LED, OUTPUT);
  digitalWrite(BUILTIN_LED, HIGH);  // off (active-low)
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
  Serial.print("[WiFi] USER ID: "); Serial.println(custom_name.getValue());
  // Preferences prefs;
  // prefs.begin("user", false);
  Preferences prefs;
  prefs.begin("user", false);

  if (strlen(custom_name.getValue()) > 0) {
      prefs.putString("id", custom_name.getValue());
  }

  Serial.println(prefs.getString("id", ""));
  prefs.end();
  // prefs.putString("id",custom_name.getValue());
  // Serial.print("[WiFi] USER ID: "); Serial.println(prefs.getString("id",""));
  // prefs.end();

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
  // OTA handler – must be called frequently
  ArduinoOTA.handle();

  // WebSocket handler – triggers our event callback
  wsClient.loop();

  // LED indicator
  if (WiFi.status() == WL_CONNECTED) {
    if (wsClient.isConnected()) {
      digitalWrite(BUILTIN_LED, LOW);   // solid ON = all good
    } else {
      // blink slowly while Wi‑Fi ok but WS not connected
      digitalWrite(BUILTIN_LED, (millis() / 500) % 2 == 0 ? LOW : HIGH);
    }
  } else {
    digitalWrite(BUILTIN_LED, HIGH);     // OFF = no Wi‑Fi
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