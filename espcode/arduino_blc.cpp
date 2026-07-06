#include <SoftwareSerial.h>

SoftwareSerial BT(10, 11);   // RX, TX

void setup() {
  Serial.begin(9600);
  BT.begin(9600);

  Serial.println("Waiting for ESP32...");
}

void loop() {

  if (BT.available()) {
    String msg = BT.readStringUntil('\n');

    Serial.print("ESP32: ");
    Serial.println(msg);
  }
}