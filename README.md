ssh command : ssh -i "./ssh-key-2026-06-27.key" ubuntu@80.225.216.53

next plans:-
Dynamic switch 
Https
Url not ip

MQTT configuration:

- `MQTT_URL` (default `mqtt://localhost:1883`)
- `MQTT_USERNAME` and `MQTT_PASSWORD` when the broker requires authentication

Each ESP and the server use the shared topic `home/<userId>`. ESP messages include
`deviceId`, so any number of ESP32/ESP8266 devices can be associated with one user.
https://chatgpt.com/share/6a81a913-c534-83e8-9819-5fcdf16d1924
