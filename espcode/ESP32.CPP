#include <WiFi.h>
#include <FirebaseESP32.h>
#include <EEPROM.h>

#define EEPROM_SIZE 128
#define LED_BUILTIN 2

// === Firebase Config ===
#define DATABASE_URL    "home-automation-77e6c-default-rtdb.firebaseio.com"
#define DATABASE_SECRET "3hHetqM0wMhHRfCJsbwokl1Neo2INtsxbs7Br6Hc"

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// === GPIO Pins (ESP32 equivalents of NodeMCU D5-D8) ===
#define PIN_BTN1  18
#define PIN_BTN2  19
#define PIN_BTN3  21
#define PIN_BTN4  22

// === Global Variables ===
unsigned long lastFirebaseRead = 0;
const unsigned long FIREBASE_READ_INTERVAL = 500; // Read every 500ms

bool lastBtn1 = false, lastBtn2 = false, lastBtn3 = false, lastBtn4 = false;

// === Function Declarations ===
void connectToWiFi(const char* ssid, const char* password);
void saveWiFiCredentials(String ssid, String pass);
String readStringFromEEPROM(int startAddr);
void writeStringToEEPROM(int startAddr, String data);
void clearEEPROM();
void printEEPROMContents();
void fallbackToSavedCredentials();
void readAndApplyFirebaseState();

// === Setup ===
void setup() {
  Serial.begin(115200);
  EEPROM.begin(EEPROM_SIZE);

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH); // LED OFF initially

  pinMode(PIN_BTN1, OUTPUT); digitalWrite(PIN_BTN1, LOW);
  pinMode(PIN_BTN2, OUTPUT); digitalWrite(PIN_BTN2, LOW);
  pinMode(PIN_BTN3, OUTPUT); digitalWrite(PIN_BTN3, LOW);
  pinMode(PIN_BTN4, OUTPUT); digitalWrite(PIN_BTN4, LOW);

  delay(1000);
  Serial.println("\nBooting...");

  // Debug: Print EEPROM contents
  Serial.println("EEPROM Contents:");
  printEEPROMContents();

  String savedSSID = readStringFromEEPROM(0);
  String savedPASS = readStringFromEEPROM(32);

  Serial.print("SSID: '"); Serial.print(savedSSID); Serial.println("'");
  Serial.println("PASS: '***'");

  bool credentialsValid = true;
  if (savedSSID.length() == 0 || savedSSID.length() > 31) credentialsValid = false;
  if (savedPASS.length() > 31) credentialsValid = false;

  bool ssidHasPrintable = false;
  for (int i = 0; i < (int)savedSSID.length(); i++) {
    if (isPrintable(savedSSID[i])) { ssidHasPrintable = true; break; }
  }
  if (!ssidHasPrintable && savedSSID.length() > 0) credentialsValid = false;

  if (credentialsValid) {
    Serial.println("Using saved credentials...");
    connectToWiFi(savedSSID.c_str(), savedPASS.c_str());
  } else {
    Serial.println("No valid saved credentials. Clearing EEPROM.");
    clearEEPROM();
    Serial.println("Send credentials via Serial as: SSID,PASSWORD");
  }

  // === Firebase Init ===
  if (WiFi.status() == WL_CONNECTED) {
    config.database_url = DATABASE_URL;
    config.signer.tokens.legacy_token = DATABASE_SECRET;
    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);
    Serial.println("Firebase initialized.");
  }

  lastFirebaseRead = millis();
}

// === Main Loop ===
void loop() {
  // LED status indicator
  if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(LED_BUILTIN, LOW); // LED ON when WiFi connected
  } else {
    digitalWrite(LED_BUILTIN, HIGH); // LED OFF when disconnected
  }

  // Firebase polling
  if (WiFi.status() == WL_CONNECTED && Firebase.ready()) {
    unsigned long now = millis();
    if (now - lastFirebaseRead >= FIREBASE_READ_INTERVAL) {
      lastFirebaseRead = now;
      readAndApplyFirebaseState();
    }
  }

  // Handle Serial input for setup / debug
  if (Serial.available()) {
    String data = Serial.readStringUntil('\n');
    data.trim();

    if (data == "CLEAR_EEPROM") {
      clearEEPROM();
      Serial.println("EEPROM cleared. Restarting...");
      ESP.restart();
      return;
    }
    if (data == "SHOW_EEPROM") { printEEPROMContents(); return; }
    if (data == "STATUS") {
      Serial.print("WiFi: ");
      Serial.println(WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected");
      Serial.print("IP: "); Serial.println(WiFi.localIP());
      return;
    }

    int separator = data.indexOf(',');
    if (separator > 0) {
      String newSSID = data.substring(0, separator);
      String newPASS = data.substring(separator + 1);
      newSSID.trim(); newPASS.trim();

      Serial.print("Trying SSID: '"); Serial.print(newSSID); Serial.println("'");
      connectToWiFi(newSSID.c_str(), newPASS.c_str());

      if (WiFi.status() == WL_CONNECTED) {
        Serial.println("✅ Connected! Saving credentials...");
        saveWiFiCredentials(newSSID, newPASS);

        // Re-init Firebase with new connection
        config.database_url = DATABASE_URL;
        config.signer.tokens.legacy_token = DATABASE_SECRET;
        Firebase.begin(&config, &auth);
        Firebase.reconnectWiFi(true);
      } else {
        Serial.println("❌ Connection failed. Falling back to saved credentials.");
        fallbackToSavedCredentials();
      }
    } else {
      Serial.println("Invalid format. Use: SSID,PASSWORD");
      Serial.println("Other commands: CLEAR_EEPROM, SHOW_EEPROM, STATUS");
    }
  }

  delay(10);
}

