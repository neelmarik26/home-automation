// ESP32-C3 MQTT Home Automation Client
// WiFiManager Version
//
// Features:
//   - WiFiManager for WiFi configuration
//   - MQTT connection
//   - Subscribe: home/<userId>
//   - Receive: {type:"button_update", button:"btn1", status:1}
//   - Relay control
//   - MQTT device registration

#include <WiFi.h>
#include <WiFiManager.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// =====================================================
// MQTT SETTINGS
// =====================================================

const char *MQTT_HOST = "80.225.216.53";
const uint16_t MQTT_PORT = 1883;

const char *MQTT_USER = "anupam_neel";
const char *MQTT_PASSWORD = "AN@2023";

// =====================================================
// DEVICE SETTINGS
// =====================================================

const char *USER_ID = "6a48f953bc4b3b5ecdba44f1";
const char *DEVICE_ID = "esp32c3-01-neel";

// =====================================================
// PINS
// =====================================================

#define RELAY_1 4
#define RELAY_2 5
#define BUILTIN_LED 2

// =====================================================
// GLOBAL OBJECTS
// =====================================================

WiFiClient net;
PubSubClient mqtt(net);

String topic;

// The MQTT broker publishes this retained payload when this ESP disconnects
// unexpectedly, so the server can mark the device OFFLINE immediately.
String offlineWillMessage()
{
    StaticJsonDocument<128> doc;
    doc["type"] = "status";
    doc["status"] = "OFFLINE";
    doc["deviceId"] = DEVICE_ID;
    String message;
    serializeJson(doc, message);
    return message;
}

// =====================================================
// RELAY CONTROL
// =====================================================

void relay(const String &button, int status)
{
    if (button == "btn1")
    {
        digitalWrite(RELAY_1, status ? HIGH : LOW);
    }
    else if (button == "btn2")
    {
        digitalWrite(RELAY_2, status ? HIGH : LOW);
    }
}

// =====================================================
// MQTT CALLBACK
// =====================================================

void callback(char *receivedTopic, byte *payload, unsigned int length)
{
    Serial.println();
    Serial.println("========== MQTT MESSAGE ==========");

    Serial.print("Topic: ");
    Serial.println(receivedTopic);

    StaticJsonDocument<256> doc;

    DeserializationError error =
        deserializeJson(doc, payload, length);

    if (error)
    {
        Serial.print("JSON error: ");
        Serial.println(error.c_str());
        return;
    }

    // Check message type
    const char *type = doc["type"];

    if (type && strcmp(type, "button_update") == 0)
    {
        String button = doc["button"].as<String>();
        int status = doc["status"] | 0;

        Serial.print("Button: ");
        Serial.println(button);

        Serial.print("Status: ");
        Serial.println(status);

        relay(button, status);
    }

    Serial.println("==================================");
}

// =====================================================
// MQTT PUBLISH
// =====================================================

void publishRegister()
{
    StaticJsonDocument<128> doc;

    doc["type"] = "register";
    doc["deviceId"] = DEVICE_ID;

    char output[128];

    serializeJson(doc, output);

    if (mqtt.publish(topic.c_str(), output, false))
    {
        Serial.println("Device registration published");
    }
    else
    {
        Serial.println("Failed to publish registration");
    }
}

void publishOnlineStatus()
{
    StaticJsonDocument<128> doc;
    doc["type"] = "status";
    doc["status"] = "ONLINE";
    doc["deviceId"] = DEVICE_ID;

    char output[128];
    serializeJson(doc, output);
    mqtt.publish(topic.c_str(), output, true);
}

// =====================================================
// WIFI CONNECTION USING WIFIMANAGER
// =====================================================

bool connectWiFi()
{
    WiFiManager wm;

    // -------------------------------------------------
    // Optional: Uncomment if you want to clear saved WiFi
    // -------------------------------------------------
    // wm.resetSettings();

    Serial.println();
    Serial.println("==================================");
    Serial.println("Starting WiFiManager...");
    Serial.println("==================================");

    WiFi.mode(WIFI_STA);

    // -------------------------------------------------
    // AutoConnect
    //
    // If saved WiFi exists:
    //     Connect automatically
    //
    // If no saved WiFi exists:
    //     Create AP:
    //     ESP32C3-HomeAutomation
    // -------------------------------------------------

    bool connected = wm.autoConnect("ESP32C3-HomeAutomation");

    if (!connected)
    {
        Serial.println();
        Serial.println("WiFi connection failed!");
        return false;
    }

    Serial.println();
    Serial.println("==================================");
    Serial.println("WiFi Connected!");
    Serial.println("==================================");

    Serial.print("SSID: ");
    Serial.println(WiFi.SSID());

    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());

    Serial.print("Gateway: ");
    Serial.println(WiFi.gatewayIP());

    Serial.print("RSSI: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");

    Serial.println("==================================");

    return true;
}

