/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║     ESP32 Home Automation Client  v5.2  — BUG-FIXED             ║
 * ║  WS · OTA · WiFiManager · mDNS · Backoff · NVS · Telnet Log     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * FIXES FROM v5.1 → v5.2:
 *   [BUG1] CRITICAL  — Removed ws.setReconnectInterval(): conflicted with
 *                       manual backoff → caused duplicate connect storms,
 *                       WS state corruption, eventual freeze.
 *   [BUG2] CRITICAL  — Serial.readStringUntil() & telnetClient.readStringUntil()
 *                       both BLOCKED the loop up to 1 s each call, starving
 *                       ws.loop(), OTA, LED — "nothing works after a while".
 *                       Replaced with non-blocking char-by-char buffering.
 *   [BUG3] MAJOR     — Heap fragmentation: constant String objects inside
 *                       10 ms loop (health + heartbeat + snapshots) caused
 *                       progressive fragmentation → crash. Removed periodic
 *                       health spam; added low-heap auto-restart guard.
 *   [BUG4] MAJOR     — Telnet rx buffer never cleared on client disconnect;
 *                       stale bytes fed into next session as a phantom command.
 *   [BUG5] REMOVED   — Periodic 10 s health report (user request).
 *                       Logs now print ONLY on real events or explicit cmds.
 *   [BUG6] REMOVED   — 5 s heartbeat auto-spam removed.
 *   [BUG7] MINOR     — delay(50) inside checkWiFiStatus() replaced with a
 *                       non-blocking flag so the loop stays responsive.
 *   [BUG8] MINOR     — Redundant extern declaration inside handleTelnet()
 *                       replaced with a proper top-level forward declaration.
 *
 * Libraries required (Arduino Library Manager):
 *   - WebSockets   by Markus Sattler
 *   - ArduinoJson  v6.x
 *   - WiFiManager  by tzapu
 *   (ArduinoOTA, ESPmDNS, Preferences are bundled with ESP32 Arduino core)
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  TELNET SERIAL MONITOR                                          │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  Connect:  telnet 192.168.x.x 23                                │
 * │  Or:       telnet esp32-home.local 23                           │
 * │                                                                 │
 * │  COMMANDS (USB Serial or Telnet, case-insensitive):             │
 * │    STATUS      — full diagnostic table                          │
 * │    HEALTH      — immediate health report                        │
 * │    RECONNECT   — force WebSocket reconnect                      │
 * │    RESTART     — reboot ESP32                                   │
 * │    ALL_ON/OFF  — all relays                                     │
 * │    R2=1        — set relay 2 ON  (R1–R4, value 0 or 1)         │
 * │    T3          — toggle relay 3                                 │
 * │    OTA_INFO    — show OTA upload details                        │
 * │    PORTAL      — open WiFiManager captive portal                │
 * │    CLEAR_WIFI  — wipe credentials + restart                     │
 * │    RESET_BOOT  — zero NVS boot counter                          │
 * │                                                                 │
 * │  LED behaviour:                                                 │
 * │    Slow blink (1 Hz)  — no WiFi                                 │
 * │    Fast blink (4 Hz)  — WiFi OK, WS down                       │
 * │    Solid ON           — WiFi + WS both up                       │
 * └─────────────────────────────────────────────────────────────────┘
 */

// ─── Libraries ────────────────────────────────────────────────────
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include <WiFiManager.h>
#include <ESPmDNS.h>
#include <Preferences.h>

// ─── Pin Map (NodeMCU D5–D8 → ESP32 GPIO) ─────────────────────────
#define LED_PIN      2
#define RELAY_COUNT  4
const uint8_t RELAY_PINS[RELAY_COUNT] = {14, 12, 13, 15};

// ─── Server ───────────────────────────────────────────────────────
constexpr char     WS_HOST[]      = "home-automation-1-8kqb.onrender.com";
constexpr uint16_t WS_PORT        = 443;
constexpr char     WS_PATH[]      = "/ws";
constexpr char     DEVICE_NAME[]  = "esp32-home";
constexpr char     FW_VERSION[]   = "5.2";
constexpr char     OTA_PASSWORD[] = "ota1234";   // ⚠ change before deploy

// ─── Telnet ───────────────────────────────────────────────────────
constexpr uint16_t TELNET_PORT    = 23;

// ─── Timing ───────────────────────────────────────────────────────
constexpr uint32_t WS_RETRY_MIN      =  5000;   // 5 s minimum retry
constexpr uint32_t WS_RETRY_MAX      = 60000;   // 60 s maximum retry
constexpr uint32_t WIFI_CHECK_MS     =  2000;   // WiFi state poll
constexpr uint32_t RSSI_WARN_COOL_MS = 30000;   // min gap between RSSI warnings
constexpr uint32_t WIFI_NUDGE_MS     = 30000;   // nudge if WiFi stays down

// ─── Heap safety ──────────────────────────────────────────────────
constexpr uint32_t HEAP_MIN_BYTES    = 15000;   // restart if heap < this

// ─── RSSI Thresholds ─────────────────────────────────────────────
constexpr int32_t RSSI_EXCELLENT = -50;
constexpr int32_t RSSI_GOOD      = -65;
constexpr int32_t RSSI_FAIR      = -75;

// ═════════════════════════════════════════════════════════════════
//  Logger  (must appear before Telnet globals)
// ═════════════════════════════════════════════════════════════════
enum LogLevel : uint8_t { LOG_DEBUG = 0, LOG_INFO, LOG_WARN, LOG_ERROR };
constexpr LogLevel ACTIVE_LOG_LEVEL = LOG_INFO;   // DBG/INF/WRN/ERR

