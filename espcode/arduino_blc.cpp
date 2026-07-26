#include <SoftwareSerial.h>

SoftwareSerial BT(10, 11);   // RX, TX

#define RELAY3_PIN 2   // d2 -> relay 3 (e.g. light)
#define RELAY4_PIN 3   // d3 -> relay 4 (e.g. fan)

#define BUF_SIZE 64
char lineBuf[BUF_SIZE];
uint8_t bufIdx = 0;

void setup() {
  Serial.begin(9600);
  BT.begin(9600);

  pinMode(RELAY3_PIN, OUTPUT);
  pinMode(RELAY4_PIN, OUTPUT);
  digitalWrite(RELAY3_PIN, LOW);
  digitalWrite(RELAY4_PIN, LOW);

  Serial.println("Waiting for ESP32...");
}

void loop() {
  while (BT.available()) {
    char c = BT.read();

    if (c == '\n') {
      lineBuf[bufIdx] = '\0';   // terminate string
      processLine(lineBuf);
      bufIdx = 0;               // reset buffer for next line
    } else if (c != '\r') {
      if (bufIdx < BUF_SIZE - 1) {
        lineBuf[bufIdx++] = c;
      } else {
        // buffer overflow guard - discard and reset
        bufIdx = 0;
      }
    }
  }
}

void processLine(char *line) {
  Serial.print("ESP32: ");
  Serial.println(line);

  int relayNum = -1;
  int status = -1;

  // Manual parse, no String, no malloc -> no heap fragmentation
  char *relayPtr = strstr(line, "\"relay\":");
  char *statusPtr = strstr(line, "\"status\":");

  if (relayPtr != NULL) {
    relayNum = atoi(relayPtr + 8);   // skip past "relay":
  }
  if (statusPtr != NULL) {
    status = atoi(statusPtr + 9);    // skip past "status":
  }

  if (relayNum == -1 || status == -1) {
    Serial.println("Parse error, ignoring line");
    return;
  }

  switch (relayNum) {
    case 3:
      digitalWrite(RELAY3_PIN, status ? HIGH : LOW);
      Serial.print("Relay3 (D2) -> ");
      Serial.println(status ? "ON" : "OFF");
      break;

    case 4:
      digitalWrite(RELAY4_PIN, status ? HIGH : LOW);
      Serial.print("Relay4 (D3) -> ");
      Serial.println(status ? "ON" : "OFF");
      break;

    default:
      Serial.print("Unknown relay: ");
      Serial.println(relayNum);
      break;
  }
}