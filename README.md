# El Ghayeb — backend

Classroom attendance and behavior tracking. A **Raspberry Pi Zero** camera in
each room, an **Express** backend, and a **Python AI service** that runs the
team's face model from [`../vision_model`](../vision_model).

```
 Pi Zero (camera, servo, LEDs)          Express backend (Node 20)                          Web platform (React)
 ───────────────────────────            ─────────────────────────────────────────          ────────────────────
  WebSocket /ws/device  ◄──────────►  device.gateway → PiZeroDriver ─┐                     REST /api/*  (JWT)
     orders ⇄ JPEG                                                    DriverManager         Socket.IO  live events
                                       routes → services ─────────────┘   │
                                            │  attendance / behavior       │ capture()
                                            ▼                              │
                                       BullMQ + Redis (jobs carry images in memory, deleted after)
                                            │
                                       workers ──HTTP──► ai-service (FastAPI)
                                            │                ├─ model 1: vision_model (InsightFace SCRFD + ArcFace, Hungarian)
                                            ▼                └─ model 2: YOLOv8n-pose + YOLOv8n "cell phone" (optional)
                                       PostgreSQL (Prisma): sessions, attendance, embeddings, behavior_stats
```

## Flow of a roll call ("Lancer l'appel")

1. `POST /api/sessions/:id/attendance` → `202 { runId }`.
2. `DriverManager` finds the room's Pi and sends `{"cmd":"capture","mode":"attendance","shots":3,"pan":[-40,0,40]}`.
3. The Pi runs the LED countdown, takes the 3 photos (G · C · D) and streams the JPEGs back.
4. One BullMQ job carries the 3 images.
5. The worker sends them, with the group's embeddings, to `ai-service /attendance/recognize`.
6. The matcher works per photo (Hungarian), then merges by student, so a student seen on 2 overlapping photos counts once. Statuses: `PRESENT` (≥ 0.45, clear margin), `REVIEW` (0.35–0.45 or ambiguous), `ABSENT`.
7. Rows are written to `attendance`. A teacher's `MANUAL` correction is never overwritten, and a re-run only upgrades a status (ABSENT → REVIEW → PRESENT).
8. Socket.IO emits `attendance:progress` (capturing → queued → processing), then `attendance:done`.

**Behavior tracking.** `POST /api/sessions/:id/behavior/start` takes one photo every 10 s, sends each one through model 2, and stores only class-level percentages per minute in `behavior_stats`. Each frame triggers `behavior:update`. The loop stops automatically when the session ends.

## Layout

```
src/
  server.js                 HTTP + device WS + Socket.IO + workers
  app.js                    Express app
  config/env.js             zod-validated env
  drivers/
    camera.driver.js        abstract CameraDriver + DeviceError
    pi-zero.driver.js       Pi Zero WebSocket protocol (frames, timeouts, serialised captures)
  services/
    driver-manager.service.js  connected cameras, room → camera, heartbeats, online/offline
    attendance.service.js   trigger, list, corrections
    behavior.service.js     10 s loop + per-minute aggregation
    student.service.js      face enrollment (photos → embeddings, photos discarded)
    device.service.js       device CRUD, tokens
    session.service.js
  gateways/
    device.gateway.js       /ws/device (token auth → PiZeroDriver)
    teacher.gateway.js      Socket.IO (JWT) → session rooms
  jobs/                     queue.js, attendance.worker.js, behavior.worker.js, notifier.js, worker.js
  ai/ai.client.js           HTTP client to ai-service
  routes/  middlewares/  lib/
prisma/schema.prisma, seed.js
ai-service/                 FastAPI wrapper around ../vision_model (+ YOLO behavior)
scripts/device-simulator.js fake Pi Zero (sends ../vision_model/data/classroom/*.jpg)
scripts/demo-call.js        fake teacher client: login → call → live result
docs/device-protocol.md     what the Pi must implement
```

## Run locally

Prerequisites: Node ≥ 20, Python 3.12, Docker.

```bash
# 1. Infra
docker compose up -d postgres redis      # set POSTGRES_PORT=5433 if 5432 is taken
cp .env.example .env                     # edit DATABASE_URL port and JWT_SECRET

# 2. AI service (first start downloads buffalo_l, ~280 MB)
cd ai-service && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn elghayeb_ai.main:app --port 8000      # VISION_MODEL_DIR defaults to ../../vision_model
cd ..

# 3. Backend
npm install
npx prisma migrate dev
npm run db:seed -- --with-faces          # admin, teacher, room S12, device token, ST001–ST003 enrolled
npm run dev

# 4. Camera (real Pi, or the simulator)
DEVICE_TOKEN=<token printed by the seed> npm run simulate:device

# 5. Try a roll call
node scripts/demo-call.js
```