// ─── Telnet globals (declared here; set up after WiFi) ────────────
WiFiServer telnetServer(TELNET_PORT);
WiFiClient telnetClient;
bool       telnetActive = false;

// Forward declarations needed by logMsg
void telnetPrint(const char* buf);
void printBoth(const char* line);
void processSerial(const String& cmd);   // [FIX8] proper forward-decl, not extern inside fn

void telnetPrint(const char* buf) {
  if (!telnetActive) return;
  if (!telnetClient || !telnetClient.connected()) {
    telnetActive = false;
    return;
  }
  telnetClient.print(buf);
}

// Print a line to both USB Serial and Telnet (for STATUS/HEALTH tables)
void printBoth(const char* line) {
  Serial.println(line);
  if (telnetActive && telnetClient && telnetClient.connected()) {
    telnetClient.println(line);
  }
}

void logMsg(LogLevel lvl, const char* tag, const char* msg) {
  if (lvl < ACTIVE_LOG_LEVEL) return;
  static const char* const LBL[] = {"DBG", "INF", "WRN", "ERR"};
  uint32_t ms  = millis();
  uint32_t sec = ms / 1000;
  char buf[300];
  snprintf(buf, sizeof(buf), "[%02u:%02u:%02u.%03u][%s][%-8s] %s\r\n",
    sec / 3600, (sec % 3600) / 60, sec % 60, ms % 1000,
    LBL[lvl], tag, msg);
  Serial.print(buf);
  telnetPrint(buf);
}

// Overload accepting String — avoids c_str() scattered everywhere
void logMsg(LogLevel lvl, const char* tag, const String& msg) {
  logMsg(lvl, tag, msg.c_str());
}

#define LOGD(t, m) logMsg(LOG_DEBUG, t, m)
#define LOGI(t, m) logMsg(LOG_INFO,  t, m)
#define LOGW(t, m) logMsg(LOG_WARN,  t, m)
#define LOGE(t, m) logMsg(LOG_ERROR, t, m)

// ═════════════════════════════════════════════════════════════════
//  Global Objects
// ═════════════════════════════════════════════════════════════════
WebSocketsClient ws;
Preferences      prefs;

// ─── Runtime State ────────────────────────────────────────────────
bool     wsConnected    = false;
bool     relays[RELAY_COUNT] = {};
uint32_t lastWsAttempt  = 0;
uint32_t wsRetryDelay   = WS_RETRY_MIN;
uint32_t lastWifiCheck  = 0;
uint32_t lastRssiWarn   = 0;
uint32_t lastNudge      = 0;
uint32_t wsConnectedAt  = 0;
uint32_t pingTime       = 0;
uint32_t pongLatencyMs  = 0;
uint32_t bootCount      = 0;
volatile bool needReconnect = false;

// [FIX4] Non-blocking Telnet rx buffer (clears on disconnect)
static String telnetBuf = "";

// [FIX2] Non-blocking Serial rx buffer
static String serialBuf = "";

// ─── Forward Declarations ─────────────────────────────────────────
void        setupPrefs();
void        setupWiFiManager(bool forcePortal = false);
void        setupWiFiEvents();
void        setupOTA();
void        setupMDNS();
void        setupTelnet();
void        handleTelnet();
void        connectWebSocket();
void        handleWebSocketReconnect();
void        checkWiFiStatus();
void        sendHealthReport();
void        setRelay(uint8_t idx, bool on);
void        toggleRelay(uint8_t idx);
void        setAllRelays(bool on);
void        updateLED(uint32_t now);
void        onWsEvent(WStype_t type, uint8_t* payload, size_t length);
const char* rssiQuality(int32_t rssi);
String      formatUptime(uint32_t seconds);
String      getResetReason();
String      relaySnapshot();
uint32_t    nextBackoff(uint32_t current);

// ═════════════════════════════════════════════════════════════════
//  Helpers
// ═════════════════════════════════════════════════════════════════
const char* rssiQuality(int32_t rssi) {
  if (rssi >= RSSI_EXCELLENT) return "Excellent";
  if (rssi >= RSSI_GOOD)      return "Good";
  if (rssi >= RSSI_FAIR)      return "Fair";
  return "Poor";
}

String formatUptime(uint32_t s) {
  char buf[32];
  uint32_t d = s / 86400, h = (s % 86400) / 3600,
           m = (s % 3600) / 60, sc = s % 60;
  if (d) snprintf(buf, sizeof(buf), "%ud %02uh %02um %02us", d, h, m, sc);
  else   snprintf(buf, sizeof(buf), "%02uh %02um %02us", h, m, sc);
  return String(buf);
}

String getResetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:   return "Power-on";
    case ESP_RST_SW:        return "Software";
    case ESP_RST_PANIC:     return "Panic/Crash";
    case ESP_RST_INT_WDT:   return "Int.Watchdog";
    case ESP_RST_TASK_WDT:  return "Task Watchdog";
    case ESP_RST_WDT:       return "Watchdog";
    case ESP_RST_DEEPSLEEP: return "Deep-sleep";
    case ESP_RST_BROWNOUT:  return "Brownout";
    default:                return "Unknown";
  }
}

String relaySnapshot() {
  String s;
  s.reserve(28);
  for (uint8_t i = 0; i < RELAY_COUNT; i++) {
    if (i) s += ' ';
    s += 'R'; s += (char)('1' + i); s += '=';
    s += relays[i] ? "ON " : "OFF";
  }
  return s;
}

