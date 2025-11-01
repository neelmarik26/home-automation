// dowenlodes all this librayries to run properly
#include <ESP8266WiFi.h>
#include <ArduinoWebsockets.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

#define EEPROM_SIZE 128
using namespace websockets;

WebsocketsClient client;

// === Global Variables ===
unsigned long lastWebSocketAttempt = 0;
const unsigned long WEBSOCKET_RETRY_INTERVAL = 5000; // Reduced to 5 seconds
bool webSocketConnected = false;
unsigned long lastWiFiCheck = 0;
const unsigned long WIFI_CHECK_INTERVAL = 2000; // Check WiFi every 2 seconds

// === Function Declarations ===
void connectToWiFi(const char* ssid, const char* password);
void saveWiFiCredentials(String ssid, String pass);
String readStringFromEEPROM(int startAddr);
void writeStringToEEPROM(int startAddr, String data);
bool connectWebSocket();
void clearEEPROM();
void printEEPROMContents();
void handleWebSocketConnection();
void checkWiFiStatus(); // NEW: Function to monitor WiFi status

// === WebSocket Message Handler ===
void onMessageReceived(WebsocketsMessage message) {
  // Serial.print("Raw message: ");
  // Serial.println(message.data());

  if (message.length() > 512) {
    Serial.println("Message too large, skipping");
    return;
  }

  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, message.data());
  
  if (error) {
    Serial.print("JSON parse error: ");
    Serial.println(error.c_str());
    return;
  }

  // Handle button events
  if (doc.containsKey("button") && doc.containsKey("status")) {
    const char* btn = doc["button"];
    int sts = doc["status"];
    Serial.printf("%s status is %d\n", btn, sts);
    if(btn=="all"){
      digitalWrite(D5, LOW);
      digitalWrite(D6, LOW);
      digitalWrite(D7, LOW);
      digitalWrite(D8, LOW);
    }
    else if(btn=="btn1"){
      if(sts==0){
        digitalWrite(D5, LOW);
      }
      if(sts==1){
        digitalWrite(D5, HIGH);
      }
    }
    else if (btn=="btn2"){
      if(sts==0){
        digitalWrite(D6, LOW);
      }
      if(sts==1){
        digitalWrite(D6, HIGH);
      }
    }
    else if(btn=="btn3"){
      if(sts==0){
        digitalWrite(D7, LOW);
      }
      if(sts==1){
        digitalWrite(D7, HIGH);
      }
    }
    else if(btn=="btn4"){
      if(sts==0){
        digitalWrite(D8, LOW);
      }
      if(sts==1){
        digitalWrite(D8, HIGH);
      }
    }
  }

  // Handle new Wi-Fi credentials
  else if (doc.containsKey("ssid") && doc.containsKey("password")) {
    const char* newssid = doc["ssid"];
    const char* newpassword = doc["password"];
    
    Serial.println("New credentials received!");
    Serial.print("SSID: ");
    Serial.println(newssid);

    Serial.println("Trying new credentials...");
    connectToWiFi(newssid, newpassword);

    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("✅ New Wi-Fi connected successfully!");
      saveWiFiCredentials(newssid, newpassword);
      Serial.println("Old credentials replaced.");
      connectWebSocket();
    } else {
      Serial.println("❌ New Wi-Fi connection failed. Keeping old credentials.");
      fallbackToSavedCredentials();
    }
  }
}

void fallbackToSavedCredentials() {
  EEPROM.begin(EEPROM_SIZE);
  Serial.println("Checking old credentials from EEPROM:");
  
  String savedSSID = readStringFromEEPROM(0);
  String savedPASS = readStringFromEEPROM(32);
  
  Serial.print("SSID: '");
  Serial.print(savedSSID);
  Serial.println("'");
  
  bool credentialsValid = true;
  
  if (savedSSID.length() == 0 || savedSSID.length() > 31) {
    credentialsValid = false;
    Serial.println("SSID length invalid");
  }
  
  if (savedPASS.length() > 31) {
    credentialsValid = false;
    Serial.println("PASS length invalid");
  }

  bool ssidHasPrintable = false;
  for (int i = 0; i < savedSSID.length(); i++) {
    if (isPrintable(savedSSID[i])) {
      ssidHasPrintable = true;
      break;
    }
  }
  
  if (!ssidHasPrintable && savedSSID.length() > 0) {
    credentialsValid = false;
    Serial.println("SSID has no printable characters");
  }

  if (credentialsValid) {
    Serial.println("Trying saved credentials...");
    connectToWiFi(savedSSID.c_str(), savedPASS.c_str());
  } else {
    Serial.println("No valid saved Wi-Fi credentials found.");
    Serial.println("Clearing corrupted EEPROM data...");
    clearEEPROM();
    Serial.println("Please send credentials via Serial as: SSID,PASSWORD");
  }
}

