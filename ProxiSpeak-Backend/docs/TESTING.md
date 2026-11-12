# ProxiSpeak – Backend Automated Test Suite Documentation

## 1. Test Harness Overview

The ProxiSpeak backend utilizes Node.js's native test runner (`node:test`) and assertion library (`node:assert`), eliminating the need for third-party test runners while providing deterministic, high-speed execution.

```bash
# Execute entire test suite
node --test tests/proximityService.test.js tests/officeManager.test.js tests/socket.integration.test.js tests/api.integration.test.js
```

---

## 2. Test Suite Breakdown

### Suite 1: Proximity Calculation Unit Tests (`proximityService.test.js`)
* **`calculateDistance`**: Verifies exact 2D Euclidean distance formulas for horizontal, vertical, and diagonal vectors (3-4-5 triangle).
* **Input Sanitization**: Verifies that non-finite, missing, or malformed coordinate inputs safely yield `Infinity`.
* **Earshot Boundaries**: Verifies boundary conditions at $d = 99$, $d = 100$, and $d = 101$.
* **State Transition Matrix**: Verifies detection of peers entering earshot, leaving earshot, and maintaining earshot.

### Suite 2: Office Presence Unit Tests (`officeManager.test.js`)
* **Room Joining**: Validates user registration into specified office rooms and initial presence delivery.
* **Proximity Set Updates**: Verifies bidirectional updates to peer proximity sets on join and movement.
* **Cross-Office Isolation**: Asserts that peers in different rooms never detect each other even at identical $(x, y)$ coordinates.
* **Signaling Eligibility**: Validates gating logic (`eligible: true` vs. `PEER_OUT_OF_RANGE` vs. `DIFFERENT_OFFICE`).
* **Disconnect Cleanup**: Ensures removal of leaving peers from all nearby peers' proximity sets.
* **Stale Peer Detection**: Identifies inactive peers based on the configurable `STALE_POSITION_TIMEOUT_MS`.

### Suite 3: Socket.io Integration Tests (`socket.integration.test.js`)
* **Real WebSocket Handshakes**: Spawns ephemeral HTTP/Socket.io servers and connects real `socket.io-client` instances.
* **Office Scoping**: Verifies `avatar:moved` broadcasts are scoped strictly to the sender's room.
* **Transition Emissions**: Verifies `proximity:enter` and `proximity:leave` events emitted to peer pairs during real movement.
* **WebRTC Signaling Pipeline**:
  * Forwards `webrtc:offer`, `webrtc:answer`, and `webrtc:ice-candidate` when peers are $\le 100$px apart.
  * Rejects signaling with `webrtc:error` when peers are $> 100$px apart.
  * Rejects signaling with `webrtc:error` when peers are in different offices.
* **Disconnect Lifecycles**: Verifies `user:left` and `proximity:leave` dispatches on socket disconnect.
* **Malformed Payloads**: Verifies error responses when invalid coordinate payloads are transmitted.

### Suite 4: REST API Integration Tests (`api.integration.test.js`)
* **Health Check**: Validates `GET /health` (`200 OK`).
* **Root Route**: Validates `GET /` (`200 OK`).
* **Input Validation**: Verifies `400 Bad Request` on missing `displayName`, `name`, or `userId`.
* **Content-Type Enforcement**: Verifies `415 Unsupported Media Type` when non-JSON bodies are POSTed.
* **404 Routing**: Verifies standard 404 handler on undefined routes.

---

## 3. Test Execution Verification

```text
✔ REST API Integration Tests (7 passed)
✔ OfficeManager - In-Memory State & Signaling Eligibility (6 passed)
✔ ProximityService - 2D Pixel Calculations (6 passed)
✔ Socket.io Proximity & WebRTC Signaling Integration Tests (8 passed)

Summary: 27 Tests Passed | 0 Failed | Total Duration: 1.58s
```