**Full stack in Docker:** `docker compose up -d --build`. The `ai` container mounts `../vision_model` read-only.

**Tests:** `npm test` (driver, manager, behavior aggregation) and `cd ai-service && .venv/bin/python -m unittest discover -s tests` (matcher).

### Enabling model 2 (behavior)

Export the two YOLO models to ONNX and drop them into `ai-service/models/`:

```bash
pip install ultralytics
yolo export model=yolov8n-pose.pt format=onnx
yolo export model=yolov8n.pt format=onnx
```

Then restart the AI service. `GET /api/health` shows `ai.behavior: true` once they load; until then, `behavior/start` returns 503.

## REST API

All routes except login require `Authorization: Bearer <jwt>`. Admin-only routes are marked 🔒.

| Method | Path | |
|---|---|---|
| POST | `/api/auth/login` | `{email,password}` → `{token,user}` |
| GET | `/api/auth/me` | |
| GET | `/api/sessions?date=today\|YYYY-MM-DD` | the teacher's sessions (admin: all), with camera status |
| GET | `/api/sessions/:id` | |
| POST/PATCH/DELETE | `/api/sessions[/:id]` 🔒 | |
| **POST** | **`/api/sessions/:id/attendance`** | **trigger** → `202 {runId}`. `409` if the camera is offline or a call is already running |
| GET | `/api/sessions/:id/attendance` | `{summary, lastRun, rows:[{student, attendance}]}` |
| PUT | `/api/sessions/:id/attendance/:studentId` | manual mark `{status}` |
| GET | `/api/sessions/:id/runs` | call history |
| POST | `/api/sessions/:id/behavior/start` \| `stop` | |
| GET | `/api/sessions/:id/behavior` | per-minute series |
| PATCH | `/api/attendance/:id` | correction `{status: PRESENT\|ABSENT\|REVIEW}` → `source: MANUAL` |
| CRUD | `/api/students` (🔒 writes), `?groupId=&q=` | |
| POST | `/api/students/:id/faces` 🔒 | multipart `photos` (≤ 5), `?replace=true`. Each photo must contain exactly one face |
| GET/DELETE | `/api/students/:id/faces` | metadata only, never the vectors |
| CRUD | `/api/groups`, `/api/rooms` (🔒 writes) | |
| CRUD | `/api/devices` 🔒 | `POST` returns the token **once** |
| POST | `/api/devices/:id/token` 🔒 | rotate the token (disconnects the Pi) |
| POST | `/api/devices/:id/test-capture?pan=0` 🔒 | one JPEG straight back, for aiming the camera |
| CRUD | `/api/teachers` 🔒 | |
| GET | `/api/health` | db, redis, ai, devices online |

## Socket.IO

Connect with `io(URL, { auth: { token: jwt } })`, then call
`socket.emitWithAck('session:join', sessionId)`.

| Event | Payload |
|---|---|
| `attendance:progress` | `{sessionId, runId, stage: capturing\|queued\|processing}` |
| `attendance:done` | `{sessionId, runId, summary:{present,absent,review}, facesFound, unknownFaces, notEnrolled}` |
| `attendance:error` | `{sessionId, runId, error, code?}` |
| `attendance:updated` | `{sessionId, record}` (manual correction) |
| `behavior:update` | `{sessionId, minute, frame, stats}` |
| `behavior:status` | `{sessionId, active, reason?, warning?}` |
| `device:status` | `{deviceId, roomId, online, info?, reason?}` (sent to every logged-in user) |

## Notes

- **Privacy.** Images are never written to disk or the DB. They exist only in memory and in the Redis job, and jobs are deleted when they finish. The DB stores only embeddings and results; the API never returns the vectors.
- **Enrollment.** Like `vision_model`, a face is compared with each reference photo and the best score is kept. The spec suggests 5 photos per student; the test data has only 1.
- **Students without photos** are marked `REVIEW`, not `ABSENT`, because the model cannot see them.
- **Speed.** On this dev machine (CPU, detection size 1280 from `vision_model/app/config.py`), a 3-photo call took about 60 s end to end.
- **Head down > 30 s.** Individuals aren't tracked, so this is a class-level lower bound: the smallest head-down share over the last 30 s of frames.
- **Thresholds to calibrate** on real Pi photos: `PRESENT_THRESHOLD`, `REVIEW_THRESHOLD`, `AMBIGUITY_MARGIN` (ai-service env), and the posture constants in `ai-service/elghayeb_ai/behavior/rules.py`.
