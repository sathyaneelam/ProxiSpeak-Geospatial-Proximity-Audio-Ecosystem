# ProxiSpeak Database Architecture & Backend Service Contract

## 1. Planar Representation vs Spherical GeoJSON Decision

### The Virtual Office Coordinate System
ProxiSpeak operates within a flat, 2D Cartesian virtual office canvas (default dimensions: **1000px × 600px**). Avatar positions are expressed as standard planar coordinates $[x, y]$ in pixels. Proximity-based audio interaction triggers within a configurable **100-pixel radius** ($R = 100\text{px}$).

### Why Spherical GeoJSON (`2dsphere`) is Inappropriate:
1. **Coordinate Domain Violations:**
   MongoDB's `2dsphere` index strictly adheres to WGS84 ellipsoidal geometry on Earth. It requires coordinate pairs to represent `[longitude, latitude]` where $-180 \le \text{longitude} \le 180$ and $-90 \le \text{latitude} \le 90$. Virtual canvas pixels (e.g. $[500, 300]$) exceed these geographic limits, causing document insertion to fail with out-of-bounds latitude/longitude errors.
2. **Great-Circle Distortion:**
   Spherical distance calculates radians or meters along a curved planetary surface (Haversine formula). This distorts distance across a 2D computer screen where distance must be strictly Euclidean/Pythagorean:
   $$d = \sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}$$

### Architectural Choice: MongoDB Planar `2d` Index
ProxiSpeak adopts MongoDB's native **Planar `2d` Index**:
- **Field format:** Standard array of two numbers `[x, y]`.
- **Index specification:** Compound index `{ officeId: 1, location: '2d' }`.
- **Query mechanism:** `$geoWithin` with `$center: [[x, y], radiusInPixels]` and `$near: [x, y], $maxDistance: radiusInPixels`.
- **Partitioning:** The compound index partitions spatial data by `officeId`. Users in different offices never match each other's spatial lookups, preventing cross-room audio bleeding.

---

## 2. Database Schemas

### 2.1 User Schema (`src/models/User.js`)
Stores authenticated user profile, presence status, and avatar metadata.
- `displayName` (String, required, trim)
- `email` (String, required, unique, lowercase, trim)
- `avatarColor` (String, default: `#3b82f6`, trim)
- `avatarUrl` (String, default: `''`, trim)
- `currentOfficeId` (ObjectId, ref: `'Office'`, default: `null`)
- `isOnline` (Boolean, default: `false`)
- `lastActive` (Date, default: `Date.now`)
- Timestamps: `createdAt`, `updatedAt`

### 2.2 Office Schema (`src/models/Office.js`)
Defines the virtual office room, boundaries, audio threshold, zones, and obstacles.
- `name` (String, required, trim) - e.g. "ProxiSpeak Headquarters"
- `code` (String, required, unique, lowercase, indexed) - e.g. `"office-01"`
- `dimensions`:
  - `width` (Number, default: `1000`, min: `100`)
  - `height` (Number, default: `600`, min: `100`)
- `proximityRadius` (Number, default: `100`, min: `10`, max: `2000`) - Audio cutoff distance in pixels
- `zones`: Array of `zoneSchema` subdocuments:
  - `name`, `title`, `subtitle`, `x`, `y`, `w`, `h`, `fill`, `stroke`
- `obstacles`: Array of `obstacleSchema` subdocuments:
  - `type` (`desk` | `table` | `sofa` | `coffee` | `counter` | `wall` | `custom`)
  - `x`, `y`, `w`, `h`, `label`, `isCollidable`
- `settings` (Map of String)
- Timestamps: `createdAt`, `updatedAt`

### 2.3 LivePosition Schema (`src/models/LivePosition.js`)
Tracks the real-time position of each active user in a 2D virtual office.
- `userId` (ObjectId, ref: `'User'`, required, unique) - 1:1 user live position mapping
- `officeId` (ObjectId, ref: `'Office'`, required, indexed) - Indexed for office-wide presence sync
- `location` ([Number], length 2: `[x, y]`, required, non-negative finite numbers: $x \ge 0, y \ge 0$)
- `socketId` (String, indexed) - Socket.io connection ID for fast disconnect cleanup
- `lastUpdated` (Date, default: `Date.now`)
- Indexes:
  - `{ officeId: 1, location: '2d' }` - Compound planar index for fast spatial circular queries
  - `{ userId: 1 }` (unique) - Enforces single active position per user and fast avatar lookups
  - `{ officeId: 1 }` - Fast B-tree index for `getOfficePositions` initial room synchronization
  - `{ socketId: 1 }` - Fast socket disconnect cleanup

