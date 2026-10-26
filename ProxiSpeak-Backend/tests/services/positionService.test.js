const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const LivePosition = require('../../src/models/LivePosition');
const User = require('../../src/models/User');
const {
  validateCoordinates,
  calculateDistance,
  calculateAudioVolume,
  calculateStereoPan,
  getNearbyUsers,
  upsertPosition,
  updatePosition,
  getUserPosition
} = require('../../src/services/positionService');
const {
  DEFAULT_ROOM_ZONES,
  DEFAULT_OBSTACLES
} = require('../../src/services/officeService');

describe('Position Service & Contract Validation', () => {
  describe('Coordinate Validation', () => {
    it('should accept valid coordinate pairs', () => {
      const coords = validateCoordinates([500, 300]);
      assert.deepStrictEqual(coords, [500, 300]);
    });

    it('should throw descriptive errors for invalid coordinates', () => {
      assert.throws(() => validateCoordinates(null), /Location must be a 2-element array/);
      assert.throws(() => validateCoordinates([100]), /Location must be a 2-element array/);
      assert.throws(() => validateCoordinates(['100', '200']), /Coordinates x and y must be finite numbers/);
      assert.throws(() => validateCoordinates([NaN, 200]), /Coordinates x and y must be finite numbers/);
      assert.throws(() => validateCoordinates([100, Infinity]), /Coordinates x and y must be finite numbers/);
    });
  });

  describe('Proximity Filtering Simulation & Backend Event Shapes', () => {
    const currentOfficeId = '660000000000000000000001';
    const otherOfficeId = '660000000000000000000002';
    const pivotUserId = 'user_self';
    const pivotLocation = [500, 300];
    const PROXIMITY_RADIUS = 100;

    // Simulated active office positions
    const activeOfficeUsers = [
      {
        userId: 'user_self',
        officeId: currentOfficeId,
        displayName: 'Myself',
        avatarColor: '#3b82f6',
        location: [500, 300]
      },
      {
        userId: 'user_alex',
        officeId: currentOfficeId,
        displayName: 'Alex',
        avatarColor: '#a78bfa',
        location: [530, 340] // dx = 30, dy = 40 => distance = 50px (WITHIN 100px)
      },
      {
        userId: 'user_sam',
        officeId: currentOfficeId,
        displayName: 'Sam',
        avatarColor: '#34d399',
        location: [560, 300] // dx = 60, dy = 0 => distance = 60px (WITHIN 100px)
      },
      {
        userId: 'user_boundary',
        officeId: currentOfficeId,
        displayName: 'Boundary User',
        avatarColor: '#f59e0b',
        location: [500, 400] // dx = 0, dy = 100 => distance = 100px (BOUNDARY)
      },
      {
        userId: 'user_other_office',
        officeId: otherOfficeId, // DIFFERENT OFFICE
        displayName: 'Other Office User',
        avatarColor: '#10b981',
        location: [505, 305] // dx = 5, dy = 5 => distance = ~7px (CLOSE BUT DIFFERENT OFFICE)
      },
      {
        userId: 'user_taylor',
        officeId: currentOfficeId,
        displayName: 'Taylor',
        avatarColor: '#fb923c',
        location: [650, 420] // dx = 150, dy = 120 => distance = 192px (OUTSIDE 100px)
      },
      {
        userId: 'user_far',
        officeId: currentOfficeId,
        displayName: 'Far Desk User',
        avatarColor: '#ef4444',
        location: [100, 100] // distance ~ 447px (FAR OUTSIDE)
      }
    ];

    it('should correctly identify all users within 100-pixel radius and exclude self and different offices', () => {
      const nearbyUsers = activeOfficeUsers
        .filter((u) => (!u.officeId || u.officeId === currentOfficeId) && u.userId !== pivotUserId)
        .map((u) => {
          const distance = calculateDistance(pivotLocation, u.location);
          const volume = calculateAudioVolume(distance, PROXIMITY_RADIUS);
          const pan = calculateStereoPan(pivotLocation[0], u.location[0], PROXIMITY_RADIUS);
          return {
            ...u,
            distance: Number(distance.toFixed(2)),
            gain: volume,
            volume,
            pan
          };
        })
        .filter((u) => u.distance <= PROXIMITY_RADIUS)
        .sort((a, b) => a.distance - b.distance);

      // Should include Alex (50px), Sam (60px), and Boundary User (100px)
      assert.strictEqual(nearbyUsers.length, 3, 'Should find exactly 3 users within 100px radius');
      assert.strictEqual(nearbyUsers[0].displayName, 'Alex');
      assert.strictEqual(nearbyUsers[0].distance, 50);
      assert.strictEqual(nearbyUsers[0].volume, 0.5);
      assert.strictEqual(nearbyUsers[0].pan, 0.3);

      assert.strictEqual(nearbyUsers[1].displayName, 'Sam');
      assert.strictEqual(nearbyUsers[1].distance, 60);
      assert.strictEqual(nearbyUsers[1].volume, 0.352); // smoothstep 1 - (3*0.36 - 2*0.216) = 0.352
      assert.strictEqual(nearbyUsers[1].pan, 0.6);

      assert.strictEqual(nearbyUsers[2].displayName, 'Boundary User');
      assert.strictEqual(nearbyUsers[2].distance, 100);
      assert.strictEqual(nearbyUsers[2].volume, 0.0);
      assert.strictEqual(nearbyUsers[2].pan, 0.0);

      // Ensure far users and other office users were excluded
      const foundTaylor = nearbyUsers.some((u) => u.displayName === 'Taylor');
      const foundFar = nearbyUsers.some((u) => u.displayName === 'Far Desk User');
      const foundOtherOffice = nearbyUsers.some((u) => u.displayName === 'Other Office User');
      assert.strictEqual(foundTaylor, false, 'Taylor (>100px) must be excluded');
      assert.strictEqual(foundFar, false, 'Far user must be excluded');
      assert.strictEqual(foundOtherOffice, false, 'Other Office User must be excluded despite being 7px close');
    });

    it('should adhere to the backend contract shape for WebRTC audio peer discovery', () => {
      // Contract specification verification
      const samplePeerContract = {
        userId: 'user_alex',
        displayName: 'Alex',
        avatarColor: '#a78bfa',
        location: [530, 340],
        distance: 50.0,
        volume: 0.5,
        isOnline: true
      };

      assert.ok(samplePeerContract.userId);
      assert.ok(Array.isArray(samplePeerContract.location) && samplePeerContract.location.length === 2);
      assert.strictEqual(typeof samplePeerContract.distance, 'number');
      assert.strictEqual(typeof samplePeerContract.volume, 'number');
      assert.ok(samplePeerContract.volume >= 0 && samplePeerContract.volume <= 1);
    });
  });

  describe('LivePosition Planar Proximity Query & Office Isolation (getNearbyUsers)', () => {
    const officeA = new mongoose.Types.ObjectId();
    const officeB = new mongoose.Types.ObjectId();
    const pivotUserId = new mongoose.Types.ObjectId();
    const pivotLocation = [500, 300];
    const PROXIMITY_RADIUS = 100;

    // Canonical dataset representing live avatar positions across multiple virtual offices
    const mockDatabasePositions = [
      // --- Office A Users ---
      {
        _id: new mongoose.Types.ObjectId(),
        userId: {
          _id: pivotUserId,
          displayName: 'Myself (Pivot)',
          email: 'pivot@proxispeak.com',
          avatarColor: '#3b82f6',
          avatarUrl: '',
          isOnline: true
        },
        officeId: officeA,
        location: [500, 300],
        socketId: 'sock_pivot',
        lastUpdated: new Date()
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: {
          _id: new mongoose.Types.ObjectId(),
          displayName: 'Alice (Within Radius)',
          email: 'alice@proxispeak.com',
          avatarColor: '#a78bfa',
          avatarUrl: '',
          isOnline: true
        },
        officeId: officeA,
        location: [530, 340], // dx = 30, dy = 40 => distance = 50px (WITHIN 100px)
        socketId: 'sock_alice',
        lastUpdated: new Date()
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: {
          _id: new mongoose.Types.ObjectId(),
          displayName: 'Bob (Within Radius)',
          email: 'bob@proxispeak.com',
          avatarColor: '#34d399',
          avatarUrl: '',
          isOnline: true
        },
        officeId: officeA,
        location: [560, 300], // dx = 60, dy = 0 => distance = 60px (WITHIN 100px)
        socketId: 'sock_bob',
        lastUpdated: new Date()
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: {
          _id: new mongoose.Types.ObjectId(),
          displayName: 'Charlie (Outside Radius)',
          email: 'charlie@proxispeak.com',
          avatarColor: '#fb923c',
          avatarUrl: '',
          isOnline: true
        },
        officeId: officeA,
        location: [650, 420], // dx = 150, dy = 120 => distance = 192.09px (OUTSIDE 100px)
        socketId: 'sock_charlie',
        lastUpdated: new Date()
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: {
          _id: new mongoose.Types.ObjectId(),
          displayName: 'David (Far Outside)',
          email: 'david@proxispeak.com',
          avatarColor: '#ef4444',
          avatarUrl: '',
          isOnline: false
        },
        officeId: officeA,
        location: [100, 100], // distance ~ 447px (FAR OUTSIDE)
        socketId: 'sock_david',
        lastUpdated: new Date()
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: {
          _id: new mongoose.Types.ObjectId(),
          displayName: 'Grace (Exact Boundary)',
          email: 'grace@proxispeak.com',
          avatarColor: '#f59e0b',
          avatarUrl: '',
          isOnline: true
        },
        officeId: officeA,
        location: [500, 400], // dx = 0, dy = 100 => distance = 100px (EXACT BOUNDARY)
        socketId: 'sock_grace',
        lastUpdated: new Date()
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: {
          _id: new mongoose.Types.ObjectId(),
          displayName: 'Heidi (Just Beyond Boundary)',
          email: 'heidi@proxispeak.com',
          avatarColor: '#8b5cf6',
          avatarUrl: '',
          isOnline: true
        },
        officeId: officeA,
        location: [500, 401], // dx = 0, dy = 101 => distance = 101px (BEYOND BOUNDARY)
        socketId: 'sock_heidi',
        lastUpdated: new Date()
      },
      // --- Office B Users (Office Isolation Test) ---
      {
        _id: new mongoose.Types.ObjectId(),
        userId: {
          _id: new mongoose.Types.ObjectId(),
          displayName: 'Eve (Other Office Close)',
          email: 'eve@proxispeak.com',
          avatarColor: '#10b981',
          avatarUrl: '',
          isOnline: true
        },
        officeId: officeB,
        location: [505, 305], // dx = 5, dy = 5 => distance = 7.07px (VERY CLOSE BUT DIFFERENT OFFICE)
        socketId: 'sock_eve',
        lastUpdated: new Date()
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: {
          _id: new mongoose.Types.ObjectId(),
          displayName: 'Frank (Other Office Identical Position)',
          email: 'frank@proxispeak.com',
          avatarColor: '#ec4899',
          avatarUrl: '',
          isOnline: true
        },
        officeId: officeB,
        location: [500, 300], // Identical [x, y] to pivot, but in Office B
        socketId: 'sock_frank',
        lastUpdated: new Date()
      }
    ];

    let lastFindQuery = null;

    function setupFindMock(positions = mockDatabasePositions) {
      return mock.method(LivePosition, 'find', (query) => {
        lastFindQuery = query;
        return {
          populate: () => ({
            lean: async () => {
              // Emulate MongoDB planar 2D query engine
              return positions.filter((doc) => {
                // 1. Office Isolation filter
                if (query.officeId && String(doc.officeId) !== String(query.officeId)) {
                  return false;
                }
                // 2. User self-exclusion filter
                if (query.userId?.$ne && String(doc.userId?._id || doc.userId) === String(query.userId.$ne)) {
                  return false;
                }
                // 3. Planar 2D circular boundary filter ($geoWithin with $center: [[cx, cy], r])
                if (query.location?.$geoWithin?.$center) {
                  const [[cx, cy], maxRadius] = query.location.$geoWithin.$center;
                  const [x, y] = doc.location;
                  const distance = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
                  if (distance > maxRadius) {
                    return false;
                  }
                }
                return true;
              });
            }
          })
        };
      });
    }

    it('should construct correct MongoDB planar 2D query with $geoWithin $center and officeId partition', async () => {
      const findMock = setupFindMock();
      try {
        await getNearbyUsers({
          officeId: officeA,
          location: [500, 300],
          radius: 100,
          excludeUserId: pivotUserId
        });

        assert.ok(lastFindQuery, 'LivePosition.find should have been called');
        assert.strictEqual(String(lastFindQuery.officeId), String(officeA));
        assert.deepStrictEqual(lastFindQuery.location, {
          $geoWithin: {
            $center: [[500, 300], 100]
          }
        });
        assert.deepStrictEqual(lastFindQuery.userId, { $ne: pivotUserId });
      } finally {
        findMock.mock.restore();
      }
    });

    it('should return two users in the same office within the communication radius as nearby (Case 1)', async () => {
      const findMock = setupFindMock();
      try {
        const nearby = await getNearbyUsers({
          officeId: officeA,
          location: pivotLocation,
          radius: PROXIMITY_RADIUS,
          excludeUserId: pivotUserId
        });

        const alice = nearby.find((u) => u.displayName.includes('Alice'));
        const bob = nearby.find((u) => u.displayName.includes('Bob'));

        assert.ok(alice, 'Alice (50px away) must be returned as nearby');
        assert.strictEqual(alice.distance, 50.0);
        assert.strictEqual(alice.volume, 0.5); // smoothstep at halfway
        assert.strictEqual(alice.pan, 0.3); // (530 - 500) / 100

        assert.ok(bob, 'Bob (60px away) must be returned as nearby');
        assert.strictEqual(bob.distance, 60.0);
        assert.strictEqual(bob.volume, 0.352);
        assert.strictEqual(bob.pan, 0.6); // (560 - 500) / 100

        // Nearest users first sorting order
        const aliceIndex = nearby.findIndex((u) => u.displayName.includes('Alice'));
        const bobIndex = nearby.findIndex((u) => u.displayName.includes('Bob'));
        assert.ok(aliceIndex < bobIndex, 'Alice (50px) must be ordered before Bob (60px)');
      } finally {
        findMock.mock.restore();
      }
    });

    it('should NOT return users outside the communication radius (Case 2)', async () => {
      const findMock = setupFindMock();
      try {
        const nearby = await getNearbyUsers({
          officeId: officeA,
          location: pivotLocation,
          radius: PROXIMITY_RADIUS,
          excludeUserId: pivotUserId
        });

        const charlie = nearby.find((u) => u.displayName.includes('Charlie'));
        const david = nearby.find((u) => u.displayName.includes('David'));

        assert.strictEqual(charlie, undefined, 'Charlie (192px away) must NOT be returned');
        assert.strictEqual(david, undefined, 'David (447px away) must NOT be returned');
      } finally {
        findMock.mock.restore();
      }
    });

    it('should NOT return users in a different office even if their X/Y coordinates are close or identical (Case 3 - Office Isolation)', async () => {
      const findMock = setupFindMock();
      try {
        const nearbyOfficeA = await getNearbyUsers({
          officeId: officeA,
          location: pivotLocation,
          radius: PROXIMITY_RADIUS,
          excludeUserId: pivotUserId
        });

        const eve = nearbyOfficeA.find((u) => u.displayName.includes('Eve'));
        const frank = nearbyOfficeA.find((u) => u.displayName.includes('Frank'));

        assert.strictEqual(eve, undefined, 'Eve (Office B, 7px away) must NOT be returned in Office A query');
        assert.strictEqual(frank, undefined, 'Frank (Office B, identical coordinates) must NOT be returned in Office A query');

        // Cross-check: querying Office B at the same coordinates returns Eve and Frank, but isolates Office A
        const nearbyOfficeB = await getNearbyUsers({
          officeId: officeB,
          location: pivotLocation,
          radius: PROXIMITY_RADIUS
        });

        assert.strictEqual(nearbyOfficeB.length, 2, 'Office B query should only return Office B users');
        assert.ok(nearbyOfficeB.some((u) => u.displayName.includes('Eve')));
        assert.ok(nearbyOfficeB.some((u) => u.displayName.includes('Frank')));
        assert.strictEqual(
          nearbyOfficeB.some((u) => u.displayName.includes('Alice') || u.displayName.includes('Bob')),
          false,
          'Office B query must not leak any Office A users'
        );
      } finally {
        findMock.mock.restore();
      }
    });

    it('should test boundary behavior: include user exactly at configured radius with 0 volume and exclude user beyond radius (Case 4)', async () => {
      const findMock = setupFindMock();
      try {
        const nearby = await getNearbyUsers({
          officeId: officeA,
          location: pivotLocation,
          radius: PROXIMITY_RADIUS,
          excludeUserId: pivotUserId
        });

        const grace = nearby.find((u) => u.displayName.includes('Grace'));
        const heidi = nearby.find((u) => u.displayName.includes('Heidi'));

        // Exactly at boundary (distance = 100px, radius = 100px)
        assert.ok(grace, 'Grace (distance exactly 100px) must be returned at the boundary');
        assert.strictEqual(grace.distance, 100.0);
        assert.strictEqual(grace.volume, 0.0, 'Volume must attenuate to 0.0 at exact boundary radius');

        // Just beyond boundary (distance = 101px, radius = 100px)
        assert.strictEqual(heidi, undefined, 'Heidi (distance 101px > 100px) must NOT be returned');
      } finally {
        findMock.mock.restore();
      }
    });

    it('should adapt boundary filtering when custom radius is configured (e.g. 50px whisper zone)', async () => {
      const findMock = setupFindMock();
      try {
        // Custom radius = 50px
        const nearby50 = await getNearbyUsers({
          officeId: officeA,
          location: pivotLocation,
          radius: 50,
          excludeUserId: pivotUserId
        });

        const alice = nearby50.find((u) => u.displayName.includes('Alice'));
        const bob = nearby50.find((u) => u.displayName.includes('Bob'));

        // Alice is at 50px -> on the boundary of a 50px radius => included!
        assert.ok(alice, 'Alice (50px) must be included on boundary of 50px radius');
        assert.strictEqual(alice.distance, 50.0);
        assert.strictEqual(alice.volume, 0.0, 'Volume must attenuate to 0.0 at 50px boundary');

        // Bob is at 60px -> beyond 50px radius => excluded!
        assert.strictEqual(bob, undefined, 'Bob (60px) must be excluded when radius is 50px');
      } finally {
        findMock.mock.restore();
      }
    });

    it('should exclude querying user from proximity results when excludeUserId is provided', async () => {
      const findMock = setupFindMock();
      try {
        const nearby = await getNearbyUsers({
          officeId: officeA,
          location: pivotLocation,
          radius: PROXIMITY_RADIUS,
          excludeUserId: pivotUserId
        });

        const self = nearby.find((u) => u.displayName.includes('Myself'));
        assert.strictEqual(self, undefined, 'Self user must not appear in own nearby proximity results');
      } finally {
        findMock.mock.restore();
      }
    });

    it('should throw descriptive errors when required parameters are missing or coordinates are invalid', async () => {
      await assert.rejects(
        async () => await getNearbyUsers({ location: [500, 300] }),
        /officeId is required/
      );
      await assert.rejects(
        async () => await getNearbyUsers({ officeId: officeA, location: 'invalid' }),
        /Location must be a 2-element array/
      );
      await assert.rejects(
        async () => await getNearbyUsers({ officeId: officeA, location: [NaN, 300] }),
        /Coordinates x and y must be finite numbers/
      );
    });
  });

  describe('Default Office Layout & Obstacles Contract', () => {
    it('should provide default room zones covering standard office sections', () => {
      assert.ok(Array.isArray(DEFAULT_ROOM_ZONES));
      assert.strictEqual(DEFAULT_ROOM_ZONES.length, 4);

      const zoneTitles = DEFAULT_ROOM_ZONES.map((z) => z.title);
      assert.ok(zoneTitles.includes('WORKSTATION A'));
      assert.ok(zoneTitles.includes('WORKSTATION B'));
      assert.ok(zoneTitles.includes('MEETING AREA'));
      assert.ok(zoneTitles.includes('LOUNGE'));
    });

    it('should calculate audio volume using agreed smoothstep formula: 1 - (3t^2 - 2t^3)', () => {
      // t = clamp(d/radius, 0, 1); gain = 1 - (3t^2 - 2t^3)
      const R = 100;
      assert.strictEqual(calculateAudioVolume(0, R), 1.0, 'd=0 => 1.0');
      assert.strictEqual(calculateAudioVolume(25, R), 0.8438, 'd=25 => 0.8438');
      assert.strictEqual(calculateAudioVolume(50, R), 0.5, 'd=50 => 0.5');
      assert.strictEqual(calculateAudioVolume(60, R), 0.352, 'd=60 => 0.352');
      assert.strictEqual(calculateAudioVolume(75, R), 0.1563, 'd=75 => 0.1563');
      assert.strictEqual(calculateAudioVolume(100, R), 0.0, 'd=100 => 0.0');
      assert.strictEqual(calculateAudioVolume(150, R), 0.0, 'd>100 => 0.0');
    });

    it('should provide default furniture obstacles with valid bounds and types', () => {
      assert.ok(Array.isArray(DEFAULT_OBSTACLES));
      assert.strictEqual(DEFAULT_OBSTACLES.length, 14, 'Must seed exactly 14 default furniture obstacles');

      const expectedLabels = [
        'Desk A1', 'Desk A2', 'Desk A3', 'Desk A4',
        'Desk B1', 'Desk B2', 'Desk B3', 'Desk B4',
        'Conference Table', 'Sofa North', 'Sofa East', 'Coffee Table',
        'Coffee Counter', 'Sideboard'
      ];

      for (const obstacle of DEFAULT_OBSTACLES) {
        assert.ok(typeof obstacle.x === 'number' && obstacle.x >= 0);
        assert.ok(typeof obstacle.y === 'number' && obstacle.y >= 0);
        assert.ok(typeof obstacle.w === 'number' && obstacle.w > 0);
        assert.ok(typeof obstacle.h === 'number' && obstacle.h > 0);
        assert.ok(obstacle.x + obstacle.w <= 1000, `Obstacle ${obstacle.label} exceeds width 1000`);
        assert.ok(obstacle.y + obstacle.h <= 600, `Obstacle ${obstacle.label} exceeds height 600`);
        assert.ok(
          ['desk', 'table', 'sofa', 'coffee', 'counter', 'wall', 'custom'].includes(obstacle.type),
          `Invalid type: ${obstacle.type}`
        );
        assert.ok(expectedLabels.includes(obstacle.label), `Unexpected obstacle label: ${obstacle.label}`);
      }
    });

    it('should benchmark proximity evaluation for 60 users against 20ms target SLA', () => {
      const { generate60TestUsers } = require('../../scripts/seed');
      const { runMemoryNearbyUsersBenchmark } = require('../../scripts/benchmark');

      const testUsers = generate60TestUsers('office-01');
      assert.strictEqual(testUsers.length, 60, 'Should seed exactly 60 test users');

      const pivot = [160, 160];
      const stats = runMemoryNearbyUsersBenchmark(testUsers, pivot, 100, 200);

      assert.ok(stats.p50 < 20.0, `p50 (${stats.p50}ms) must be under 20ms SLA`);
      assert.ok(stats.p95 < 20.0, `p95 (${stats.p95}ms) must be under 20ms SLA`);
    });
  });

  describe('LivePosition Persistence & Update Integrity', () => {
    const testOfficeId1 = new mongoose.Types.ObjectId();
    const testOfficeId2 = new mongoose.Types.ObjectId();
    const testUserA = new mongoose.Types.ObjectId();
    const testUserB = new mongoose.Types.ObjectId();

    let mockPositionStore;
    let mockUserStore;
    let findOneAndUpdateCalls;
    let findOneCalls;
    let findOneMock;
    let findOneAndUpdateMock;
    let findByIdMock;

    function setupMocks() {
      mockPositionStore = new Map();
      mockUserStore = new Map();
      findOneAndUpdateCalls = 0;
      findOneCalls = 0;

      findOneMock = mock.method(LivePosition, 'findOne', async (filter) => {
        findOneCalls++;
        if (filter.userId) {
          const doc = mockPositionStore.get(String(filter.userId));
          return doc ? { ...doc } : null;
        }
        if (filter.socketId) {
          for (const doc of mockPositionStore.values()) {
            if (doc.socketId === filter.socketId) return { ...doc };
          }
        }
        return null;
      });

      findOneAndUpdateMock = mock.method(LivePosition, 'findOneAndUpdate', async (filter, update, options) => {
        findOneAndUpdateCalls++;
        const userId = String(filter.userId);
        let doc = mockPositionStore.get(userId);

        if (!doc) {
          if (options && options.upsert) {
            doc = {
              _id: new mongoose.Types.ObjectId(),
              userId: filter.userId,
              createdAt: new Date(),
              ...update.$set
            };
            mockPositionStore.set(userId, doc);
            return { ...doc };
          }
          return null;
        }

        Object.assign(doc, update.$set);
        mockPositionStore.set(userId, doc);
        return { ...doc };
      });

      findByIdMock = mock.method(User, 'findById', (id) => {
        return {
          lean: async () => {
            return mockUserStore.get(String(id)) || null;
          }
        };
      });
    }

    function restoreMocks() {
      if (findOneMock) findOneMock.mock.restore();
      if (findOneAndUpdateMock) findOneAndUpdateMock.mock.restore();
      if (findByIdMock) findByIdMock.mock.restore();
    }

    it('1. should create a first LivePosition when user has no existing record', async () => {
      setupMocks();
      try {
        const created = await upsertPosition({
          userId: testUserA,
          officeId: testOfficeId1,
          location: [200, 300],
          socketId: 'sock_init_01'
        });

        assert.ok(created, 'Should return created position document');
        assert.strictEqual(String(created.userId), String(testUserA));
        assert.strictEqual(String(created.officeId), String(testOfficeId1));
        assert.deepStrictEqual(created.location, [200, 300]);
        assert.strictEqual(created.socketId, 'sock_init_01');
        assert.strictEqual(mockPositionStore.size, 1);
        assert.strictEqual(findOneAndUpdateCalls, 1);
      } finally {
        restoreMocks();
      }
    });

    it('2. should update an existing LivePosition in-place without creating a duplicate', async () => {
      setupMocks();
      try {
        const first = await upsertPosition({
          userId: testUserA,
          officeId: testOfficeId1,
          location: [200, 300],
          socketId: 'sock_init_01'
        });

        const updated = await updatePosition(testUserA, [250, 350]);

        assert.ok(updated, 'Should return updated position document');
        assert.strictEqual(String(updated._id), String(first._id), 'Document _id must be preserved (in-place update)');
        assert.strictEqual(String(updated.userId), String(testUserA));
        assert.deepStrictEqual(updated.location, [250, 350]);
        assert.strictEqual(mockPositionStore.size, 1, 'Store must still contain exactly 1 position');
      } finally {
        restoreMocks();
      }
    });

    it('3. should handle multiple sequential updates for the same user accurately', async () => {
      setupMocks();
      try {
        await upsertPosition({
          userId: testUserA,
          officeId: testOfficeId1,
          location: [100, 100],
          socketId: 'sock_multi_01'
        });

        const waypoints = [
          [120, 105],
          [150, 110],
          [180, 120],
          [220, 140]
        ];

        for (const pt of waypoints) {
          const res = await updatePosition(testUserA, pt);
          assert.deepStrictEqual(res.location, pt);
        }

        const current = mockPositionStore.get(String(testUserA));
        assert.deepStrictEqual(current.location, [220, 140]);
        assert.strictEqual(mockPositionStore.size, 1);
      } finally {
        restoreMocks();
      }
    });

    it('4. should confirm only one LivePosition remains for the user across multiple updates', async () => {
      setupMocks();
      try {
        await upsertPosition({
          userId: testUserA,
          officeId: testOfficeId1,
          location: [100, 100],
          socketId: 'sock_single'
        });

        await updatePosition(testUserA, [110, 110]);
        await updatePosition(testUserA, [120, 120]);
        await upsertPosition({
          userId: testUserA,
          officeId: testOfficeId1,
          location: [130, 130],
          socketId: 'sock_single'
        });

        const records = Array.from(mockPositionStore.values()).filter(
          (doc) => String(doc.userId) === String(testUserA)
        );

        assert.strictEqual(records.length, 1, 'Exactly one LivePosition must exist for the user');
        assert.deepStrictEqual(records[0].location, [130, 130]);
      } finally {
        restoreMocks();
      }
    });

    it('5. should update location values accurately across canvas domain', async () => {
      setupMocks();
      try {
        await upsertPosition({
          userId: testUserA,
          officeId: testOfficeId1,
          location: [500, 300]
        });

        // Test origin coordinates [0, 0]
        const originRes = await updatePosition(testUserA, [0, 0]);
        assert.deepStrictEqual(originRes.location, [0, 0]);

        // Test corner coordinates [1000, 600]
        const cornerRes = await updatePosition(testUserA, [1000, 600]);
        assert.deepStrictEqual(cornerRes.location, [1000, 600]);

        // Test custom precision coordinates [742, 389]
        const customRes = await updatePosition(testUserA, [742, 389]);
        assert.deepStrictEqual(customRes.location, [742, 389]);
      } finally {
        restoreMocks();
      }
    });

    it('6. should preserve office association during movement and update it when moving to another office', async () => {
      setupMocks();
      try {
        await upsertPosition({
          userId: testUserA,
          officeId: testOfficeId1,
          location: [100, 100]
        });

        // Movement within same office (officeId not supplied) preserves officeId
        const moved = await updatePosition(testUserA, [150, 150]);
        assert.strictEqual(String(moved.officeId), String(testOfficeId1), 'Original officeId must be preserved');

        // Transfer to another office
        const transferred = await updatePosition(testUserA, [200, 200], { officeId: testOfficeId2 });
        assert.strictEqual(String(transferred.officeId), String(testOfficeId2), 'Office association must update to new office');

        const current = mockPositionStore.get(String(testUserA));
        assert.strictEqual(String(current.officeId), String(testOfficeId2));
      } finally {
        restoreMocks();
      }
    });

    it('7. should handle socketId correctly by preserving existing and updating on reconnect', async () => {
      setupMocks();
      try {
        await upsertPosition({
          userId: testUserA,
          officeId: testOfficeId1,
          location: [100, 100],
          socketId: 'sock_original'
        });

        // Regular move without socketId keeps existing socketId
        const moveRes = await updatePosition(testUserA, [110, 110]);
        assert.strictEqual(moveRes.socketId, 'sock_original', 'SocketId must be preserved during normal move');

        // Reconnect update with new socketId updates socketId
        const reconnectRes = await updatePosition(testUserA, [110, 110], { socketId: 'sock_reconnected' });
        assert.strictEqual(reconnectRes.socketId, 'sock_reconnected', 'SocketId must update to new connection ID');
      } finally {
        restoreMocks();
      }
    });

    it('8. should avoid unnecessary MongoDB writes when position is repeated identically', async () => {
      setupMocks();
      try {
        await upsertPosition({
          userId: testUserA,
          officeId: testOfficeId1,
          location: [400, 250],
          socketId: 'sock_idle'
        });

        // Reset write counter after initial creation
        findOneAndUpdateCalls = 0;

        // Repeated update with identical location
        const res1 = await updatePosition(testUserA, [400, 250]);
        assert.deepStrictEqual(res1.location, [400, 250]);
        assert.strictEqual(findOneAndUpdateCalls, 0, 'No MongoDB write should occur when location has not changed');

        // Second repeated update with identical location
        const res2 = await updatePosition(testUserA, [400, 250]);
        assert.deepStrictEqual(res2.location, [400, 250]);
        assert.strictEqual(findOneAndUpdateCalls, 0, 'No MongoDB write should occur on second identical update');

        // Upsert with identical office, location, and socket
        const res3 = await upsertPosition({
          userId: testUserA,
          officeId: testOfficeId1,
          location: [400, 250],
          socketId: 'sock_idle'
        });
        assert.deepStrictEqual(res3.location, [400, 250]);
        assert.strictEqual(findOneAndUpdateCalls, 0, 'No MongoDB write should occur on identical upsert');

        // Now move slightly -> write should occur exactly once
        const res4 = await updatePosition(testUserA, [401, 250]);
        assert.deepStrictEqual(res4.location, [401, 250]);
        assert.strictEqual(findOneAndUpdateCalls, 1, 'Exactly one write should occur when location actually changes');
      } finally {
        restoreMocks();
      }
    });

    it('9. should handle missing/non-existing position records safely', async () => {
      setupMocks();
      try {
        // User B has no LivePosition and no currentOfficeId configured
        const missingRes = await updatePosition(testUserB, [300, 300]);
        assert.strictEqual(missingRes, null, 'Should safely return null when user has no position and no office');

        // User B with officeId passed in options should safely initialize
        const initializedRes = await updatePosition(testUserB, [300, 300], { officeId: testOfficeId1 });
        assert.ok(initializedRes, 'Should initialize position when officeId is provided');
        assert.strictEqual(String(initializedRes.officeId), String(testOfficeId1));
        assert.deepStrictEqual(initializedRes.location, [300, 300]);

        // User without position but with user.currentOfficeId should auto-initialize
        const testUserC = new mongoose.Types.ObjectId();
        mockUserStore.set(String(testUserC), {
          _id: testUserC,
          displayName: 'User C',
          currentOfficeId: testOfficeId2
        });

        const autoInitRes = await updatePosition(testUserC, [450, 350]);
        assert.ok(autoInitRes, 'Should auto-initialize position using user currentOfficeId');
        assert.strictEqual(String(autoInitRes.officeId), String(testOfficeId2));
        assert.deepStrictEqual(autoInitRes.location, [450, 350]);
      } finally {
        restoreMocks();
      }
    });

    it('10. should verify the final stored MongoDB document adheres to LivePosition schema', async () => {
      setupMocks();
      try {
        await upsertPosition({
          userId: testUserA,
          officeId: testOfficeId1,
          location: [500, 300],
          socketId: 'sock_final_verify'
        });

        // Perform multiple movements
        await updatePosition(testUserA, [520, 310]);
        await updatePosition(testUserA, [540, 320]);

        const storedDoc = await getUserPosition(testUserA);
        assert.ok(storedDoc, 'Stored document must be retrievable via getUserPosition');

        // Validate directly against Mongoose LivePosition schema
        const mongooseDoc = new LivePosition({
          userId: storedDoc.userId,
          officeId: storedDoc.officeId,
          location: storedDoc.location,
          socketId: storedDoc.socketId,
          lastUpdated: storedDoc.lastUpdated
        });

        await mongooseDoc.validate();

        assert.strictEqual(String(storedDoc.userId), String(testUserA));
        assert.strictEqual(String(storedDoc.officeId), String(testOfficeId1));
        assert.deepStrictEqual(storedDoc.location, [540, 320]);
        assert.strictEqual(storedDoc.socketId, 'sock_final_verify');
        assert.ok(storedDoc.lastUpdated instanceof Date);
        assert.strictEqual(mockPositionStore.size, 1);
      } finally {
        restoreMocks();
      }
    });
  });
});