// =====================================================
// MQTT RECONNECT
// =====================================================

void reconnectMQTT()
{
    if (mqtt.connected())
        return;

    Serial.println();
    Serial.println("Connecting to MQTT...");

    // -------------------------------------------------
    // MQTT Client ID
    // -------------------------------------------------

    String willMessage = offlineWillMessage();
    if (mqtt.connect(
            DEVICE_ID,
            MQTT_USER,
            MQTT_PASSWORD,
            topic.c_str(),
            1,       // LWT QoS
            true,    // retain the latest OFFLINE status
            willMessage.c_str()))
    {
        Serial.println("MQTT connected!");

        // -------------------------------------------------
        // Subscribe to user's home topic
        // -------------------------------------------------

        if (mqtt.subscribe(topic.c_str()))
        {
            Serial.print("Subscribed to: ");
            Serial.println(topic);
        }
        else
        {
            Serial.println("MQTT subscription failed!");
        }

        // -------------------------------------------------
        // Register device
        // -------------------------------------------------

        publishRegister();
        // Replace the retained OFFLINE LWT after reconnecting.
        publishOnlineStatus();

        Serial.println("Device registered.");
    }
    else
    {
        Serial.print("MQTT connection failed.");
        Serial.print(" Error code: ");
        Serial.println(mqtt.state());

        Serial.println("Retrying in 5 seconds...");
        delay(5000);
    }
}

// =====================================================
// SETUP
// =====================================================

void setup()
{
    Serial.begin(115200);

    delay(500);

    Serial.println();
    Serial.println("==================================");
    Serial.println("ESP32-C3 Home Automation");
    Serial.println("WiFiManager + MQTT");
    Serial.println("==================================");

    // -------------------------------------------------
    // PIN SETUP
    // -------------------------------------------------

    pinMode(BUILTIN_LED, OUTPUT);

    pinMode(RELAY_1, OUTPUT);
    pinMode(RELAY_2, OUTPUT);

    // Relays OFF initially
    digitalWrite(RELAY_1, LOW);
    digitalWrite(RELAY_2, LOW);

    digitalWrite(BUILTIN_LED, LOW);

    // -------------------------------------------------
    // MQTT TOPIC
    // -------------------------------------------------

    topic = String("home/") + USER_ID;

    Serial.print("MQTT Topic: ");
    Serial.println(topic);

    // -------------------------------------------------
    // CONNECT WIFI
    // -------------------------------------------------

    if (!connectWiFi())
    {
        Serial.println("Restarting ESP32 in 10 seconds...");

        delay(10000);

        ESP.restart();
    }

    // -------------------------------------------------
    // MQTT CONFIGURATION
    // -------------------------------------------------

    mqtt.setServer(MQTT_HOST, MQTT_PORT);
    mqtt.setCallback(callback);

    Serial.println();
    Serial.println("MQTT server configured.");

    // -------------------------------------------------
    // MQTT CONNECTION
    // -------------------------------------------------

    reconnectMQTT();
}

// =====================================================
// MAIN LOOP
// =====================================================

void loop()
{
    // -------------------------------------------------
    // CHECK WIFI
    // -------------------------------------------------

    if (WiFi.status() != WL_CONNECTED)
    {
        digitalWrite(BUILTIN_LED, LOW);

        Serial.println("WiFi disconnected!");

        delay(1000);

        return;
    }

    // -------------------------------------------------
    // MQTT CONNECTION
    // -------------------------------------------------

    reconnectMQTT();

    // -------------------------------------------------
    // MQTT LOOP
    // -------------------------------------------------

    mqtt.loop();

    // -------------------------------------------------
    // STATUS LED
    //
    // ON  = MQTT connected
    // OFF = MQTT disconnected
    // -------------------------------------------------

    digitalWrite(
        BUILTIN_LED,
        mqtt.connected() ? HIGH : LOW
    );

    delay(10);
}