// === Read Firebase and Apply Relay States ===
void readAndApplyFirebaseState() {
  // Read all 4 buttons from Firebase paths: /btn1, /btn2, /btn3, /btn4
  // Expected value: 0 (OFF) or 1 (ON)

  struct { const char* path; int pin; bool* lastState; } buttons[] = {
    { "/btn1", PIN_BTN1, &lastBtn1 },
    { "/btn2", PIN_BTN2, &lastBtn2 },
    { "/btn3", PIN_BTN3, &lastBtn3 },
    { "/btn4", PIN_BTN4, &lastBtn4 },
  };

  for (auto& b : buttons) {
    if (Firebase.getInt(fbdo, b.path)) {
      int val = fbdo.intData();
      bool newState = (val == 1);
      if (newState != *b.lastState) {
        digitalWrite(b.pin, newState ? HIGH : LOW);
        *b.lastState = newState;
        Serial.printf("%s → %s\n", b.path, newState ? "ON" : "OFF");
      }
    } else {
      Serial.printf("Firebase read error [%s]: %s\n", b.path, fbdo.errorReason().c_str());
    }
  }

  // Handle "all OFF" flag at /all (set to 0 to turn everything off)
  if (Firebase.getInt(fbdo, "/all")) {
    int val = fbdo.intData();
    if (val == 0) {
      digitalWrite(PIN_BTN1, LOW); lastBtn1 = false;
      digitalWrite(PIN_BTN2, LOW); lastBtn2 = false;
      digitalWrite(PIN_BTN3, LOW); lastBtn3 = false;
      digitalWrite(PIN_BTN4, LOW); lastBtn4 = false;
      Serial.println("All relays turned OFF via /all");
    }
  }
}

// === Connect to Wi-Fi ===
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
    Serial.println("\n✅ Wi-Fi connected!");
    Serial.print("IP: "); Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n❌ Failed to connect.");
    WiFi.disconnect();
  }
}

// === Fallback to EEPROM Credentials ===
void fallbackToSavedCredentials() {
  String savedSSID = readStringFromEEPROM(0);
  String savedPASS = readStringFromEEPROM(32);

  bool credentialsValid = (savedSSID.length() > 0 && savedSSID.length() <= 31);
  if (credentialsValid) {
    Serial.println("Trying saved credentials...");
    connectToWiFi(savedSSID.c_str(), savedPASS.c_str());
  } else {
    Serial.println("No valid saved credentials found.");
    clearEEPROM();
  }
}

// === EEPROM Helpers ===
void saveWiFiCredentials(String ssid, String pass) {
  writeStringToEEPROM(0, ssid);
  writeStringToEEPROM(32, pass);
  EEPROM.commit();
  Serial.println("Credentials saved to EEPROM.");
}

void writeStringToEEPROM(int startAddr, String data) {
  for (int i = 0; i < 32; i++) EEPROM.write(startAddr + i, 0);
  for (int i = 0; i < (int)data.length() && i < 31; i++)
    EEPROM.write(startAddr + i, data[i]);
  EEPROM.write(startAddr + min((int)data.length(), 31), '\0');
}

String readStringFromEEPROM(int startAddr) {
  char data[33];
  int len = 0;
  for (int i = 0; i < 32; i++) {
    byte k = EEPROM.read(startAddr + i);
    if (k == 0 || k == 0xFF) break;
    data[len++] = k;
  }
  data[len] = '\0';
  return String(data);
}

void clearEEPROM() {
  for (int i = 0; i < EEPROM_SIZE; i++) EEPROM.write(i, 0);
  EEPROM.commit();
  Serial.println("EEPROM cleared.");
}

void printEEPROMContents() {
  Serial.println("First 64 bytes of EEPROM:");
  for (int i = 0; i < 64; i++) {
    byte val = EEPROM.read(i);
    if (i % 16 == 0) { Serial.println(); Serial.print(i); Serial.print(": "); }
    if (val < 16) Serial.print("0");
    Serial.print(val, HEX); Serial.print(" ");
  }
  Serial.println();
}