> **Coordinate Validation Architecture:**
> - **Schema / Database Layer:** Enforces structural validity (2-element array, finite numbers, non-null/required) and planar non-negativity ($x \ge 0, y \ge 0$). Because $(0, 0)$ is the canvas origin, negative coordinates are structurally invalid in 2D screen space.
> - **Service / Signaling Layer:** Enforces office-specific dynamic canvas boundaries ($x \le \text{office.dimensions.width}$, $y \le \text{office.dimensions.height}$). Because offices support configurable dimensions (`dimensions.width` and `height` in `Office.js`), hardcoding canvas dimensions into the `LivePosition` schema would break multi-sized rooms and incur cross-collection query overhead on high-frequency avatar updates.

---

## 3. Position Operations & Proximity Queries

All database operations are encapsulated in `src/services/positionService.js`:

### 3.1 Position Upsert (`upsertPosition`)
Atomically updates or creates a user's location upon joining or periodic sync:
```javascript
const { upsertPosition } = require('./services/positionService');

const pos = await upsertPosition({
  userId: '660000000000000000000001',
  officeId: '660000000000000000000002',
  location: [500, 300],
  socketId: socket.id
});
```

### 3.2 High-Frequency Position Update (`updatePosition`)
Optimized for frequent avatar movements:
```javascript
await updatePosition(userId, [520, 310]);
```

### 3.3 Proximity Peer Query (`getNearbyUsers`)
Queries live positions in the same office within the configurable pixel radius (default 100px), computes exact Pythagorean pixel distances, and calculates normalized audio volume attenuation ($0.0$ to $1.0$):
```javascript
const nearbyPeers = await getNearbyUsers({
  officeId: currentOfficeId,
  location: [500, 300],
  radius: 100, // configurable radius in pixels
  excludeUserId: currentUserId
});
```

**Returned Data Shape:**
```json
[
  {
    "id": "660000000000000000000010",
    "userId": "660000000000000000000003",
    "socketId": "sock_abc123",
    "displayName": "Alex",
    "avatarColor": "#a78bfa",
    "avatarUrl": "",
    "isOnline": true,
    "location": [530, 340],
    "distance": 50.0,
    "volume": 0.5,
    "lastUpdated": "2026-10-13T12:00:00.000Z"
  }
]
```

### 3.4 Audio Volume Attenuation & Stereo Panning Formulas
ProxiSpeak adheres strictly to the unified team audio attenuation formula:
$$\begin{aligned}
t &= \text{clamp}\left(\frac{d}{100}, 0, 1\right) \\
\text{gain} &= 1 - (3t^2 - 2t^3) \\
\text{Pan} &= \text{clamp}\left(\frac{dx}{100}, -1, 1\right)
\end{aligned}$$

- **Smoothstep Hermite Gain Attenuation:**
  - $d = 0\text{px} \rightarrow \text{gain} = 1.0$ (100% volume at center)
  - $d = 25\text{px} \rightarrow \text{gain} \approx 0.8438$
  - $d = 50\text{px} \rightarrow \text{gain} = 0.50$ (50% volume at halfway)
  - $d = 75\text{px} \rightarrow \text{gain} \approx 0.1563$
  - $d \ge 100\text{px} \rightarrow \text{gain} = 0.0$ (silent cutoff at earshot radius boundary)
- **Stereo Panning:**
  - $dx = -100\text{px} \rightarrow \text{Pan} = -1.0$ (full left)
  - $dx = 0\text{px} \rightarrow \text{Pan} = 0.0$ (center)
  - $dx = +100\text{px} \rightarrow \text{Pan} = +1.0$ (full right)
  - Clamped strictly within $[-1.0, 1.0]$.

---

## 4. Backend Service Contracts & Socket.io Integration

For the backend developer (`saipranav-backend`):

### 4.1 On Client `join-office`
```javascript
const { officeService, positionService, userService } = require('./services');

socket.on('join-office', async ({ officeId = 'office-01', userEmail, userName }) => {
  // 1. Resolve or create office
  let office = await officeService.getOfficeByIdOrCode(officeId);
  if (!office) {
    office = await officeService.seedDefaultOffice();
  }

  // 2. Resolve user
  const user = await userService.findOrCreateUser({
    email: userEmail || `${socket.id}@anonymous.local`,
    displayName: userName || 'Anonymous'
  });

  // 3. Upsert initial position (center of room: [500, 300])
  await positionService.upsertPosition({
    userId: user._id,
    officeId: office._id,
    location: [500, 300],
    socketId: socket.id
  });

  // 4. Join socket room
  socket.join(office.code);

  // 5. Emit current office state to the newly joined client
  const allPositions = await positionService.getOfficePositions(office._id);
  socket.emit('office-state', {
    office: {
      id: office._id,
      code: office.code,
      dimensions: office.dimensions,
      proximityRadius: office.proximityRadius,
      zones: office.zones,
      obstacles: office.obstacles
    },
    players: allPositions
  });

  // 6. Broadcast user joined to other clients in room
  socket.to(office.code).emit('user-joined', {
    userId: user._id,
    socketId: socket.id,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
    location: [500, 300]
  });
});
```