uint32_t nextBackoff(uint32_t current) {
  if (current >= WS_RETRY_MAX / 2) return WS_RETRY_MAX;
  return current * 2;
}

// ═════════════════════════════════════════════════════════════════
//  NVS / Preferences
// ═════════════════════════════════════════════════════════════════
void setupPrefs() {
  prefs.begin("ha", false);
  bootCount = prefs.getUInt("boot", 0) + 1;
  prefs.putUInt("boot", bootCount);
  prefs.end();
}

// ═════════════════════════════════════════════════════════════════
//  WiFiManager
// ═════════════════════════════════════════════════════════════════
void setupWiFiManager(bool forcePortal) {
  LOGI("WM", forcePortal ? "Forcing captive portal..." : "autoConnect starting...");

  WiFiManager wm;
  wm.setConfigPortalTimeout(300);
  wm.setConnectTimeout(20);
  wm.setTitle("ESP32 Home Automation");
  wm.setClass("invert");

  wm.setAPCallback([](WiFiManager*) {
    LOGW("WM", "Portal OPEN — connect to WiFi 'ESP32-Setup', then open 192.168.4.1");
    for (int i = 0; i < 6; i++) {
      digitalWrite(LED_PIN, LOW);  delay(100);
      digitalWrite(LED_PIN, HIGH); delay(100);
    }
  });
  wm.setSaveConfigCallback([]() {
    LOGI("WM", "Credentials saved via portal");
  });

  bool ok = forcePortal
    ? wm.startConfigPortal("ESP32-Setup")
    : wm.autoConnect("ESP32-Setup");

  if (ok) {
    WiFi.setAutoReconnect(true);
    WiFi.persistent(true);
    char buf[120];
    snprintf(buf, sizeof(buf), "Connected  IP=%s  RSSI=%ddBm (%s)  SSID=%s",
      WiFi.localIP().toString().c_str(), WiFi.RSSI(),
      rssiQuality(WiFi.RSSI()), WiFi.SSID().c_str());
    LOGI("WM", buf);
  } else {
    LOGW("WM", "Portal timed out — no credentials. Restarting in 3 s...");
    delay(3000);
    ESP.restart();
  }
}

// ═════════════════════════════════════════════════════════════════
//  WiFi Events
// ═════════════════════════════════════════════════════════════════
void setupWiFiEvents() {
  WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
    switch (event) {
      case ARDUINO_EVENT_WIFI_STA_GOT_IP: {
        char buf[60];
        snprintf(buf, sizeof(buf), "IP acquired: %s  RSSI=%ddBm",
          WiFi.localIP().toString().c_str(), WiFi.RSSI());
        LOGI("WiFi", buf);
        wsConnected   = false;
        lastWsAttempt = 0;
        wsRetryDelay  = WS_RETRY_MIN;
        needReconnect = false;
        break;
      }
      case ARDUINO_EVENT_WIFI_STA_DISCONNECTED: {
        char buf[48];
        snprintf(buf, sizeof(buf), "Disconnected  reason=%u",
          info.wifi_sta_disconnected.reason);
        LOGW("WiFi", buf);
        wsConnected   = false;
        needReconnect = true;
        break;
      }
      case ARDUINO_EVENT_WIFI_STA_CONNECTED:
        LOGI("WiFi", "Associated — waiting for IP...");
        break;
      default: break;
    }
  });
}

// ═════════════════════════════════════════════════════════════════
//  OTA
// ═════════════════════════════════════════════════════════════════
void setupOTA() {
  ArduinoOTA.setHostname(DEVICE_NAME);
  ArduinoOTA.setPassword(OTA_PASSWORD);

  ArduinoOTA.onStart([]() {
    setAllRelays(false);
    const char* type = (ArduinoOTA.getCommand() == U_FLASH) ? "firmware" : "filesystem";
    char buf[48];
    snprintf(buf, sizeof(buf), "=== UPDATE START: %s ===", type);
    LOGI("OTA", buf);
  });
  ArduinoOTA.onEnd([]() {
    LOGI("OTA", "=== UPDATE COMPLETE — rebooting ===");
    if (telnetActive && telnetClient.connected())
      telnetClient.println("\r\n[OTA] Rebooting... reconnect in ~3 s\r\n");
  });
  ArduinoOTA.onProgress([](uint32_t done, uint32_t total) {
    static uint8_t prevPct = 255;
    uint8_t pct = (uint8_t)(done * 100 / total);
    if (pct / 5 != prevPct / 5) {
      char buf[56];
      snprintf(buf, sizeof(buf), "\r[OTA] %3u%%  (%u / %u B)   ", pct, done, total);
      Serial.print(buf);
      telnetPrint(buf);
      prevPct = pct;
    }
  });
  ArduinoOTA.onError([](ota_error_t e) {
    const char* reasons[] = {"Auth", "Begin", "Connect", "Receive", "End"};
    char buf[48];
    snprintf(buf, sizeof(buf), "Error[%d]: %s", (int)e,
      (e >= OTA_AUTH_ERROR && e <= OTA_END_ERROR) ? reasons[e] : "Unknown");
    LOGE("OTA", buf);
  });

  ArduinoOTA.begin();
  char buf[80];
  snprintf(buf, sizeof(buf), "Ready  host=%s.local  ip=%s  port=3232",
    DEVICE_NAME, WiFi.localIP().toString().c_str());
  LOGI("OTA", buf);
}

