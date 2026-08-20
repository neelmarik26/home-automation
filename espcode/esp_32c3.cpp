// ESP32-C3 MQTT Home Automation Client (Testing Version)
// Only receives MQTT messages - no WiFiManager or Preferences
//   - Subscribe: home/<userId> and receive {type:"button_update", button, status}

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ============ STATIC CONFIGURATION ============
// WiFi Settings
const char *WIFI_SSID = "Anumap";
const char *WIFI_PASSWORD = "sankar1962";

// MQTT Settings
const char *MQTT_HOST = "80.225.216.53";
const uint16_t MQTT_PORT = 1883;
const char *MQTT_USER = "anupam_neel";
const char *MQTT_PASSWORD = "AN@2023";

// Device Settings
const char *USER_ID = "6a4a789211d63633b9d03396";  // Static user ID
const char *DEVICE_ID = "esp32c3-01";   // Static device ID

// Pins
#define RELAY_1 12
#define RELAY_2 14
#define BUILTIN_LED 2

// =============================================

WiFiClient net;
PubSubClient mqtt(net);
String topic;

void relay(const String &b, int s) {
    if (b == "btn1")
        digitalWrite(RELAY_1, s);
    else if (b == "btn2")
        digitalWrite(RELAY_2, s);
}

void callback(char *, byte *p, unsigned int n) {
    StaticJsonDocument<256> d;
    if (deserializeJson(d, p, n)) return;
    if (d["type"] == "button_update") {
        relay(d["button"].as<String>(), d["status"] | 0);
    }
}

void publish(const char *t) {
    StaticJsonDocument<128> d;
    d["type"] = t;
    d["deviceId"] = DEVICE_ID;
    char o[128];
    serializeJson(d, o);
    mqtt.publish(topic.c_str(), o, true);
}

bool connectWiFi() {
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    Serial.println("Connecting to WiFi...");
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 30000) {
        delay(500);
        Serial.print(".");
        digitalWrite(BUILTIN_LED, (millis() / 500) % 2 == 0 ? HIGH : LOW);
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\nWiFi connected!");
        Serial.print("IP: ");
        Serial.println(WiFi.localIP());
        return true;
    }

    Serial.println("\nWiFi connection failed!");
    return false;
}

void reconnect() {
    if (!mqtt.connected()) {
        Serial.println("Connecting to MQTT...");
        if (mqtt.connect(DEVICE_ID, MQTT_USER, MQTT_PASSWORD)) {
            mqtt.subscribe(topic.c_str());
            publish("register");
            Serial.println("MQTT connected and registered");
        } else {
            Serial.print("MQTT failed, retry in 5s... (error: ");
            Serial.print(mqtt.state());
            Serial.println(")");
            delay(5000);
        }
    }
}

void setup() {
    Serial.begin(115200);
    Serial.println("Booting ESP32-C3...");

    pinMode(BUILTIN_LED, OUTPUT);
    pinMode(RELAY_1, OUTPUT);
    pinMode(RELAY_2, OUTPUT);
    digitalWrite(RELAY_1, LOW);
    digitalWrite(RELAY_2, LOW);

    topic = String("home/") + USER_ID;
    Serial.print("Topic: ");
    Serial.println(topic);

    if (!connectWiFi()) {
        Serial.println("Restarting in 10s...");
        delay(10000);
        ESP.restart();
    }

    mqtt.setServer(MQTT_HOST, MQTT_PORT);
    mqtt.setCallback(callback);
}

void loop() {
    if (WiFi.status() != WL_CONNECTED) {
        delay(100);
        return;
    }

    reconnect();
    mqtt.loop();

    digitalWrite(BUILTIN_LED, mqtt.connected() ? HIGH : LOW);
    delay(10);
}
