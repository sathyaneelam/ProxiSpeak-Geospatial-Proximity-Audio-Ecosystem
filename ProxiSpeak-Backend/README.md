# ProxiSpeak – Backend Engineering & API Documentation

> Geospatial Proximity Audio Ecosystem — Node.js, Express, Socket.IO, MongoDB, and WebRTC Signaling

---

## 1. Overview
The ProxiSpeak backend is the core real-time communication and data engine for the ProxiSpeak ecosystem. It manages virtual office rooms, tracks avatar positions in pixel coordinates, calculates proximity thresholds in memory, gates WebRTC audio signaling to eligible nearby peers, and persists state to MongoDB.

---

## 2. Architecture & Design Principles

```
  [ Frontend Client A ]           [ Frontend Client B ]
          │                                 │
          │ Socket.io (WebSocket)           │ Socket.io (WebSocket)
          ▼                                 ▼
┌────────────────────────────────────────────────────────┐
│                   ProxiSpeak Backend                   │
│                                                        │
│  ┌────────────────────┐      ┌──────────────────────┐  │
│  │   OfficeManager    │◄────►│   ProximityService   │  │
│  │ (In-Memory Presence│      │  (2D Euclidean Math) │  │
│  └─────────┬──────────┘      └──────────────────────┘  │
│            │                                           │
│            ▼                                           │
│  ┌────────────────────┐                                │
│  │ PositionSyncService│                                │
│  │(Debounced DB Sync) │                                │
│  └─────────┬──────────┘                                │
└────────────┼───────────────────────────────────────────┘
             ▼
      [ MongoDB Atlas ]
```

* **In-Memory Spatial Indexing**: Avatar movement updates occur at high frequencies (10–60Hz). Querying MongoDB on every frame would introduce latency bottlenecks. The backend tracks active avatars in memory (`OfficeManager`), enabling $O(N)$ proximity detection.
* **Proximity-Gated Signaling**: WebRTC offers, answers, and ICE candidates are only routed if participants are within the configurable **100px earshot radius** in the same virtual office.
* **Debounced Persistence**: Positions are buffered and flushed to MongoDB every 2 seconds (`PositionSyncService`) and immediately upon client disconnection.
* **Separation of Concerns**: Audio streams flow directly peer-to-peer via browser WebRTC; the backend coordinates signaling only.

---

## 3. REST API Reference

All REST endpoints accept and return `application/json`.

| Method | Endpoint | Description | Request Body | Status Codes |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/` | API status and metadata | None | `200` |
| `GET` | `/health` | Server health check | None | `200` |
| `POST` | `/api/users` | Register user session | `{ "displayName": "Alice" }` | `201`, `400` |
| `GET` | `/api/users/:id` | Retrieve user by ID | None | `200`, `400`, `404` |
| `POST` | `/api/offices` | Create virtual office | `{ "name": "Main Office", "width": 1000, "height": 700 }` | `201`, `400` |
| `GET` | `/api/offices` | List all offices | None | `200` |
| `GET` | `/api/offices/:id` | Retrieve office by ID | None | `200`, `400`, `404` |
| `POST` | `/api/positions` | Save avatar position | `{ "userId": "<id>", "x": 150, "y": 200 }` | `200`, `400`, `404` |
| `GET` | `/api/positions/:userId` | Get position by user ID | None | `200`, `400`, `404` |

---

## 4. Socket.IO Event Contracts

### Office Management
* **`office:join`** (Client $\rightarrow$ Server):
  Payload: `{ "officeId": string, "userId": string, "displayName": string, "x": number, "y": number }`
* **`office:joined`** (Server $\rightarrow$ Client):
  Payload: `{ "status": "success", "officeId": string, "peers": Array<Peer> }`
* **`user:joined`** (Server $\rightarrow$ Office Peers):
  Payload: `{ "socketId": string, "userId": string, "displayName": string, "x": number, "y": number }`
* **`user:left`** (Server $\rightarrow$ Office Peers):
  Payload: `{ "socketId": string, "userId": string }`

### Avatar Movement & Proximity
* **`avatar:move`** (Client $\rightarrow$ Server):
  Payload: `{ "x": number, "y": number }`
* **`avatar:moved`** (Server $\rightarrow$ Office Peers):
  Payload: `{ "socketId": string, "userId": string, "x": number, "y": number }`
* **`proximity:enter`** (Server $\rightarrow$ Peer Pairs):
  Triggered when distance $\le 100$px.
  Payload: `{ "peerSocketId": string, "peerUserId": string, "distance": number, "earshotRadius": 100 }`
* **`proximity:leave`** (Server $\rightarrow$ Peer Pairs):
  Triggered when distance $> 100$px or client disconnects.
  Payload: `{ "peerSocketId": string, "peerUserId": string, "distance": number, "reason": string }`

### WebRTC Signaling (Eligible Nearby Peers Only)
* **`webrtc:offer`** (Bidirectional):
  Payload: `{ "to": string, "offer": object }` (Forwarded with `from` and `fromUserId`).
* **`webrtc:answer`** (Bidirectional):
  Payload: `{ "to": string, "answer": object }` (Forwarded with `from` and `fromUserId`).
* **`webrtc:ice-candidate`** (Bidirectional):
  Payload: `{ "to": string, "candidate": object }` (Forwarded with `from` and `fromUserId`).
* **`webrtc:error`** (Server $\rightarrow$ Sender):
  Payload: `{ "status": "error", "code": "PEER_OUT_OF_RANGE", "message": string }`

---

## 5. Getting Started

### Prerequisites
* Node.js v18+ (tested on Node v26)
* MongoDB Atlas cluster or local MongoDB instance

### Installation
```bash
git clone https://github.com/sathyaneelam/ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem.git
cd ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem/ProxiSpeak-Backend
npm install
```

### Environment Configuration
Copy `.env.example` to `.env` and fill in credentials:
```env
PORT=3000
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.pnaevze.mongodb.net/ProxiSpeak?retryWrites=true&w=majority
EARSHOT_RADIUS=100
STALE_POSITION_TIMEOUT_MS=60000
POSITION_SYNC_INTERVAL_MS=2000
```

### Running the Server
```bash
# Start server
npm start

# Development mode with watch
npm run dev
```

### Running Automated Tests
```bash
# Run all 27 automated tests
node --test tests/proximityService.test.js tests/officeManager.test.js tests/socket.integration.test.js tests/api.integration.test.js
```