// ═════════════════════════════════════════════════════════════════
//  mDNS
// ═════════════════════════════════════════════════════════════════
void setupMDNS() {
  if (MDNS.begin(DEVICE_NAME)) {
    MDNS.addService("ws",     "tcp", WS_PORT);
    MDNS.addService("http",   "tcp", 80);
    MDNS.addService("telnet", "tcp", TELNET_PORT);
    char buf[48];
    snprintf(buf, sizeof(buf), "%s.local  (ws + http + telnet)", DEVICE_NAME);
    LOGI("mDNS", buf);
  } else {
    LOGW("mDNS", "Failed to start");
  }
}

// ═════════════════════════════════════════════════════════════════
//  Telnet Setup
// ═════════════════════════════════════════════════════════════════
void setupTelnet() {
  telnetServer.begin();
  telnetServer.setNoDelay(true);
  char buf[64];
  snprintf(buf, sizeof(buf), "Server started — telnet %s 23",
    WiFi.localIP().toString().c_str());
  LOGI("TELNET", buf);
}

// ═════════════════════════════════════════════════════════════════
//  Telnet Handler  — [FIX2] [FIX4] non-blocking, buffer-safe
// ═════════════════════════════════════════════════════════════════
void handleTelnet() {
  // ── Accept new connection (drops old one) ──────────────────────
  if (telnetServer.hasClient()) {
    if (telnetClient && telnetClient.connected()) {
      telnetClient.println("\r\n[TELNET] New client — dropping you.");
      telnetClient.stop();
    }
    telnetClient  = telnetServer.available();
    telnetActive  = true;
    telnetBuf     = "";   // [FIX4] always clear on new session

    // Welcome banner
    char ip[20];
    snprintf(ip, sizeof(ip), "%s", WiFi.localIP().toString().c_str());
    telnetClient.println("\r\n+==========================================+");
    {
      char line[48];
      snprintf(line, sizeof(line), "|   ESP32 Home Automation  v%-5s          |", FW_VERSION);
      telnetClient.println(line);
      snprintf(line, sizeof(line), "|   IP: %-34s|", ip);
      telnetClient.println(line);
    }
    telnetClient.println("+==========================================+");
    telnetClient.println("| All event logs stream here in real time. |");
    telnetClient.println("| Type a command + ENTER                   |");
    telnetClient.println("| STATUS  HEALTH  RECONNECT  RESTART  ...  |");
    telnetClient.println("+==========================================+\r\n");
    LOGI("TELNET", "Client connected");
  }

  // ── [FIX2] Non-blocking character-by-character read ───────────
  if (telnetActive && telnetClient && telnetClient.connected()) {
    while (telnetClient.available()) {
      char c = (char)telnetClient.read();
      if (c == '\n') {
        // Strip carriage return if present
        if (telnetBuf.length() > 0 && telnetBuf[telnetBuf.length()-1] == '\r')
          telnetBuf.remove(telnetBuf.length()-1);
        telnetBuf.trim();
        telnetBuf.toUpperCase();
        if (telnetBuf.length() > 0) {
          telnetClient.println("> " + telnetBuf);
          processSerial(telnetBuf);   // [FIX8] uses top-level forward decl
        }
        telnetBuf = "";
      } else {
        if (telnetBuf.length() < 64) telnetBuf += c;  // limit buffer size
      }
    }
  }

  // ── Detect disconnect ──────────────────────────────────────────
  if (telnetActive && (!telnetClient || !telnetClient.connected())) {
    if (telnetClient) telnetClient.stop();
    telnetActive = false;
    telnetBuf    = "";   // [FIX4] clear stale buffer
    LOGI("TELNET", "Client disconnected");
  }
}

// ═════════════════════════════════════════════════════════════════
//  Relay Control
// ═════════════════════════════════════════════════════════════════
void setRelay(uint8_t idx, bool on) {
  if (idx >= RELAY_COUNT) {
    char buf[36]; snprintf(buf, sizeof(buf), "Index out of range: %u", idx);
    LOGW("RELAY", buf);
    return;
  }
  bool changed = (relays[idx] != on);
  relays[idx] = on;
  digitalWrite(RELAY_PINS[idx], on ? HIGH : LOW);
  if (changed) {
    char buf[48];
    snprintf(buf, sizeof(buf), "R%u -> %s   [%s]", idx+1, on?"ON ":"OFF", relaySnapshot().c_str());
    LOGI("RELAY", buf);
  }
}

void toggleRelay(uint8_t idx) {
  if (idx >= RELAY_COUNT) return;
  setRelay(idx, !relays[idx]);
}

void setAllRelays(bool on) {
  for (uint8_t i = 0; i < RELAY_COUNT; i++) {
    relays[i] = on;
    digitalWrite(RELAY_PINS[i], on ? HIGH : LOW);
  }
  char buf[36];
  snprintf(buf, sizeof(buf), "All -> %s   [%s]", on?"ON":"OFF", relaySnapshot().c_str());
  LOGI("RELAY", buf);
}

