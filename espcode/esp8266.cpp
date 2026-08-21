// ============================================================
// ESP8266 HOME AUTOMATION - MQTT Client
// ============================================================

#include <ESP8266WiFi.h>
#include <ArduinoOTA.h>
#include <PubSubClient.h>
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
// MQTT SERVER
// ------------------------------------------------------------
const char* MQTT_SERVER = "80.225.216.53";
const uint16_t MQTT_PORT = 1883;
const char* MQTT_USER = "anupam_neel";
const char* MQTT_PASSWORD = "AN@2023";

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
WiFiClient espClient;
PubSubClient mqttClient(espClient);
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
// MQTT MESSAGE CALLBACK
// ------------------------------------------------------------
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  // Convert payload to string
  char message[length + 1];
  for (int i = 0; i < length; i++) {
    message[i] = (char)payload[i];
  }
  message[length] = '\0';

  Serial.print("[MQTT] Message received on topic: ");
  Serial.println(topic);
  Serial.print("[MQTT] Payload: ");
  Serial.println(message);

  // Parse JSON safely
  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, message);
  if (err) {
    Serial.print("[MQTT] JSON error: ");
    Serial.println(err.c_str());
    return;
  }

  // ---- RELAY / BUTTON CONTROL ----
  // Handle both {type:"button_update", button, status} and legacy {button, status}
  String button;
  int status = -1;

  if (doc.containsKey("type") && doc["type"] == "button_update") {
    button = doc["button"].as<String>();
    status = doc["status"].as<int>();
  } else if (doc.containsKey("button") && doc.containsKey("status")) {
    // Legacy format (no type wrapper)
    button = doc["button"].as<String>();
    status = doc["status"].as<int>();
  }

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

  Serial.println("[MQTT] Unknown JSON message");
}

// Add MQTT reconnection logic
unsigned long lastMqttReconnectAttempt = 0;
unsigned long lastHeartbeat = 0;
const unsigned long MQTT_RECONNECT_INTERVAL = 5000; // 5 seconds
const unsigned long HEARTBEAT_INTERVAL = 30000; // 30 seconds

void checkMqttConnection() {
  if (!mqttClient.connected() && WiFi.status() == WL_CONNECTED) {
    unsigned long now = millis();
    if (now - lastMqttReconnectAttempt > MQTT_RECONNECT_INTERVAL) {
      Serial.println("[MQTT] Attempting to reconnect...");
      String userId = loadUserId();
      String clientId = userId + "-esp8266";
      String userTopic = "home/" + userId;
      String willMessage = "{\"type\":\"status\",\"status\":\"OFFLINE\",\"deviceId\":\"" + clientId + "\"}";
      
      if (mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASSWORD,
                             userTopic.c_str(), 1, true, willMessage.c_str())) {
        Serial.println("[MQTT] Connected to broker");
        // Subscribe to user's topic for button updates
        mqttClient.subscribe(userTopic.c_str());
        // Publish register so server sends current button states
        String registerMsg = "{\"type\":\"register\",\"deviceId\":\"" + userId + "-esp8266\"}";
        mqttClient.publish(userTopic.c_str(), registerMsg.c_str(), false);
        // Replace the retained OFFLINE LWT after reconnecting.
        String onlineMsg = "{\"type\":\"status\",\"status\":\"ONLINE\",\"deviceId\":\"" + clientId + "\"}";
        mqttClient.publish(userTopic.c_str(), onlineMsg.c_str(), true);
        Serial.println("[MQTT] Subscribed and registered");
      }
      lastMqttReconnectAttempt = now;
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

  // ---- MQTT ----
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  Serial.println("[MQTT] Initialising MQTT...");
}

// ------------------------------------------------------------
// MAIN LOOP
// ------------------------------------------------------------
void loop() {
  // OTA handler - must be called frequently
  ArduinoOTA.handle();

  // MQTT handler
  if (mqttClient.connected()) {
    mqttClient.loop();

    // Send heartbeat every 30 seconds
    if (millis() - lastHeartbeat > HEARTBEAT_INTERVAL) {
      String userId = loadUserId();
      String userTopic = "home/" + userId;
      String heartbeatMsg = "{\"type\":\"heartbeat\",\"deviceId\":\"" + userId + "-esp8266\"}";
      mqttClient.publish(userTopic.c_str(), heartbeatMsg.c_str(), false);
      lastHeartbeat = millis();
    }
  } else {
    checkMqttConnection();
  }

  // LED indicator
  if (WiFi.status() == WL_CONNECTED) {
    if (mqttClient.connected()) {
      digitalWrite(BUILTIN_LED, HIGH);   // solid ON = all good
    } else {
      // blink slowly while Wi-Fi ok but MQTT not connected
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
      Serial.print("MQTT : "); Serial.println(mqttClient.connected() ? "Connected" : "Disconnected");
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
