# ProxiSpeak – Geospatial Proximity Engine Architecture

## 1. 2D Euclidean Distance Calculations

ProxiSpeak virtual offices operate in a 2D Cartesian pixel plane where:
* `(0, 0)` represents the top-left corner of the virtual canvas.
* `width` and `height` denote the office bounds (e.g., 1000px × 700px).

Distance between Avatar $A (x_1, y_1)$ and Avatar $B (x_2, y_2)$ is calculated via the Euclidean metric:

$$d(A, B) = \sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}$$

### Earshot Evaluation
* Target earshot radius $R$ is configurable (default: $100$px via `EARSHOT_RADIUS`).
* If $d(A, B) \le R$: Peers are considered within audible earshot.
* If $d(A, B) > R$: Peers are out of range and audio streams must be torn down.

---

## 2. Proximity State Machine & Transition Detection

On every avatar movement, the server tracks transitions relative to each peer in the room:

```
          Movement Event
                 │
                 ▼
        Is d(A, B) <= R?
        ┌────────┴────────┐
     YES│                 │NO
        ▼                 ▼
   Was in Range?     Was in Range?
   ┌────┴────┐       ┌────┴────┐
 NO│      YES│    YES│       NO│
   ▼         ▼       ▼         ▼
[ENTER] [MAINTAIN] [LEAVE]  [IGNORE]
```

* **`[ENTER]`**: Triggers `proximity:enter` event to both avatars, instructing the frontend WebRTC client to initiate connection negotiation.
* **`[LEAVE]`**: Triggers `proximity:leave` event to both avatars, instructing the frontend to close the peer connection.
* **`[MAINTAIN]`**: Audio connection remains active; coordinates update silently.

---

## 3. High-Performance In-Memory Presence (`OfficeManager`)

Directly writing avatar positions to MongoDB on every frame (30–60Hz per client) would exhaust database connection pools. 

### In-Memory State Design
* Maintained using JavaScript `Map` structures:
  * `offices`: `Map<officeId, Map<socketId, PeerState>>`
  * `socketToOffice`: `Map<socketId, officeId>`
* Search and update operations within an office room of $N$ users are $O(N)$, executing in under $0.5$ms.
* Bidirectional sets track active proximity relationships (`peer.proximityPeers: Set<socketId>`).

---

## 4. Debounced Database Synchronization (`PositionSyncService`)

To balance real-time responsiveness with persistent audit trails:
1. Movement coordinates update instantly in `OfficeManager`.
2. `PositionSyncService` buffers the latest position per `userId`.
3. Every 2 seconds (`POSITION_SYNC_INTERVAL_MS`), pending updates are batch-persisted to MongoDB `Position` collection.
4. On socket disconnect, the final position is persisted immediately and `User.socketId` is reset to `null`.
