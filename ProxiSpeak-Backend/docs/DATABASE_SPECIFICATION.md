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
- `location` ([Number], length 2: `[x, y]`, required, finite numbers)
- `socketId` (String, indexed) - Socket.io connection ID for fast disconnect cleanup
- `lastUpdated` (Date, default: `Date.now`)
- Indexes:
  - `{ officeId: 1, location: '2d' }` - Compound planar index for fast spatial circular queries
  - `{ userId: 1 }` (unique) - Enforces single active position per user and fast avatar lookups
  - `{ officeId: 1 }` - Fast B-tree index for `getOfficePositions` initial room synchronization
  - `{ socketId: 1 }` - Fast socket disconnect cleanup

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
The test suite utilizes the Node.js native test runner (`node --test`) with 27 automated tests across 9 test suites:
- `tests/schemas/user.test.js`: Validations, defaults, email normalization
- `tests/schemas/office.test.js`: Default bounds, 100px radius, zones & obstacle validation
- `tests/schemas/livePosition.test.js`: 2D coordinate array validation, compound `{ officeId: 1, location: '2d' }` index configuration
- `tests/spatial/planarProximity.test.js`: Euclidean geometry, spherical GeoJSON failure proof, audio volume attenuation
- `tests/services/positionService.test.js`: Coordinate checks, proximity radius filtering, backend event contract shapes