// ═════════════════════════════════════════════════════════════════
//  Health Report  (on-demand only — [BUG5] periodic removed)
// ═════════════════════════════════════════════════════════════════
void sendHealthReport() {
  uint32_t ms  = millis();
  uint32_t sec = ms / 1000;
  char buf[120];

  printBoth("--------------------------------------------");
  snprintf(buf, sizeof(buf), "Uptime : %s  (%us)", formatUptime(sec).c_str(), sec);
  printBoth(buf);
  snprintf(buf, sizeof(buf), "WiFi   : %s  SSID=%s  RSSI=%ddBm (%s)",
    WiFi.isConnected() ? "UP" : "DOWN", WiFi.SSID().c_str(),
    WiFi.RSSI(), rssiQuality(WiFi.RSSI()));
  printBoth(buf);
  snprintf(buf, sizeof(buf), "Network: IP=%s  GW=%s  DNS=%s",
    WiFi.localIP().toString().c_str(),
    WiFi.gatewayIP().toString().c_str(),
    WiFi.dnsIP().toString().c_str());
  printBoth(buf);
  snprintf(buf, sizeof(buf), "WS     : %s  RTT=%ums  backoff=%us",
    wsConnected ? "UP" : "DOWN", pongLatencyMs, wsRetryDelay / 1000);
  printBoth(buf);
  snprintf(buf, sizeof(buf), "Heap   : %uB free  min=%uB  total=%uB",
    ESP.getFreeHeap(), ESP.getMinFreeHeap(), ESP.getHeapSize());
  printBoth(buf);
  snprintf(buf, sizeof(buf), "Flash  : %uKB  Sketch=%uKB  Free=%uKB",
    ESP.getFlashChipSize()/1024, ESP.getSketchSize()/1024, ESP.getFreeSketchSpace()/1024);
  printBoth(buf);
  snprintf(buf, sizeof(buf), "CPU    : %u MHz", getCpuFrequencyMhz());
  printBoth(buf);
  snprintf(buf, sizeof(buf), "Telnet : %s", telnetActive ? "Client connected" : "No client");
  printBoth(buf);
  snprintf(buf, sizeof(buf), "Relays : %s", relaySnapshot().c_str());
  printBoth(buf);
  snprintf(buf, sizeof(buf), "Boot # : %u   Reset=%s", bootCount, getResetReason().c_str());
  printBoth(buf);
  printBoth("--------------------------------------------");

  // Send to server if connected
  if (!wsConnected) return;
  StaticJsonDocument<400> doc;
  doc["type"]       = "health";
  doc["ip"]         = WiFi.localIP().toString();
  doc["ssid"]       = WiFi.SSID();
  doc["rssi"]       = WiFi.RSSI();
  doc["signal"]     = rssiQuality(WiFi.RSSI());
  doc["heap"]       = ESP.getFreeHeap();
  doc["heapMin"]    = ESP.getMinFreeHeap();
  doc["heapTotal"]  = ESP.getHeapSize();
  doc["uptime"]     = sec;
  doc["uptimeFmt"]  = formatUptime(sec);
  doc["cpu"]        = getCpuFrequencyMhz();
  doc["latency"]    = pongLatencyMs;
  doc["boot"]       = bootCount;
  doc["reset"]      = getResetReason();
  doc["sketchFree"] = ESP.getFreeSketchSpace();
  doc["telnet"]     = telnetActive;
  JsonArray arr = doc.createNestedArray("relays");
  for (uint8_t i = 0; i < RELAY_COUNT; i++) arr.add(relays[i]);
  String out;
  serializeJson(doc, out);
  ws.sendTXT(out);
}

