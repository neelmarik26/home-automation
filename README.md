ssh command : ssh -i "./ssh-key-2026-06-27.key" ubuntu@80.225.216.53

next plans:-
Dynamic switch 
Https
Url not ip

MQTT configuration:

- `MQTT_URL` (default `mqtt://localhost:1883`)
- `MQTT_USERNAME` and `MQTT_PASSWORD` when the broker requires authentication

## ESP online/offline status (MQTT LWT)

Each ESP sketch connects with an MQTT Last Will and Testament (LWT) on its
`home/<userId>` topic. On an unexpected disconnect, the broker publishes this
retained payload:

```json
{"type":"status","status":"OFFLINE","deviceId":"<device-id>"}
```

After reconnecting, the ESP sends a non-retained `register` message and then a
retained `ONLINE` status, replacing the old LWT. The website polls
`/user/device-status` every 10 seconds, so its indicator changes after the
backend receives either event. On a server restart, the backend silently
restores retained `status` messages, while still ignoring retained register or
command messages. Device offline state is driven by the broker LWT, so a
heartbeat is not required.
The broker publishes an LWT only after its MQTT keep-alive timeout; an orderly
restart can optionally publish the same OFFLINE status before disconnecting.

Each ESP and the server use the shared topic `home/<userId>`. ESP messages include
`deviceId`, so any number of ESP32/ESP8266 devices can be associated with one user.
https://chatgpt.com/share/6a81a913-c534-83e8-9819-5fcdf16d1924


mosquitto_sub -h 80.225.216.53 -p 1883 -u anupam_neel -P "AN@2023" -t test/topic -v
