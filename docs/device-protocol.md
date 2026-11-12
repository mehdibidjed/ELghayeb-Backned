# Raspberry Pi Zero ↔ backend protocol

The camera node keeps **one WebSocket** open to the backend. The backend sends
orders; the Pi answers with JSON messages and binary JPEG frames.
`scripts/device-simulator.js` is a complete reference implementation (~100 lines).

## Connection

```
ws://<server>:3000/ws/device?token=<DEVICE_TOKEN>
```

The token can also go in an `Authorization: Bearer <token>` or `X-Device-Token`
header. It is created by `POST /api/devices` (or `npm run db:seed`) and shown
**once**. Only its SHA-256 hash is stored.

| HTTP answer to the upgrade | Meaning |
|---|---|
| `101` | connected |
| `401` | missing or unknown token |
| `403` | device disabled by an admin |

After connecting, the server sends:

```json
{ "type": "welcome", "deviceId": 1, "roomId": 1, "serverTime": 1794432716705 }
```

The server closes the socket with code **4000** when the token is rotated, the
device is disabled or deleted, or the same device connects a second time. The
Pi should reconnect with backoff (1 s → 30 s). After a token rotation it gets a
`401` until it is given the new token.

## Device → server

| Message | When |
|---|---|
| `{"type":"hello","firmware":"1.0.0","camera":"Pi Camera v3","resolution":"4608x2592","hostname":"pi-s12","servo":true}` | once, right after connecting (all fields optional) |
| `{"type":"ping","rssi":-58,"cpuTemp":51.3,"uptime":3600,"freeMem":123456}` | every **30 s**; the server answers `{"type":"pong"}` |
| `{"type":"frame","requestId":"…","seq":0,"position":-40}` then **one binary message = the JPEG** | for each shot |
| `{"type":"capture_done","requestId":"…"}` | after the last frame (optional if all `shots` frames were sent) |
| `{"type":"error","requestId":"…","message":"camera busy"}` | the capture failed |

If no message arrives for `DEVICE_HEARTBEAT_TIMEOUT_MS` (75 s by default), the
device is considered offline and disconnected. The server also sends
WebSocket-level pings; most clients answer them automatically.

## Server → device

### `capture`

```json
{ "cmd": "capture", "requestId": "3f0c…", "mode": "attendance", "shots": 3, "pan": [-40, 0, 40], "countdown": 3 }
```

| Field | Meaning |
|---|---|
| `mode` | `attendance` (roll call), `behavior` (1 shot every 10 s), `test` (admin aiming the camera) |
| `shots` | number of JPEGs to send |
| `pan` | servo angle for each shot (G · C · D), or `null` → don't move. A fixed camera ignores it. |
| `countdown` | seconds of LED countdown (3·2·1) before the first shot; `0` = shoot now |

Expected behavior on the Pi:

1. Run the LED countdown (if any).
2. For each shot `seq = 0..shots-1`: move the servo to `pan[seq]`, let it settle, capture, then send the `frame` header followed by the JPEG as a binary message.
3. Send `capture_done`.
4. Return the servo to the centre.

### Rules and limits

- **One capture at a time.** The backend serialises orders per device, so the Pi never receives a second `capture` while one is running.
- **Time limit.** A capture must finish within `DEVICE_CAPTURE_TIMEOUT_MS` (30 s) plus `countdown`. Frames that arrive later are ignored.
- **Frame format.** Frames must be JPEG (they start with `FF D8 FF`) and at most `DEVICE_MAX_FRAME_BYTES` (8 MB).
- **Resolution.** A face must be about 30–40 px wide to be recognised. At the back of an 8 m room, use full resolution: 4608×2592 on Camera Module 3, quality about 85.
- **No storage.** Never write the images to the SD card.

## Minimal Pi Zero client (Python, picamera2)

```python
import asyncio, io, json, websockets
from picamera2 import Picamera2

URL = "ws://SERVER:3000/ws/device?token=dev_xxx"
cam = Picamera2(); cam.configure(cam.create_still_configuration()); cam.start()

def shoot() -> bytes:
    buf = io.BytesIO(); cam.capture_file(buf, format="jpeg"); return buf.getvalue()

async def main():
    async for ws in websockets.connect(URL, max_size=None):  # reconnects automatically
        try:
            await ws.send(json.dumps({"type": "hello", "camera": "Pi Camera v3"}))
            async def pinger():
                while True:
                    await ws.send(json.dumps({"type": "ping"})); await asyncio.sleep(30)
            asyncio.create_task(pinger())
            async for raw in ws:
                msg = json.loads(raw)
                if msg.get("cmd") != "capture": continue
                await asyncio.sleep(msg.get("countdown", 0))          # LED countdown here
                for seq in range(msg["shots"]):
                    pos = (msg.get("pan") or [None] * msg["shots"])[seq]
                    # move_servo(pos)
                    jpeg = await asyncio.to_thread(shoot)
                    await ws.send(json.dumps({"type": "frame", "requestId": msg["requestId"], "seq": seq, "position": pos}))
                    await ws.send(jpeg)
                await ws.send(json.dumps({"type": "capture_done", "requestId": msg["requestId"]}))
        except websockets.ConnectionClosed:
            continue

asyncio.run(main())
```
