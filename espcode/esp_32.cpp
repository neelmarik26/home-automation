// ============================================================
// ESP32 HOME AUTOMATION - WebSocket Client (simplified)
// ============================================================

#include <WiFi.h>
// ArduinoOTA removed - not compatible with "Huge APP (No OTA)" partition scheme
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include "BluetoothSerial.h"

#if !defined(CONFIG_BT_ENABLED) || !defined(CONFIG_BLUEDROID_ENABLED)
#error Bluetooth is not enabled! Enable it in "Tools -> Partition Scheme" / menuconfig for this board.
#endif

// ------------------------------------------------------------
// PIN DEFINITIONS (adjust to your board)
// ------------------------------------------------------------
#define RELAY_1       12
#define RELAY_2       14
// RELAY_3 (27) and RELAY_4 (26) are now controlled by the Arduino
// over Bluetooth (HC-05/HC-06), NOT directly by the ESP32.
#define BUILTIN_LED   2

// ------------------------------------------------------------
// WEBSOCKET SERVER
// ------------------------------------------------------------
const char* WS_HOST = "80.225.216.53";
const uint16_t WS_PORT = 3000;
const char* WS_PATH = "/ws";

// ------------------------------------------------------------
// WIFI MANAGER SETTINGS
// ------------------------------------------------------------
const char* WM_AP_NAME = "ESP32-Setup";
const int WM_TIMEOUT = 180;            // seconds

// ------------------------------------------------------------
// BLUETOOTH SETTINGS (ESP32 = Master, connects to HC-05 on Arduino)
// ------------------------------------------------------------
const char* BT_LOCAL_NAME = "ESP32_MASTER";
const char* HC05_NAME     = "HC-05";     // must match your HC-05's name exactly
const char* BT_PIN        = "1234";      // must match your HC-05's PIN

unsigned long lastBTReconnectAttempt = 0;
const unsigned long BT_RECONNECT_INTERVAL = 5000; // ms, non-blocking retry

// ------------------------------------------------------------
// GLOBAL OBJECTS
// ------------------------------------------------------------
WebSocketsClient wsClient;
WiFiManager wm;
BluetoothSerial SerialBT;

// for user send data from the fiwi manager portal {custom}
char USER_ID[50] = "";
WiFiManagerParameter custom_name(
    "name",
    "User ID",
    USER_ID,
    50
);

// ------------------------------------------------------------
// HELPER: set relay on/off (ESP32-local relays only: 1 and 2)
// ------------------------------------------------------------
void setRelay(int pin, bool on) {
  digitalWrite(pin, on ? HIGH : LOW);
}

// ------------------------------------------------------------
// HELPER: forward a relay command to the Arduino over Bluetooth
// Sends JSON like: {"relay":3,"status":1}\n
// ------------------------------------------------------------
void sendRelayBT(int relayNum, int status) {
  if (!SerialBT.connected()) {
    Serial.println("[BT] ⚠️ Not connected to HC-05, cannot send relay command");
    return;
  }
  String json = "{\"relay\":" + String(relayNum) +
                ",\"status\":" + String(status) + "}";
  SerialBT.println(json);   // println adds the newline the Arduino can split on
  Serial.print("[BT] Sent -> ");
  Serial.println(json);
}

// ------------------------------------------------------------
// HELPER: try to (re)connect to the HC-05
// ------------------------------------------------------------
void tryConnectBT() {
  Serial.println("[BT] Connecting to HC-05...");
  if (SerialBT.connect(HC05_NAME)) {
    Serial.println("[BT] ✅ Connected to HC-05!");
  } else {
    Serial.println("[BT] ❌ Connection failed, will retry");
  }
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
          // (no-op calls removed here: setAPStaticIPConfig / setConfigPortalBlocking(false)
          //  were unused and pulled in extra WiFiManager code paths, costing flash space)
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
              // Relay 3 & 4 live on the Arduino - forward over Bluetooth
              sendRelayBT(3, 0);
              sendRelayBT(4, 0);
            }
            // ignore "all" status=1 (usually means "on" but let’s not turn on all)
          } else if (button == "btn1") {
            setRelay(RELAY_1, status);
          } else if (button == "btn2") {
            setRelay(RELAY_2, status);
          } else if (button == "btn3") {
            // Relay 3 is wired to the Arduino - forward via Bluetooth
            sendRelayBT(3, status);
          } else if (button == "btn4") {
            // Relay 4 is wired to the Arduino - forward via Bluetooth
            sendRelayBT(4, status);
          }
          return;
        }

        Serial.println("[WS] Unknown JSON message");
      }
      break;

    case WStype_ERROR:
      Serial.println("[WS] ⚠️ Error");
      break;

    case WStype_PING:
      // Respond to ping with pong to keep connection alive
      wsClient.sendTXT("");  // Empty payload pong response
      Serial.println("[WS] 📡 Ping received, pong sent");
      break;

    case WStype_PONG:
      Serial.println("[WS] 📡 Pong received");
      break;

    default:
      break;
  }
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
  // Relay 3 & 4 pins removed - those relays are wired to the Arduino now

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

  // ---- Bluetooth (ESP32 as Master, connects out to HC-05) ----
  SerialBT.setPin(BT_PIN, 4);
  SerialBT.begin(BT_LOCAL_NAME, true);   // true = Master mode
  Serial.println("[BT] Started in Master mode, connecting to HC-05...");
  tryConnectBT();
  lastBTReconnectAttempt = millis();

  // ---- WebSocket ----
  wsClient.onEvent(webSocketEvent);
  wsClient.begin(WS_HOST, WS_PORT, WS_PATH);
  Serial.println("[WS] Initialising WebSocket...");
}

// ------------------------------------------------------------
// MAIN LOOP
// ------------------------------------------------------------
void loop() {
  // WebSocket handler – triggers our event callback
  wsClient.loop();

  // Keep the HC-05 link alive; retry periodically if dropped
  if (!SerialBT.connected()) {
    if (millis() - lastBTReconnectAttempt > BT_RECONNECT_INTERVAL) {
      lastBTReconnectAttempt = millis();
      tryConnectBT();
    }
  } else if (SerialBT.available()) {
    // (Optional) read anything the Arduino sends back over Bluetooth,
    // e.g. acknowledgements or sensor data. Just logs it for now.
    String btLine = SerialBT.readStringUntil('\n');
    btLine.trim();
    if (btLine.length() > 0) {
      Serial.print("[BT] Received <- ");
      Serial.println(btLine);
    }
  }

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
      Serial.print("BT   : "); Serial.println(SerialBT.connected() ? "Connected to HC-05" : "Disconnected");
    } else if (cmd == "RESET_WIFI") {
      Serial.println("[WiFi] Clearing saved credentials...");
      wm.resetSettings();
      delay(500);
      ESP.restart();
    } else if (cmd == "RESTART") {
      Serial.println("[System] Restarting...");
      delay(500);
      ESP.restart();
    } else if (cmd == "BT_TEST_ON3") {
      sendRelayBT(3, 1);
    } else if (cmd == "BT_TEST_OFF3") {
      sendRelayBT(3, 0);
    } else {
      Serial.println("Available commands: STATUS | RESET_WIFI | RESTART | BT_TEST_ON3 | BT_TEST_OFF3");
    }
  }

  delay(10);
}