// === NEW: WiFi Status Monitor ===
void checkWiFiStatus() {
  static bool lastWiFiStatus = false;
  bool currentWiFiStatus = (WiFi.status() == WL_CONNECTED);
  
  // If WiFi status changed
  if (currentWiFiStatus != lastWiFiStatus) {
    if (currentWiFiStatus) {
      Serial.println("✅ WiFi reconnected!");
      // Reset WebSocket state to force reconnection
      webSocketConnected = false;
      lastWebSocketAttempt = 0; // Allow immediate reconnection attempt
    } else {
      Serial.println("❌ WiFi disconnected!");
      webSocketConnected = false; // Mark WebSocket as disconnected
    }
    lastWiFiStatus = currentWiFiStatus;
  }
}

// === Setup ===
void setup() {
  Serial.begin(115200);
  EEPROM.begin(EEPROM_SIZE);
  pinMode(LED_BUILTIN, OUTPUT); 
  digitalWrite(LED_BUILTIN, HIGH);// Start with LED OFF
  pinMode(D5, OUTPUT); 
  pinMode(D6, OUTPUT); 
  pinMode(D7, OUTPUT); 
  pinMode(D8, OUTPUT);  
  delay(1000);

  Serial.println("\nBooting...");
  
  // Debug: Print EEPROM contents
  Serial.println("EEPROM Contents:");
  printEEPROMContents();
  
  String savedSSID = readStringFromEEPROM(0);
  String savedPASS = readStringFromEEPROM(32);

  Serial.println("Read from EEPROM:");
  Serial.print("SSID: '");
  Serial.print(savedSSID);
  Serial.println("'");
  Serial.print("PASS: '");
  Serial.print("***");
  Serial.println("'");

  // Check if credentials are valid
  bool credentialsValid = true;
  
  if (savedSSID.length() == 0 || savedSSID.length() > 31) {
    credentialsValid = false;
    Serial.println("SSID length invalid");
  }
  
  if (savedPASS.length() > 31) {
    credentialsValid = false;
    Serial.println("PASS length invalid");
  }
  
  bool ssidHasPrintable = false;
  for (int i = 0; i < savedSSID.length(); i++) {
    if (isPrintable(savedSSID[i])) {
      ssidHasPrintable = true;
      break;
    }
  }
  
  if (!ssidHasPrintable && savedSSID.length() > 0) {
    credentialsValid = false;
    Serial.println("SSID has no printable characters");
  }

  if (credentialsValid) {
    Serial.println("Using saved credentials...");
    connectToWiFi(savedSSID.c_str(), savedPASS.c_str());
  } else {
    Serial.println("No valid saved Wi-Fi credentials found.");
    Serial.println("Clearing corrupted EEPROM data...");
    clearEEPROM();
    Serial.println("Please send credentials via Serial as: SSID,PASSWORD");
  }

  // Initialize timing
  lastWebSocketAttempt = millis();
  lastWiFiCheck = millis();
}