// ═════════════════════════════════════════════════════════════════
//  WebSocket Event Handler
// ═════════════════════════════════════════════════════════════════
void onWsEvent(WStype_t type, uint8_t* payload, size_t len) {
  switch (type) {

    case WStype_DISCONNECTED: {
      uint32_t sessionSec = wsConnectedAt ? (millis() - wsConnectedAt) / 1000 : 0;
      wsRetryDelay  = nextBackoff(wsRetryDelay);
      char buf[64];
      snprintf(buf, sizeof(buf), "Disconnected  session=%us  nextRetry=%us",
        sessionSec, wsRetryDelay / 1000);
      LOGW("WS", buf);
      wsConnected   = false;
      wsConnectedAt = 0;
      break;
    }

    case WStype_CONNECTED: {
      wsConnected   = true;
      wsConnectedAt = millis();
      wsRetryDelay  = WS_RETRY_MIN;
      char buf[72];
      snprintf(buf, sizeof(buf), "Connected  wss://%s%s", WS_HOST, WS_PATH);
      LOGI("WS", buf);

      StaticJsonDocument<256> hi;
      hi["type"]    = "hello";
      hi["device"]  = DEVICE_NAME;
      hi["version"] = FW_VERSION;
      hi["ip"]      = WiFi.localIP().toString();
      hi["ssid"]    = WiFi.SSID();
      hi["rssi"]    = WiFi.RSSI();
      hi["signal"]  = rssiQuality(WiFi.RSSI());
      hi["boot"]    = bootCount;
      hi["reset"]   = getResetReason();
      hi["relays"]  = RELAY_COUNT;
      hi["heap"]    = ESP.getFreeHeap();
      String out; serializeJson(hi, out);
      ws.sendTXT(out);
      break;
    }

    case WStype_TEXT: {
      StaticJsonDocument<512> doc;
      DeserializationError err = deserializeJson(doc, payload, len);
      if (err) { LOGE("WS", "JSON parse error"); break; }

      // ── Relay set ─────────────────────────────────────────────
      if (doc.containsKey("button") && doc.containsKey("status")) {
        const char* btn = doc["button"];
        bool on = (doc["status"].as<int>() == 1);

        // ── SERVER COMMAND LOG ────────────────────────────────────
        // Printed immediately when the server sends a button command,
        // before the relay physically changes state.
        {
          char sbuf[72];
          if (strcmp(btn, "all") == 0) {
            snprintf(sbuf, sizeof(sbuf),
              ">>> SERVER CMD  All Relays -> %s", on ? "ON" : "OFF");
          } else if (strncmp(btn, "btn", 3) == 0) {
            uint8_t rnum = (uint8_t)(btn[3] - '0');  // button number 1-4
            snprintf(sbuf, sizeof(sbuf),
              ">>> SERVER CMD  Button %u (Relay %u) -> %s", rnum, rnum, on ? "ON" : "OFF");
          } else {
            snprintf(sbuf, sizeof(sbuf),
              ">>> SERVER CMD  '%s' -> %s", btn, on ? "ON" : "OFF");
          }
          // Use printBoth so it shows on USB Serial AND Telnet clearly
          printBoth("--------------------------------------------------");
          printBoth(sbuf);
          printBoth("--------------------------------------------------");
        }

        if (strcmp(btn, "all") == 0) {
          setAllRelays(on);
        } else if (strncmp(btn, "btn", 3) == 0 &&
                   btn[3] >= '1' && btn[3] <= ('0' + RELAY_COUNT)) {
          setRelay((uint8_t)(btn[3] - '1'), on);
        } else {
          char wbuf[48]; snprintf(wbuf, sizeof(wbuf), "Unknown button: %s", btn);
          LOGW("WS", wbuf);
        }
        StaticJsonDocument<192> ack;
        ack["type"] = "ack"; ack["cmd"] = btn; ack["status"] = on;
        JsonArray arr = ack.createNestedArray("relays");
        for (uint8_t i = 0; i < RELAY_COUNT; i++) arr.add(relays[i]);
        String out; serializeJson(ack, out);
        ws.sendTXT(out);
        LOGI("WS", "ACK sent to server");
        break;
      }

      // ── Relay toggle ──────────────────────────────────────────
      if (doc.containsKey("toggle")) {
        int n = doc["toggle"].as<int>();
        uint8_t idx = (uint8_t)(n - 1);
        if (idx < RELAY_COUNT) {
          // ── SERVER COMMAND LOG ──────────────────────────────────
          {
            char sbuf[56];
            snprintf(sbuf, sizeof(sbuf),
              ">>> SERVER CMD  Toggle Button %d (Relay %d)", n, n);
            printBoth("--------------------------------------------------");
            printBoth(sbuf);
            printBoth("--------------------------------------------------");
          }
          toggleRelay(idx);
          StaticJsonDocument<128> ack;
          ack["type"] = "ack"; ack["cmd"] = "toggle";
          ack["relay"] = n; ack["state"] = relays[idx];
          String out; serializeJson(ack, out);
          ws.sendTXT(out);
          LOGI("WS", "ACK sent to server");
        } else {
          LOGW("WS", "Toggle index out of range");
        }
        break;
      }

      // ── WiFi credentials update ───────────────────────────────
      if (doc.containsKey("ssid") && doc.containsKey("password")) {
        const char* ns = doc["ssid"];
        const char* np = doc["password"];
        char buf[64]; snprintf(buf, sizeof(buf), "New credentials  SSID='%s'", ns);
        LOGI("WS", buf);
        ws.sendTXT("{\"type\":\"wifi\",\"status\":\"applying\"}");
        WiFi.disconnect(false);
        delay(200);
        WiFi.begin(ns, np);
        uint8_t t = 0;
        while (WiFi.status() != WL_CONNECTED && ++t < 30) {
          delay(500);
        }
        if (WiFi.status() == WL_CONNECTED) {
          LOGI("WS", "New network OK");
          ws.sendTXT("{\"type\":\"wifi\",\"status\":\"updated\"}");
          wsConnected = false; lastWsAttempt = 0; wsRetryDelay = WS_RETRY_MIN;
        } else {
          LOGW("WS", "Network change failed — reconnecting previous");
          WiFi.disconnect(false);
          ws.sendTXT("{\"type\":\"wifi\",\"status\":\"failed\"}");
          needReconnect = true;
        }
        break;
      }

      // ── OTA arm ───────────────────────────────────────────────
      if (doc["ota"] == true) {
        ws.sendTXT("{\"type\":\"ota\",\"status\":\"armed\"}");
        char buf[60];
        snprintf(buf, sizeof(buf), "Armed — upload to %s.local:3232",
          DEVICE_NAME);
        LOGI("OTA", buf);
        break;
      }

      // ── Server ping ───────────────────────────────────────────
      if (doc["type"] == "ping") {
        ws.sendTXT("{\"type\":\"pong\",\"t\":" + String(millis()) + "}");
        break;
      }

      // ── On-demand health ──────────────────────────────────────
      if (doc["type"] == "health_req") {
        LOGI("WS", "Health report requested by server");
        sendHealthReport();
        break;
      }

      LOGW("WS", "Unhandled message");
      break;
    }

    case WStype_PING:
      pingTime = millis();
      break;

    case WStype_PONG:
      if (pingTime) {
        pongLatencyMs = millis() - pingTime;
        pingTime = 0;
      }
      break;

    case WStype_ERROR:
      LOGE("WS", "Socket error");
      wsConnected = false;
      break;

    default: break;
  }
}

// ═════════════════════════════════════════════════════════════════
//  WebSocket Connection
//  [FIX1] ws.setReconnectInterval() REMOVED — it conflicted with
//          the manual backoff below, causing duplicate connections.
// ═════════════════════════════════════════════════════════════════
void connectWebSocket() {
  if (!WiFi.isConnected()) { LOGW("WS", "Cannot connect — WiFi down"); return; }
  char buf[48];
  snprintf(buf, sizeof(buf), "Connecting... backoff=%us", wsRetryDelay / 1000);
  LOGI("WS", buf);
  ws.beginSSL(WS_HOST, WS_PORT, WS_PATH);
}

