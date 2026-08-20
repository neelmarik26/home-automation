// ESP32 MQTT home automation client. Install PubSubClient and ArduinoJson.
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include "BluetoothSerial.h"
#define RELAY_1 12
#define RELAY_2 14
#define BUILTIN_LED 2
const char *MQTT_HOST = "80.225.216.53";
const uint16_t MQTT_PORT = 1883;
WiFiClient net;
PubSubClient mqtt(net);
WiFiManager wm;
BluetoothSerial SerialBT;
Preferences prefs;
char USER_ID[50] = "";
WiFiManagerParameter custom_name("name", "User ID", USER_ID, 50);
String userId, topic;
unsigned long lastHeartbeat = 0;
void relay(const String &b, int s)
{
    if (b == "btn1")
        digitalWrite(RELAY_1, s);
    else if (b == "btn2")
        digitalWrite(RELAY_2, s);
    else if (b == "btn3" && SerialBT.connected())
        SerialBT.printf("{\"relay\":3,\"status\":%d}\n", s);
    else if (b == "btn4" && SerialBT.connected())
        SerialBT.printf("{\"relay\":4,\"status\":%d}\n", s);
}
void callback(char *, byte *p, unsigned int n)
{
    StaticJsonDocument<256> d;
    if (deserializeJson(d, p, n))
        return;
    if (d["type"] == "button_update")
        relay(d["button"].as<String>(), d["status"] | 0);
}
void publish(const char *t)
{
    StaticJsonDocument<128> d;
    d["type"] = t;
    d["deviceId"] = userId + "-esp32";
    char o[128];
    serializeJson(d, o);
    mqtt.publish(topic.c_str(), o, true);
}
void reconnect()
{
    while (!mqtt.connected() && WiFi.status() == WL_CONNECTED)
    {
        if (mqtt.connect((userId + "-esp32").c_str()))
        {
            mqtt.subscribe(topic.c_str());
            publish("register");
        }
        else
            delay(5000);
    }
}
void setup()
{
    Serial.begin(115200);
    pinMode(BUILTIN_LED, OUTPUT);
    pinMode(RELAY_1, OUTPUT);
    pinMode(RELAY_2, OUTPUT);
    prefs.begin("user", false);
    wm.addParameter(&custom_name);
    wm.autoConnect("ESP32-Setup");
    if (strlen(custom_name.getValue()))
        prefs.putString("id", custom_name.getValue());
    userId = prefs.getString("id", "");
    prefs.end();
    topic = "home/" + userId;
    mqtt.setServer(MQTT_HOST, MQTT_PORT);
    mqtt.setCallback(callback);
}
void loop()
{
    if (WiFi.status() != WL_CONNECTED)
        return;
    if (!mqtt.connected())
        reconnect();
    mqtt.loop();
    if (mqtt.connected() && millis() - lastHeartbeat > 30000)
    {
        publish("heartbeat");
        lastHeartbeat = millis();
    }
    digitalWrite(BUILTIN_LED, mqtt.connected() ? HIGH : LOW);
    delay(10);
}