// === Main Loop ===
void loop() {
  // Check WiFi status regularly
  checkWiFiStatus();
  
  // Handle WebSocket connection state
  handleWebSocketConnection();
  
  // Update LED status
  if (WiFi.status() == WL_CONNECTED && webSocketConnected) {
    digitalWrite(LED_BUILTIN, LOW); // LED ON when both WiFi and WS connected
  } else if (WiFi.status() == WL_CONNECTED) {
    // Blink slowly when WiFi connected but WS not connected
    digitalWrite(LED_BUILTIN, (millis() / 500) % 2 == 0 ? LOW : HIGH); // Faster blink
  } else {
    digitalWrite(LED_BUILTIN, HIGH); // LED OFF when no WiFi
  }

  // Handle Serial input for first-time setup
  if (Serial.available()) {
    String data = Serial.readStringUntil('\n');
    data.trim();
    
    if (data == "CLEAR_EEPROM") {
      clearEEPROM();
      Serial.println("EEPROM cleared. Restarting...");
      ESP.restart();
      return;
    }
    
    if (data == "SHOW_EEPROM") {
      printEEPROMContents();
      return;
    }
    
    if (data == "STATUS") {
      Serial.print("WiFi: ");
      Serial.println(WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected");
      Serial.print("WebSocket: ");
      Serial.println(webSocketConnected ? "Connected" : "Disconnected");
      Serial.print("IP: ");
      Serial.println(WiFi.localIP());
      return;
    }

    if (data == "RECONNECT_WS") {
      webSocketConnected = false;
      lastWebSocketAttempt = 0;
      Serial.println("Manual WebSocket reconnection triggered");
      return;
    }
    
    int separator = data.indexOf(',');
    if (separator > 0) {
      String newSSID = data.substring(0, separator);
      String newPASS = data.substring(separator + 1);
      newSSID.trim();
      newPASS.trim();

      Serial.println("Trying new credentials...");
      Serial.print("SSID: '");
      Serial.print(newSSID);
      Serial.println("'");

      connectToWiFi(newSSID.c_str(), newPASS.c_str());

      if (WiFi.status() == WL_CONNECTED) {
        Serial.println("✅ Connected! Saving credentials...");
        saveWiFiCredentials(newSSID, newPASS);
        connectWebSocket();
      } else {
        Serial.println("❌ Connection failed. Try again.");
      }
    } else {
      Serial.println("Invalid format. Use: SSID,PASSWORD");
      Serial.println("Other commands: CLEAR_EEPROM, SHOW_EEPROM, STATUS, RECONNECT_WS");
    }
  }

  // Small delay to prevent watchdog timer issues
  delay(10);
}

void handleWebSocketConnection() {
  // Keep WebSocket alive if connected
  if (webSocketConnected && client.available()) {
    client.poll();
  }
  
  // Try to reconnect WebSocket if disconnected but WiFi is connected
  if (WiFi.status() == WL_CONNECTED && !webSocketConnected) {
    unsigned long currentTime = millis();
    if (currentTime - lastWebSocketAttempt >= WEBSOCKET_RETRY_INTERVAL) {
      lastWebSocketAttempt = currentTime;
      Serial.println("Attempting to connect WebSocket...");
      connectWebSocket();
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
    Serial.println("\nWi-Fi connected!");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
    webSocketConnected = false; // Reset WebSocket state
    lastWebSocketAttempt = 0; // Allow immediate WebSocket connection attempt
  } else {
    Serial.println("\nFailed to connect.");
    WiFi.disconnect();
  }
}

// === EEPROM Helper Functions ===
void saveWiFiCredentials(String ssid, String pass) {
  Serial.println("Saving credentials to EEPROM:");
  Serial.print("SSID: '");
  Serial.print(ssid);
  Serial.println("'");
  
  writeStringToEEPROM(0, ssid);
  writeStringToEEPROM(32, pass);
  EEPROM.commit();
  Serial.println("Credentials saved to EEPROM");
}

void writeStringToEEPROM(int startAddr, String data) {
  for (int i = 0; i < 32; i++) {
    EEPROM.write(startAddr + i, 0);
  }
  
  for (int i = 0; i < data.length() && i < 31; i++) {
    EEPROM.write(startAddr + i, data[i]);
  }
  
  if (data.length() < 32) {
    EEPROM.write(startAddr + data.length(), '\0');
  } else {
    EEPROM.write(startAddr + 31, '\0');
  }
}

String readStringFromEEPROM(int startAddr) {
  char data[33];
  int len = 0;
  
  for (int i = 0; i < 32; i++) {
    byte k = EEPROM.read(startAddr + i);
    if (k == 0 || k == 0xFF) {
      break;
    }
    data[len++] = k;
  }
  data[len] = '\0';
  return String(data);
}

void clearEEPROM() {
  for (int i = 0; i < EEPROM_SIZE; i++) {
    EEPROM.write(i, 0);
  }
  EEPROM.commit();
  Serial.println("EEPROM cleared");
}

void printEEPROMContents() {
  Serial.println("First 64 bytes of EEPROM:");
  for (int i = 0; i < 64; i++) {
    byte val = EEPROM.read(i);
    if (i % 16 == 0) {
      Serial.println();
      Serial.print(i);
      Serial.print(": ");
    }
    if (val < 16) Serial.print("0");
    Serial.print(val, HEX);
    Serial.print(" ");
  }
  Serial.println();
}

// === WebSocket Connection ===
bool connectWebSocket() {
  Serial.println("Connecting to WebSocket...");
  client.onMessage(onMessageReceived);

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Cannot start WebSocket: Wi-Fi not connected.");
    webSocketConnected = false;
    return false;
  }

  bool connected = client.connect("wss://home-automation-1-8kqb.onrender.com/ws");
  
  if (connected) {
    Serial.println("✅ WebSocket connected!");
    webSocketConnected = true;
    client.send("Hello from ESP8266!");
    return true;
  } else {
    Serial.println("❌ WebSocket connection failed.");
    webSocketConnected = false;
    return false;
  }
}