void handleWebSocketReconnect() {
  if (wsConnected || !WiFi.isConnected()) return;
  uint32_t now = millis();
  if (now - lastWsAttempt >= wsRetryDelay) {
    lastWsAttempt = now;
    connectWebSocket();
  }
}

// ═════════════════════════════════════════════════════════════════
//  WiFi Status Check  [FIX7] removed delay(50) from loop context
// ═════════════════════════════════════════════════════════════════
void checkWiFiStatus() {
  uint32_t now = millis();
  bool up = WiFi.isConnected();

  if (needReconnect && !up) {
    needReconnect = false;
    LOGI("WiFi", "Reconnecting...");
    WiFi.reconnect();
    return;   // give it time; don't also nudge this same cycle
  }

  if (!up && now - lastNudge >= WIFI_NUDGE_MS) {
    lastNudge = now;
    LOGW("WiFi", "Still down — nudging reconnect");
    WiFi.disconnect(false);
    // [FIX7] no delay() here; reconnect fires next WiFi event
    WiFi.reconnect();
  }

  if (up && WiFi.RSSI() < RSSI_FAIR && now - lastRssiWarn >= RSSI_WARN_COOL_MS) {
    lastRssiWarn = now;
    char buf[64];
    snprintf(buf, sizeof(buf), "Weak signal: %ddBm (%s)",
      WiFi.RSSI(), rssiQuality(WiFi.RSSI()));
    LOGW("WiFi", buf);
  }
}

// ═════════════════════════════════════════════════════════════════
//  LED  (active LOW on ESP32 built-in)
// ═════════════════════════════════════════════════════════════════
void updateLED(uint32_t now) {
  bool on;
  if (!WiFi.isConnected()) on = (now / 500) % 2 == 0;  // 1 Hz  = no WiFi
  else if (!wsConnected)   on = (now / 125) % 2 == 0;  // 4 Hz  = WS down
  else                     on = true;                   // solid = all good
  digitalWrite(LED_PIN, on ? LOW : HIGH);               // active LOW
}

// ═════════════════════════════════════════════════════════════════
//  Command Processor — shared by USB Serial AND Telnet
// ═════════════════════════════════════════════════════════════════
void processSerial(const String& cmd) {

  if (cmd == "STATUS") {
    uint32_t sec = millis() / 1000;
    char buf[60];
    printBoth("+------------------------------------------+");
    snprintf(buf,sizeof(buf),"| ESP32 Home Automation  v%-5s            |", FW_VERSION);
    printBoth(buf);
    printBoth("+------------------------------------------+");
    snprintf(buf,sizeof(buf),"| WiFi    : %-4s  SSID: %-18s|",
      WiFi.isConnected()?"UP":"DOWN", WiFi.SSID().c_str()); printBoth(buf);
    snprintf(buf,sizeof(buf),"| RSSI    : %4d dBm  %-21s|",
      WiFi.RSSI(), rssiQuality(WiFi.RSSI())); printBoth(buf);
    snprintf(buf,sizeof(buf),"| IP      : %-30s|",
      WiFi.localIP().toString().c_str()); printBoth(buf);
    snprintf(buf,sizeof(buf),"| Gateway : %-30s|",
      WiFi.gatewayIP().toString().c_str()); printBoth(buf);
    snprintf(buf,sizeof(buf),"| DNS     : %-30s|",
      WiFi.dnsIP().toString().c_str()); printBoth(buf);
    snprintf(buf,sizeof(buf),"| WS      : %-4s  RTT:%4ums  Backoff:%2us  |",
      wsConnected?"UP":"DOWN", pongLatencyMs, wsRetryDelay/1000); printBoth(buf);
    snprintf(buf,sizeof(buf),"| Heap    : %6uB free  (min %6uB)    |",
      ESP.getFreeHeap(), ESP.getMinFreeHeap()); printBoth(buf);
    snprintf(buf,sizeof(buf),"| CPU     : %3u MHz                          |",
      getCpuFrequencyMhz()); printBoth(buf);
    snprintf(buf,sizeof(buf),"| Uptime  : %-30s|",
      formatUptime(sec).c_str()); printBoth(buf);
    snprintf(buf,sizeof(buf),"| Boot    : %-5u  Reset: %-18s|",
      bootCount, getResetReason().c_str()); printBoth(buf);
    snprintf(buf,sizeof(buf),"| Telnet  : %-30s|",
      telnetActive ? "Client connected" : "No client"); printBoth(buf);
    printBoth("+------------------------------------------+");
    for (uint8_t i = 0; i < RELAY_COUNT; i++) {
      snprintf(buf,sizeof(buf),"| Relay %-2u : %-3s                              |",
        i+1, relays[i]?"ON":"OFF"); printBoth(buf);
    }
    printBoth("+------------------------------------------+");
    return;
  }

  if (cmd == "HEALTH") {
    sendHealthReport();
    return;
  }
  if (cmd == "RECONNECT") {
    wsConnected = false; wsRetryDelay = WS_RETRY_MIN; lastWsAttempt = 0;
    LOGI("CMD", "WS reconnect forced — backoff reset");
    return;
  }
  if (cmd == "PORTAL") {
    setupWiFiManager(true);
    return;
  }
  if (cmd == "CLEAR_WIFI") {
    LOGW("CMD", "Wiping WiFi credentials — restarting in 1 s...");
    WiFiManager wm; wm.resetSettings();
    delay(1000); ESP.restart();
    return;
  }
  if (cmd == "OTA_INFO") {
    char buf[80];
    snprintf(buf, sizeof(buf), "%s.local  %s  port=3232  pass=%s",
      DEVICE_NAME, WiFi.localIP().toString().c_str(), OTA_PASSWORD);
    LOGI("OTA", buf);
    return;
  }
  if (cmd == "RESTART") {
    LOGI("CMD", "Rebooting...");
    delay(300); ESP.restart();
    return;
  }
  if (cmd == "ALL_ON")  { setAllRelays(true);  return; }
  if (cmd == "ALL_OFF") { setAllRelays(false); return; }
  if (cmd == "RESET_BOOT") {
    prefs.begin("ha", false);
    prefs.putUInt("boot", 0);
    prefs.end();
    bootCount = 0;
    LOGI("CMD", "Boot counter zeroed");
    return;
  }

  // Rn=0/1  (e.g. R2=1)
  if (cmd.length() == 4 && cmd[0] == 'R' && cmd[2] == '=') {
    uint8_t idx = (uint8_t)(cmd[1] - '1');
    if (idx < RELAY_COUNT) setRelay(idx, cmd[3] == '1');
    else {
      char buf[40]; snprintf(buf, sizeof(buf), "Relay index must be 1-%u", RELAY_COUNT);
      LOGW("CMD", buf);
    }
    return;
  }

  // Tn  (e.g. T3)
  if (cmd.length() == 2 && cmd[0] == 'T') {
    uint8_t idx = (uint8_t)(cmd[1] - '1');
    if (idx < RELAY_COUNT) toggleRelay(idx);
    else {
      char buf[40]; snprintf(buf, sizeof(buf), "Relay index must be 1-%u", RELAY_COUNT);
      LOGW("CMD", buf);
    }
    return;
  }

  printBoth("Unknown command. Available:");
  printBoth("  STATUS    HEALTH    RECONNECT  PORTAL");
  printBoth("  CLEAR_WIFI  OTA_INFO  RESTART  RESET_BOOT");
  printBoth("  ALL_ON  ALL_OFF  Rn=0/1 (e.g. R2=1)  Tn (e.g. T3)");
}