### 4.2 On Client `move-avatar`
```javascript
socket.on('move-avatar', async ({ officeId, x, y, userId }) => {
  // 1. Update position in DB
  await positionService.updatePosition(userId, [x, y]);

  // 2. Query peers in 100-pixel proximity for WebRTC audio levels
  const nearbyPeers = await positionService.getNearbyUsers({
    officeId,
    location: [x, y],
    radius: 100,
    excludeUserId: userId
  });

  // 3. Emit proximity audio peers to the moving user
  socket.emit('proximity-peers', { peers: nearbyPeers });

  // 4. Broadcast updated position to others in office
  socket.to(officeCode).emit('avatar-moved', {
    userId,
    location: [x, y]
  });
});
```

### 4.3 On Client `disconnect`
```javascript
socket.on('disconnect', async () => {
  const removed = await positionService.removeBySocketId(socket.id);
  if (removed) {
    io.emit('user-left', { userId: removed.userId });
  }
});
```

---

## 5. Automated Test Suite

To run tests:
```bash
npm test
```
The test suite utilizes the Node.js native test runner (`node --test`) with automated tests across the core architecture:
- `tests/schemas/user.test.js`: User profile schema validation, default attributes, email normalization and constraints.
- `tests/schemas/office.test.js`: Office dimensions, 100px proximity radius, room zones, and furniture obstacle validation.
- `tests/schemas/livePosition.test.js`: Planar 2D pixel coordinate validation, non-negative bounds, `officeId` foreign key reference, unique `userId` constraint, single-field index `{ officeId: 1 }`, and compound planar index `{ officeId: 1, location: '2d' }`.
- `tests/schemas/seedData.test.js`: Benchmark seed dataset quality (60 users), room zone distributions, and safe idempotent upsert operations.
- `tests/spatial/planarProximity.test.js`: Flat Euclidean distance on Cartesian triangles, architectural proof of 2D planar over spherical GeoJSON (2dsphere), smoothstep Hermite audio volume attenuation, and stereo panning.
- `tests/services/positionService.test.js`: Coordinate validation, contract event shapes, obstacle layouts, proximity performance benchmarking, and MongoDB planar query discovery with office isolation.
- `tests/signaling/signalingServer.test.js`: Socket.IO WebRTC signaling relay, proximity event propagation, and earshot-based offer/answer filtering.

---

## 6. Testing and Validation

The database layer and spatial proximity subsystem have been thoroughly verified across the following criteria:

1. **Office Association & Multi-Tenant Partitioning:**
   - Every `LivePosition` document strictly belongs to a specific office room via a required `officeId` referencing the `Office` collection.
   - The single-field index `{ officeId: 1 }` enables rapid office-level avatar queries, while the compound index `{ officeId: 1, location: '2d' }` partitions spatial indexing per office.

2. **User Identity & 1:1 Mapping:**
   - `LivePosition` enforces a required, unique index on `userId` (`{ userId: 1 }`), ensuring an avatar can only maintain a single active live position at any moment across the virtual ecosystem.

3. **Planar Cartesian Coordinate Integrity:**
   - Positions are stored strictly as flat 2D pixel coordinate arrays `[x, y]`.
   - Schema and service validators guarantee finite numeric values and reject negative numbers, invalid array lengths, or non-numeric inputs. Canvas origin `[0, 0]` is verified valid.

4. **Planar Proximity Queries (`getNearbyUsers`):**
   - Verified that proximity queries construct and execute MongoDB planar circular queries using `{ officeId, location: { $geoWithin: { $center: [[x, y], radius] } } }`.
   - Users within the configured communication radius (default 100px) are returned with exact Pythagorean pixel distance, monotonic smoothstep gain attenuation, and stereo pan.
   - Users outside the communication radius are excluded.

5. **Multi-Tenant Office Isolation (Zero Cross-Room Audio Leakage):**
   - Users located in different virtual offices are filtered out by the database query partition, even when their X/Y coordinates are identical or within earshot distance of each other.

6. **Boundary Behavior & Threshold Adaptability:**
   - Boundary tests confirm that avatars positioned exactly on the configured radius cutoff ($d = R$) are returned with zero volume gain ($\text{gain} = 0.0$), while avatars even marginally beyond the cutoff ($d > R$) are excluded.
   - Dynamically configurable proximity radii (e.g. 50px whisper zone or 200px broadcast zone) adapt filtering bounds seamlessly.

7. **Deterministic Execution:**
   - All tests run deterministically in-memory using Node's native test runner and mock interfaces, avoiding live database dependencies and unnecessary disk writes during automated CI/CD runs.