// ═════════════════════════════════════════════════════════════════
//  SETUP
// ═════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(400);

  Serial.printf("\n+==========================================+\n");
  Serial.printf("|   ESP32 Home Automation  v%-5s          |\n", FW_VERSION);
  Serial.printf("+==========================================+\n\n");

  setupPrefs();

  // Boot info (printed once, not repeated)
  {
    char buf[80];
    snprintf(buf, sizeof(buf), "Boot #%u  Reset=%s  Heap=%uB  CPU=%uMHz",
      bootCount, getResetReason().c_str(), ESP.getFreeHeap(), getCpuFrequencyMhz());
    LOGI("BOOT", buf);
  }

  // GPIO
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);  // active LOW → OFF
  for (uint8_t i = 0; i < RELAY_COUNT; i++) {
    pinMode(RELAY_PINS[i], OUTPUT);
    digitalWrite(RELAY_PINS[i], LOW);
  }
  LOGI("GPIO", "Pins initialised (LED + 4 relays)");

  // WiFi
  setupWiFiManager(false);
  setupWiFiEvents();

  // Network services (only when connected)
  if (WiFi.isConnected()) {
    setupOTA();
    setupMDNS();
    setupTelnet();
  } else {
    LOGW("BOOT", "No WiFi — OTA, mDNS, Telnet skipped");
  }

  // WebSocket
  // [FIX1] ws.setReconnectInterval() intentionally NOT called here.
  //         The library's built-in auto-reconnect duplicates the manual
  //         backoff below and causes rapid double-connect storms → freeze.
  ws.onEvent(onWsEvent);
  ws.enableHeartbeat(15000, 3000, 2);   // library-level ping/pong keepalive
  connectWebSocket();

  uint32_t now = millis();
  lastWsAttempt = lastWifiCheck = lastNudge = now;

  LOGI("BOOT", "READY — type STATUS for diagnostics");
}

// ═════════════════════════════════════════════════════════════════
//  LOOP
// ═════════════════════════════════════════════════════════════════
void loop() {
  uint32_t now = millis();

  // ① OTA
  ArduinoOTA.handle();

  // ② Telnet accept + non-blocking read  [FIX2]
  handleTelnet();

  // ③ WiFi monitor
  if (now - lastWifiCheck >= WIFI_CHECK_MS) {
    lastWifiCheck = now;
    checkWiFiStatus();
  }

  // ④ WS reconnect with exponential backoff  [FIX1 — no duplicate reconnect]
  handleWebSocketReconnect();

  // ⑤ WS poll
  ws.loop();

  // ⑥ LED blink/solid
  updateLED(now);

  // ⑦ [FIX2] Non-blocking USB Serial read (was readStringUntil — blocked 1 s)
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      if (serialBuf.length() > 0 && serialBuf[serialBuf.length()-1] == '\r')
        serialBuf.remove(serialBuf.length()-1);
      serialBuf.trim();
      serialBuf.toUpperCase();
      if (serialBuf.length() > 0) processSerial(serialBuf);
      serialBuf = "";
    } else {
      if (serialBuf.length() < 64) serialBuf += c;
    }
  }

  // ⑧ Low-heap safety guard  [FIX3]
  //    If heap drops below threshold, log and restart cleanly.
  if (ESP.getFreeHeap() < HEAP_MIN_BYTES) {
    char buf[56];
    snprintf(buf, sizeof(buf), "Low heap (%uB) — restarting", ESP.getFreeHeap());
    LOGE("SYS", buf);
    delay(500);
    ESP.restart();
  }
}
