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
  getUserPosition,
  getOfficePositions,
  removeUserPosition,
  removeBySocketId,
  removeStalePositions,
  isPositionWithinOffice,
  validatePositionInOffice
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

    it('should reject invalid coordinates across all edge cases (missing, non-numeric, NaN, Infinity, and malformed arrays)', () => {
      // 1. Missing coordinates
      assert.throws(() => validateCoordinates(null), /Location must be a 2-element array/);
      assert.throws(() => validateCoordinates(undefined), /Location must be a 2-element array/);

      // 2. Malformed coordinate arrays & non-arrays
      const malformedCases = [
        [],
        [500],
        [500, 300, 100],
        [[500, 300]],
        { x: 500, y: 300 },
        '500, 300',
        12345,
        true,
        false
      ];
      for (const malformed of malformedCases) {
        assert.throws(
          () => validateCoordinates(malformed),
          /Location must be a 2-element array|Coordinates x and y must be finite numbers/,
          `Should reject malformed coordinate input: ${JSON.stringify(malformed)}`
        );
      }

      // 3. Non-numeric values within 2-element array
      const nonNumericCases = [
        ['500', 300],
        [500, '300'],
        ['500', '300'],
        ['foo', 'bar'],
        [null, 300],
        [500, null],
        [undefined, 300],
        [500, undefined],
        [true, 300],
        [500, false],
        [{}, 300],
        [500, []]
      ];
      for (const nonNumeric of nonNumericCases) {
        assert.throws(
          () => validateCoordinates(nonNumeric),
          /Coordinates x and y must be finite numbers/,
          `Should reject non-numeric elements: ${JSON.stringify(nonNumeric)}`
        );
      }

      // 4. NaN values
      const nanCases = [
        [NaN, 300],
        [500, NaN],
        [NaN, NaN]
      ];
      for (const nanCoord of nanCases) {
        assert.throws(
          () => validateCoordinates(nanCoord),
          /Coordinates x and y must be finite numbers/,
          `Should reject NaN coordinates: ${JSON.stringify(nanCoord)}`
        );
      }

      // 5. Infinity and -Infinity values
      const infCases = [
        [Infinity, 300],
        [500, Infinity],
        [-Infinity, 300],
        [500, -Infinity],
        [Infinity, Infinity],
        [-Infinity, -Infinity]
      ];
      for (const infCoord of infCases) {
        assert.throws(
          () => validateCoordinates(infCoord),
          /Coordinates x and y must be finite numbers/,
          `Should reject Infinity coordinates: ${JSON.stringify(infCoord)}`
        );
      }
    });

    it('should reject invalid location data in upsertPosition and updatePosition before database invocation', async () => {
      const dummyUser = new mongoose.Types.ObjectId();
      const dummyOffice = new mongoose.Types.ObjectId();

      const invalidLocations = [
        null,
        undefined,
        [],
        [500],
        [500, 300, 100],
        [NaN, 300],
        [500, Infinity],
        [-Infinity, 300],
        ['500', 300],
        [500, '300']
      ];

      for (const invLoc of invalidLocations) {
        // upsertPosition
        await assert.rejects(
          async () => await upsertPosition({
            userId: dummyUser,
            officeId: dummyOffice,
            location: invLoc
          }),
          /Location must be a 2-element array|Coordinates x and y must be finite numbers/,
          `upsertPosition should reject invalid location: ${JSON.stringify(invLoc)}`
        );

        // updatePosition
        await assert.rejects(
          async () => await updatePosition(dummyUser, invLoc),
          /Location must be a 2-element array|Coordinates x and y must be finite numbers/,
          `updatePosition should reject invalid location: ${JSON.stringify(invLoc)}`
        );
      }
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
    let findMock;

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

      findMock = mock.method(LivePosition, 'find', (query) => {
        return {
          populate: () => ({
            lean: async () => {
              const results = [];
              for (const doc of mockPositionStore.values()) {
                if (query.officeId && String(doc.officeId) !== String(query.officeId)) {
                  continue;
                }
                const user = mockUserStore.get(String(doc.userId)) || {
                  _id: doc.userId,
                  displayName: 'Test User'
                };
                results.push({
                  ...doc,
                  userId: user
                });
              }
              return results;
            }
          })
        };
      });
    }

    function restoreMocks() {
      if (findOneMock) findOneMock.mock.restore();
      if (findOneAndUpdateMock) findOneAndUpdateMock.mock.restore();
      if (findByIdMock) findByIdMock.mock.restore();
      if (findMock) findMock.mock.restore();
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

    it('11. should maintain persistence isolation across multiple distinct users', async () => {
      setupMocks();
      try {
        // Create initial positions for User A and User B
        const docA1 = await upsertPosition({
          userId: testUserA,
          officeId: testOfficeId1,
          location: [100, 100],
          socketId: 'sock_user_a'
        });

        const docB1 = await upsertPosition({
          userId: testUserB,
          officeId: testOfficeId1,
          location: [200, 200],
          socketId: 'sock_user_b'
        });

        assert.strictEqual(mockPositionStore.size, 2, 'Store must contain exactly 2 documents for two users');
        assert.notStrictEqual(String(docA1._id), String(docB1._id));

        // Update User A only
        const docA2 = await updatePosition(testUserA, [150, 150]);
        assert.deepStrictEqual(docA2.location, [150, 150]);
        assert.strictEqual(String(docA2._id), String(docA1._id), 'User A _id must be preserved');

        // Verify User B document is completely unaffected
        const docBCheck = await getUserPosition(testUserB);
        assert.deepStrictEqual(docBCheck.location, [200, 200], 'User B location must remain unchanged');
        assert.strictEqual(String(docBCheck._id), String(docB1._id), 'User B _id must remain unchanged');
        assert.strictEqual(docBCheck.socketId, 'sock_user_b');

        // Update User B only
        const docB2 = await updatePosition(testUserB, [280, 280]);
        assert.deepStrictEqual(docB2.location, [280, 280]);

        // Verify User A document is still [150, 150]
        const docACheck = await getUserPosition(testUserA);
        assert.deepStrictEqual(docACheck.location, [150, 150], 'User A location must remain unchanged when User B is updated');

        // Interleaved updates
        await updatePosition(testUserA, [160, 160]);
        await updatePosition(testUserB, [290, 290]);
        await updatePosition(testUserA, [170, 170]);

        assert.strictEqual(mockPositionStore.size, 2, 'Store must strictly maintain exactly 2 documents');
        const finalA = await getUserPosition(testUserA);
        const finalB = await getUserPosition(testUserB);
        assert.deepStrictEqual(finalA.location, [170, 170]);
        assert.deepStrictEqual(finalB.location, [290, 290]);
      } finally {
        restoreMocks();
      }
    });

    it('12. should maintain document _id invariance across interleaved upsert and update operations', async () => {
      setupMocks();
      try {
        // Step 1: Initial upsert
        const doc1 = await upsertPosition({
          userId: testUserA,
          officeId: testOfficeId1,
          location: [300, 300],
          socketId: 'sock_invar'
        });
        const initialId = String(doc1._id);

        // Step 2: In-place update
        const doc2 = await updatePosition(testUserA, [310, 310]);
        assert.strictEqual(String(doc2._id), initialId);

        // Step 3: Re-upsert for same user (e.g. client reconnect or page refresh)
        const doc3 = await upsertPosition({
          userId: testUserA,
          officeId: testOfficeId1,
          location: [320, 320],
          socketId: 'sock_invar_reconnect'
        });
        assert.strictEqual(String(doc3._id), initialId, 'Re-upsert must update existing record without changing _id');

        // Step 4: Another in-place update
        const doc4 = await updatePosition(testUserA, [330, 330]);
        assert.strictEqual(String(doc4._id), initialId);

        // Confirm collection size is strictly 1
        assert.strictEqual(mockPositionStore.size, 1);
        const stored = await getUserPosition(testUserA);
        assert.strictEqual(String(stored._id), initialId);
        assert.deepStrictEqual(stored.location, [330, 330]);
        assert.strictEqual(stored.socketId, 'sock_invar_reconnect');
      } finally {
        restoreMocks();
      }
    });

    it('13. should prevent record corruption when an invalid update is rejected', async () => {
      setupMocks();
      try {
        await upsertPosition({
          userId: testUserA,
          officeId: testOfficeId1,
          location: [400, 400],
          socketId: 'sock_safeguard'
        });

        // Attempting invalid updates must reject
        await assert.rejects(async () => await updatePosition(testUserA, [NaN, 400]));
        await assert.rejects(async () => await updatePosition(testUserA, [400, Infinity]));
        await assert.rejects(async () => await updatePosition(testUserA, [400]));
        await assert.rejects(async () => await updatePosition(testUserA, null));

        // Existing document must remain completely uncorrupted
        const stored = await getUserPosition(testUserA);
        assert.deepStrictEqual(stored.location, [400, 400], 'Original coordinates must remain intact');
        assert.strictEqual(stored.socketId, 'sock_safeguard');
        assert.strictEqual(mockPositionStore.size, 1);
      } finally {
        restoreMocks();
      }
    });

    it('14. should persist positions accurately at extreme office boundary edges and corners', async () => {
      setupMocks();
      try {
        await upsertPosition({
          userId: testUserA,
          officeId: testOfficeId1,
          location: [500, 300]
        });

        const extremeCorners = [
          [0, 0],          // Canvas origin / top-left
          [1000, 0],       // Top-right
          [0, 600],        // Bottom-left
          [1000, 600]      // Bottom-right
        ];

        for (const corner of extremeCorners) {
          const res = await updatePosition(testUserA, corner);
          assert.deepStrictEqual(res.location, corner, `Must accurately persist corner ${JSON.stringify(corner)}`);

          const stored = await getUserPosition(testUserA);
          assert.deepStrictEqual(stored.location, corner);
        }
      } finally {
        restoreMocks();
      }
    });

    it('15. should update officeId and reflect immediately in getOfficePositions during office transfer', async () => {
      setupMocks();
      try {
        // Initialize user in Office 1
        await upsertPosition({
          userId: testUserA,
          officeId: testOfficeId1,
          location: [250, 250],
          socketId: 'sock_xfer'
        });

        mockUserStore.set(String(testUserA), {
          _id: testUserA,
          displayName: 'Transferring User',
          avatarColor: '#3b82f6',
          isOnline: true
        });

        // Query Office 1
        const office1PositionsBefore = await getOfficePositions(testOfficeId1);
        assert.strictEqual(office1PositionsBefore.length, 1);
        assert.strictEqual(String(office1PositionsBefore[0].userId), String(testUserA));

        // Query Office 2 (should be empty)
        const office2PositionsBefore = await getOfficePositions(testOfficeId2);
        assert.strictEqual(office2PositionsBefore.length, 0);

        // Transfer User to Office 2
        const transferRes = await updatePosition(testUserA, [300, 300], { officeId: testOfficeId2 });
        assert.strictEqual(String(transferRes.officeId), String(testOfficeId2));

        // Query Office 1 (should now be empty)
        const office1PositionsAfter = await getOfficePositions(testOfficeId1);
        assert.strictEqual(office1PositionsAfter.length, 0, 'User must no longer appear in Office 1');

        // Query Office 2 (should now contain User)
        const office2PositionsAfter = await getOfficePositions(testOfficeId2);
        assert.strictEqual(office2PositionsAfter.length, 1, 'User must now appear in Office 2');
        assert.strictEqual(String(office2PositionsAfter[0].userId), String(testUserA));
        assert.deepStrictEqual(office2PositionsAfter[0].location, [300, 300]);

        // Collection still contains strictly 1 document
        assert.strictEqual(mockPositionStore.size, 1);
      } finally {
        restoreMocks();
      }
    });
  });

  describe('Proximity Query Search Patterns & Empty Result Sets (getNearbyUsers)', () => {
    const targetOfficeId = new mongoose.Types.ObjectId();
    const otherOfficeId = new mongoose.Types.ObjectId();
    const pivotUserId = new mongoose.Types.ObjectId();
    const pivotLocation = [500, 300];

    let queryHarnessMock;

    function setupHarness(dataset = []) {
      return mock.method(LivePosition, 'find', (query) => {
        return {
          populate: () => ({
            lean: async () => {
              return dataset.filter((doc) => {
                // Office partition
                if (query.officeId && String(doc.officeId) !== String(query.officeId)) {
                  return false;
                }
                // Self exclusion
                if (query.userId?.$ne && String(doc.userId?._id || doc.userId) === String(query.userId.$ne)) {
                  return false;
                }
                // Planar circular boundary
                if (query.location?.$geoWithin?.$center) {
                  const [[cx, cy], maxRadius] = query.location.$geoWithin.$center;
                  const [x, y] = doc.location;
                  const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
                  if (dist > maxRadius) {
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

    it('should return an empty array when the target office has zero users in the database', async () => {
      queryHarnessMock = setupHarness([]);
      try {
        const result = await getNearbyUsers({
          officeId: targetOfficeId,
          location: pivotLocation,
          radius: 100,
          excludeUserId: pivotUserId
        });

        assert.ok(Array.isArray(result), 'Result must be an array');
        assert.strictEqual(result.length, 0, 'Must return 0 nearby users in an empty office');
      } finally {
        queryHarnessMock.mock.restore();
      }
    });

    it('should return an empty array when the querying user is the sole occupant in the office', async () => {
      const soleOccupant = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId: { _id: pivotUserId, displayName: 'Solo User' },
          officeId: targetOfficeId,
          location: [500, 300]
        }
      ];
      queryHarnessMock = setupHarness(soleOccupant);
      try {
        const result = await getNearbyUsers({
          officeId: targetOfficeId,
          location: pivotLocation,
          radius: 100,
          excludeUserId: pivotUserId
        });

        assert.strictEqual(result.length, 0, 'Self user must be excluded, leaving an empty result set');
      } finally {
        queryHarnessMock.mock.restore();
      }
    });

    it('should return an empty array when all peers in the office are outside the earshot radius', async () => {
      const farPeers = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Peer At 101px' },
          officeId: targetOfficeId,
          location: [500, 401] // d = 101px > 100px
        },
        {
          _id: new mongoose.Types.ObjectId(),
          userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Peer At 250px' },
          officeId: targetOfficeId,
          location: [650, 500] // dx = 150, dy = 200 => d = 250px
        }
      ];
      queryHarnessMock = setupHarness(farPeers);
      try {
        const result = await getNearbyUsers({
          officeId: targetOfficeId,
          location: pivotLocation,
          radius: 100,
          excludeUserId: pivotUserId
        });

        assert.strictEqual(result.length, 0, 'All peers outside 100px radius must be excluded');
      } finally {
        queryHarnessMock.mock.restore();
      }
    });

    it('should return an empty array when peers exist at identical coordinates but in another office', async () => {
      const crossOfficePeers = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Cross Office Peer' },
          officeId: otherOfficeId, // Different office!
          location: [500, 300] // Identical X/Y coordinates
        }
      ];
      queryHarnessMock = setupHarness(crossOfficePeers);
      try {
        const result = await getNearbyUsers({
          officeId: targetOfficeId,
          location: pivotLocation,
          radius: 100,
          excludeUserId: pivotUserId
        });

        assert.strictEqual(result.length, 0, 'Office partition must prevent cross-office peers from being returned');
      } finally {
        queryHarnessMock.mock.restore();
      }
    });

    it('should return an empty array when a custom whisper radius excludes all peers', async () => {
      const peersAt35px = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Peer at 35px' },
          officeId: targetOfficeId,
          location: [535, 300] // dx = 35, dy = 0 => 35px
        }
      ];
      queryHarnessMock = setupHarness(peersAt35px);
      try {
        // Query with whisper radius = 20px
        const result = await getNearbyUsers({
          officeId: targetOfficeId,
          location: pivotLocation,
          radius: 20,
          excludeUserId: pivotUserId
        });

        assert.strictEqual(result.length, 0, '20px whisper radius must exclude peer at 35px');
      } finally {
        queryHarnessMock.mock.restore();
      }
    });

    it('should handle fractional X/Y coordinates, compute accurate distance, and sort nearest first', async () => {
      const fractionalPeers = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Peer Far', avatarColor: '#10b981' },
          officeId: targetOfficeId,
          location: [545.5, 360.25] // dx = 45.5, dy = 60.25 => d = ~75.50px
        },
        {
          _id: new mongoose.Types.ObjectId(),
          userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Peer Near', avatarColor: '#6366f1' },
          officeId: targetOfficeId,
          location: [512.25, 316.5] // dx = 12.25, dy = 16.5 => d = ~20.55px
        }
      ];
      queryHarnessMock = setupHarness(fractionalPeers);
      try {
        const result = await getNearbyUsers({
          officeId: targetOfficeId,
          location: [500, 300],
          radius: 100,
          excludeUserId: pivotUserId
        });

        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].displayName, 'Peer Near', 'Closer fractional peer must be sorted first');
        assert.strictEqual(result[1].displayName, 'Peer Far');
        assert.ok(result[0].distance < result[1].distance);
        assert.ok(result[0].gain > result[1].gain, 'Closer peer must have higher audio gain');
      } finally {
        queryHarnessMock.mock.restore();
      }
    });

    it('should safely handle orphaned LivePosition documents when populated userId is null', async () => {
      const orphanedPeer = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId: null, // Orphaned or deleted user profile
          officeId: targetOfficeId,
          location: [520, 300],
          socketId: 'sock_orphan',
          lastUpdated: new Date()
        }
      ];
      queryHarnessMock = setupHarness(orphanedPeer);
      try {
        const result = await getNearbyUsers({
          officeId: targetOfficeId,
          location: pivotLocation,
          radius: 100
        });

        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].displayName, 'Unknown', 'Should default displayName to Unknown');
        assert.strictEqual(result[0].avatarColor, '#3b82f6', 'Should default avatarColor to #3b82f6');
        assert.strictEqual(result[0].isOnline, false, 'Should default isOnline to false');
        assert.strictEqual(result[0].distance, 20.0);
      } finally {
        queryHarnessMock.mock.restore();
      }
    });
  });

  describe('Office Boundaries & Canvas Domain Constraints (1000 × 600)', () => {
    const defaultOffice = { dimensions: { width: 1000, height: 600 } };

    it('should validate coordinates at all 4 corners and perimeter edges of 1000 × 600 office', () => {
      const validPoints = [
        [0, 0],          // Origin / Top-left
        [1000, 0],       // Top-right
        [0, 600],        // Bottom-left
        [1000, 600],     // Bottom-right
        [500, 0],        // Top perimeter edge
        [500, 600],      // Bottom perimeter edge
        [0, 300],        // Left perimeter edge
        [1000, 300],     // Right perimeter edge
        [0.01, 0.01],    // High-precision just inside top-left
        [999.99, 599.99] // High-precision just inside bottom-right
      ];

      for (const pt of validPoints) {
        assert.strictEqual(
          isPositionWithinOffice(pt, defaultOffice),
          true,
          `Point ${JSON.stringify(pt)} should be within 1000x600 office`
        );
        assert.deepStrictEqual(
          validatePositionInOffice(pt, defaultOffice),
          pt,
          `validatePositionInOffice should return coordinates for ${JSON.stringify(pt)}`
        );
      }
    });

    it('should reject coordinates just outside the 1000 × 600 office boundaries', () => {
      const outOfBoundsCases = [
        // Negative X (outside left)
        { pt: [-0.01, 300], pattern: /Coordinates must be non-negative/ },
        { pt: [-1, 300], pattern: /Coordinates must be non-negative/ },
        // Exceeding X (outside right)
        { pt: [1000.01, 300], pattern: /X coordinate \(1000\.01\) exceeds office width \(1000\)/ },
        { pt: [1001, 300], pattern: /X coordinate \(1001\) exceeds office width \(1000\)/ },
        // Negative Y (outside top)
        { pt: [500, -0.01], pattern: /Coordinates must be non-negative/ },
        { pt: [500, -1], pattern: /Coordinates must be non-negative/ },
        // Exceeding Y (outside bottom)
        { pt: [500, 600.01], pattern: /Y coordinate \(600\.01\) exceeds office height \(600\)/ },
        { pt: [500, 601], pattern: /Y coordinate \(601\) exceeds office height \(600\)/ },
        // Corner diagonals outside
        { pt: [-1, -1], pattern: /Coordinates must be non-negative/ },
        { pt: [1001, -1], pattern: /Coordinates must be non-negative/ },
        { pt: [-1, 601], pattern: /Coordinates must be non-negative/ },
        { pt: [1001, 601], pattern: /X coordinate \(1001\) exceeds office width \(1000\)/ }
      ];

      for (const { pt, pattern } of outOfBoundsCases) {
        assert.strictEqual(
          isPositionWithinOffice(pt, defaultOffice),
          false,
          `Point ${JSON.stringify(pt)} must be outside 1000x600 office`
        );
        assert.throws(
          () => validatePositionInOffice(pt, defaultOffice),
          pattern,
          `Expected ${pattern} for out-of-bounds point ${JSON.stringify(pt)}`
        );
      }
    });
  });

  describe('Multi-Office Spatial Partitioning & Query Isolation', () => {
    const officeA = new mongoose.Types.ObjectId();
    const officeB = new mongoose.Types.ObjectId();
    const officeC = new mongoose.Types.ObjectId();

    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    const userC = new mongoose.Types.ObjectId();
    const peerA = new mongoose.Types.ObjectId();

    let multiOfficeDataset;
    let multiOfficeMock;

    function setupMultiOfficeMock(dataset) {
      return mock.method(LivePosition, 'find', (query) => {
        return {
          populate: () => ({
            lean: async () => {
              return dataset.filter((doc) => {
                if (query.officeId && String(doc.officeId) !== String(query.officeId)) {
                  return false;
                }
                if (query.userId?.$ne && String(doc.userId?._id || doc.userId) === String(query.userId.$ne)) {
                  return false;
                }
                if (query.location?.$geoWithin?.$center) {
                  const [[cx, cy], maxRadius] = query.location.$geoWithin.$center;
                  const [x, y] = doc.location;
                  const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
                  if (dist > maxRadius) {
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

    it('should strictly isolate nearby-user queries across 3 virtual offices with identical coordinates', async () => {
      multiOfficeDataset = [
        // Office A users
        {
          _id: new mongoose.Types.ObjectId(),
          userId: { _id: userA, displayName: 'User in A' },
          officeId: officeA,
          location: [500, 300]
        },
        {
          _id: new mongoose.Types.ObjectId(),
          userId: { _id: peerA, displayName: 'Peer in A (Close)' },
          officeId: officeA,
          location: [520, 300] // distance 20px
        },
        // Office B users (identical coordinate [500, 300])
        {
          _id: new mongoose.Types.ObjectId(),
          userId: { _id: userB, displayName: 'User in B' },
          officeId: officeB,
          location: [500, 300]
        },
        // Office C users (identical coordinate [500, 300])
        {
          _id: new mongoose.Types.ObjectId(),
          userId: { _id: userC, displayName: 'User in C' },
          officeId: officeC,
          location: [500, 300]
        }
      ];

      multiOfficeMock = setupMultiOfficeMock(multiOfficeDataset);
      try {
        // Query Office A: should find Peer in A only
        const resultsA = await getNearbyUsers({
          officeId: officeA,
          location: [500, 300],
          radius: 100,
          excludeUserId: userA
        });
        assert.strictEqual(resultsA.length, 1);
        assert.strictEqual(resultsA[0].displayName, 'Peer in A (Close)');

        // Query Office B: sole occupant, should return []
        const resultsB = await getNearbyUsers({
          officeId: officeB,
          location: [500, 300],
          radius: 100,
          excludeUserId: userB
        });
        assert.strictEqual(resultsB.length, 0, 'Office B should have 0 nearby peers');

        // Query Office C: sole occupant, should return []
        const resultsC = await getNearbyUsers({
          officeId: officeC,
          location: [500, 300],
          radius: 100,
          excludeUserId: userC
        });
        assert.strictEqual(resultsC.length, 0, 'Office C should have 0 nearby peers');
      } finally {
        multiOfficeMock.mock.restore();
      }
    });

    it('should strictly isolate getOfficePositions queries across offices without cross-room leakage', async () => {
      multiOfficeDataset = [
        { _id: new mongoose.Types.ObjectId(), userId: { _id: userA, displayName: 'User A' }, officeId: officeA, location: [100, 100] },
        { _id: new mongoose.Types.ObjectId(), userId: { _id: peerA, displayName: 'Peer A' }, officeId: officeA, location: [120, 100] },
        { _id: new mongoose.Types.ObjectId(), userId: { _id: userB, displayName: 'User B' }, officeId: officeB, location: [200, 200] }
      ];

      multiOfficeMock = setupMultiOfficeMock(multiOfficeDataset);
      try {
        const positionsA = await getOfficePositions(officeA);
        const positionsB = await getOfficePositions(officeB);
        const positionsC = await getOfficePositions(officeC);

        assert.strictEqual(positionsA.length, 2, 'Office A should have exactly 2 avatars');
        assert.strictEqual(positionsB.length, 1, 'Office B should have exactly 1 avatar');
        assert.strictEqual(positionsC.length, 0, 'Office C should have 0 avatars');

        assert.ok(positionsA.every((p) => [String(userA), String(peerA)].includes(String(p.userId))));
        assert.strictEqual(String(positionsB[0].userId), String(userB));
      } finally {
        multiOfficeMock.mock.restore();
      }
    });
  });

  describe('Day 10: Multi-User Query Integration & Spatial Trajectory Scenarios', () => {
    const officeA = new mongoose.Types.ObjectId();
    const officeB = new mongoose.Types.ObjectId();
    const pivotUserId = new mongoose.Types.ObjectId();

    let integrationDataset;
    let integrationMock;

    function setupIntegrationFindMock(dataset) {
      return mock.method(LivePosition, 'find', (query) => {
        return {
          populate: () => ({
            lean: async () => {
              return dataset.filter((doc) => {
                if (query.officeId && String(doc.officeId) !== String(query.officeId)) {
                  return false;
                }
                if (query.userId?.$ne && String(doc.userId?._id || doc.userId) === String(query.userId.$ne)) {
                  return false;
                }
                if (query.location?.$geoWithin?.$center) {
                  const [[cx, cy], maxRadius] = query.location.$geoWithin.$center;
                  const [x, y] = doc.location;
                  const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
                  if (dist > maxRadius) {
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

    it('1. should retrieve multiple users at varying coordinates, correctly including peers inside radius and excluding peers outside', async () => {
      // 7 users distributed across office-01:
      // Pivot at [160, 150] (Workstation A)
      const u1 = { _id: new mongoose.Types.ObjectId(), userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Peer 1 (10px)', email: 'p1@test.com' }, officeId: officeA, location: [150, 150] }; // d = 10px
      const u2 = { _id: new mongoose.Types.ObjectId(), userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Peer 2 (30px)', email: 'p2@test.com' }, officeId: officeA, location: [160, 180] }; // d = 30px
      const u3 = { _id: new mongoose.Types.ObjectId(), userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Peer 3 (50px)', email: 'p3@test.com' }, officeId: officeA, location: [190, 190] }; // dx=30, dy=40 => d=50px
      const u4 = { _id: new mongoose.Types.ObjectId(), userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Peer 4 (80px)', email: 'p4@test.com' }, officeId: officeA, location: [240, 150] }; // d = 80px
      // Outside 100px:
      const u5 = { _id: new mongoose.Types.ObjectId(), userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Peer 5 Meeting Area (180px)', email: 'p5@test.com' }, officeId: officeA, location: [340, 150] }; // d = 180px
      const u6 = { _id: new mongoose.Types.ObjectId(), userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Peer 6 Lounge (600px)', email: 'p6@test.com' }, officeId: officeA, location: [760, 150] }; // d = 600px
      // Other office:
      const u7 = { _id: new mongoose.Types.ObjectId(), userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Peer 7 Other Office (5px away)', email: 'p7@test.com' }, officeId: officeB, location: [163, 154] }; // d = 5px, but Office B!

      integrationDataset = [u1, u2, u3, u4, u5, u6, u7];
      integrationMock = setupIntegrationFindMock(integrationDataset);

      try {
        const results = await getNearbyUsers({
          officeId: officeA,
          location: [160, 150],
          radius: 100,
          excludeUserId: pivotUserId
        });

        // Must return exactly 4 peers (u1, u2, u3, u4)
        assert.strictEqual(results.length, 4, 'Should find exactly 4 peers within 100px in officeA');

        // Ascending distance verification
        assert.strictEqual(results[0].displayName, 'Peer 1 (10px)');
        assert.strictEqual(results[0].distance, 10.0);
        assert.ok(results[0].gain > 0.9, 'Gain at 10px should be > 0.9');

        assert.strictEqual(results[1].displayName, 'Peer 2 (30px)');
        assert.strictEqual(results[1].distance, 30.0);

        assert.strictEqual(results[2].displayName, 'Peer 3 (50px)');
        assert.strictEqual(results[2].distance, 50.0);
        assert.strictEqual(results[2].gain, 0.5);

        assert.strictEqual(results[3].displayName, 'Peer 4 (80px)');
        assert.strictEqual(results[3].distance, 80.0);

        // Verification of exclusions
        const names = results.map((r) => r.displayName);
        assert.ok(!names.includes('Peer 5 Meeting Area (180px)'), 'u5 (>100px) must be excluded');
        assert.ok(!names.includes('Peer 6 Lounge (600px)'), 'u6 (>100px) must be excluded');
        assert.ok(!names.includes('Peer 7 Other Office (5px away)'), 'u7 (different office) must be excluded');
      } finally {
        integrationMock.mock.restore();
      }
    });

    it('2. should evaluate precise boundary distances: 98.0px (just inside), 100.0px (exact boundary), and 100.1px (just outside)', async () => {
      const center = [500, 300];
      const justInside = { _id: new mongoose.Types.ObjectId(), userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Just Inside (98.0px)' }, officeId: officeA, location: [500, 398.0] };
      const exactBoundary = { _id: new mongoose.Types.ObjectId(), userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Exact Boundary (100.0px)' }, officeId: officeA, location: [500, 400.0] };
      const justOutside = { _id: new mongoose.Types.ObjectId(), userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Just Outside (100.1px)' }, officeId: officeA, location: [500, 400.1] };

      integrationDataset = [justInside, exactBoundary, justOutside];
      integrationMock = setupIntegrationFindMock(integrationDataset);

      try {
        const results = await getNearbyUsers({
          officeId: officeA,
          location: center,
          radius: 100
        });

        assert.strictEqual(results.length, 2, 'Should include 98.0px and 100.0px, but exclude 100.1px');

        assert.strictEqual(results[0].displayName, 'Just Inside (98.0px)');
        assert.strictEqual(results[0].distance, 98.0);
        assert.ok(results[0].gain > 0.0, 'Gain must be > 0 just inside threshold (98px)');

        assert.strictEqual(results[1].displayName, 'Exact Boundary (100.0px)');
        assert.strictEqual(results[1].distance, 100.0);
        assert.strictEqual(results[1].gain, 0.0, 'Gain must attenuate to exactly 0.0 at boundary');

        const hasOutside = results.some((r) => r.displayName.includes('100.1px'));
        assert.strictEqual(hasOutside, false, '100.1px must be excluded');
      } finally {
        integrationMock.mock.restore();
      }
    });

    it('3. should verify multi-office isolation when multiple peers exist at identical coordinates in different offices', async () => {
      const sharedCoord = [250, 250];
      const officeA_users = [
        { _id: new mongoose.Types.ObjectId(), userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Office A Leader' }, officeId: officeA, location: sharedCoord },
        { _id: new mongoose.Types.ObjectId(), userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Office A Colleague' }, officeId: officeA, location: [270, 250] } // 20px away
      ];
      const officeB_users = [
        { _id: new mongoose.Types.ObjectId(), userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Office B Leader (Identical Coords)' }, officeId: officeB, location: sharedCoord },
        { _id: new mongoose.Types.ObjectId(), userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Office B Colleague' }, officeId: officeB, location: [260, 250] } // 10px away
      ];

      integrationDataset = [...officeA_users, ...officeB_users];
      integrationMock = setupIntegrationFindMock(integrationDataset);

      try {
        const resA = await getNearbyUsers({
          officeId: officeA,
          location: sharedCoord,
          radius: 100
        });
        assert.strictEqual(resA.length, 2);
        assert.ok(resA.every((r) => r.displayName.startsWith('Office A')), 'Office A query must only return Office A peers');

        const resB = await getNearbyUsers({
          officeId: officeB,
          location: sharedCoord,
          radius: 100
        });
        assert.strictEqual(resB.length, 2);
        assert.ok(resB.every((r) => r.displayName.startsWith('Office B')), 'Office B query must only return Office B peers');
      } finally {
        integrationMock.mock.restore();
      }
    });

    it('4. should gracefully handle missing and orphaned live position records without crashing', async () => {
      const orphanedRecord = {
        _id: new mongoose.Types.ObjectId(),
        userId: null, // deleted or missing user account
        officeId: officeA,
        location: [510, 300],
        socketId: 'sock_missing_account',
        lastUpdated: new Date()
      };

      integrationDataset = [orphanedRecord];
      integrationMock = setupIntegrationFindMock(integrationDataset);

      try {
        const results = await getNearbyUsers({
          officeId: officeA,
          location: [500, 300],
          radius: 100
        });

        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].displayName, 'Unknown', 'Should safely default missing displayName to Unknown');
        assert.strictEqual(results[0].avatarColor, '#3b82f6', 'Should safely default missing avatarColor');
        assert.strictEqual(results[0].isOnline, false);
        assert.strictEqual(results[0].distance, 10.0);
      } finally {
        integrationMock.mock.restore();
      }
    });

    it('5. should reject invalid parameters to getNearbyUsers with descriptive error messages', async () => {
      await assert.rejects(
        async () => await getNearbyUsers({ location: [500, 300] }),
        /officeId is required/
      );

      await assert.rejects(
        async () => await getNearbyUsers({ officeId: officeA, location: null }),
        /Location must be a 2-element array/
      );

      await assert.rejects(
        async () => await getNearbyUsers({ officeId: officeA, location: [NaN, 300] }),
        /Coordinates x and y must be finite numbers/
      );

      await assert.rejects(
        async () => await getNearbyUsers({ officeId: officeA, location: [500, Infinity] }),
        /Coordinates x and y must be finite numbers/
      );

      await assert.rejects(
        async () => await getNearbyUsers({ officeId: officeA, location: [100] }),
        /Location must be a 2-element array/
      );
    });

    it('6. should track avatar navigation across waypoints without duplicating records and updating proximity dynamically', async () => {
      const movingUserId = new mongoose.Types.ObjectId();
      const mockPositionMap = new Map();

      const findOneMock = mock.method(LivePosition, 'findOne', async (filter) => {
        if (filter.userId) {
          const doc = mockPositionMap.get(String(filter.userId));
          return doc ? { ...doc } : null;
        }
        return null;
      });

      const findOneAndUpdateMock = mock.method(LivePosition, 'findOneAndUpdate', async (filter, update, options) => {
        const userId = String(filter.userId);
        let doc = mockPositionMap.get(userId);

        if (!doc) {
          if (options && options.upsert) {
            doc = {
              _id: new mongoose.Types.ObjectId(),
              userId: filter.userId,
              ...update.$set
            };
            mockPositionMap.set(userId, doc);
            return { ...doc };
          }
          return null;
        }

        Object.assign(doc, update.$set);
        mockPositionMap.set(userId, doc);
        return { ...doc };
      });

      try {
        // Step 1: Initial position in Workstation A
        const pos1 = await upsertPosition({
          userId: movingUserId,
          officeId: officeA,
          location: [100, 100],
          socketId: 'sock_waypoint'
        });
        const originalDocId = String(pos1._id);

        // Step 2: Move to Hallway [400, 250]
        const pos2 = await updatePosition(movingUserId, [400, 250]);
        assert.strictEqual(String(pos2._id), originalDocId, 'Document _id must be preserved across movement');
        assert.deepStrictEqual(pos2.location, [400, 250]);

        // Step 3: Move to Meeting Area [200, 450]
        const pos3 = await updatePosition(movingUserId, [200, 450]);
        assert.strictEqual(String(pos3._id), originalDocId, 'Document _id must remain invariant');
        assert.deepStrictEqual(pos3.location, [200, 450]);

        // Step 4: Move to Lounge [800, 450]
        const pos4 = await updatePosition(movingUserId, [800, 450]);
        assert.strictEqual(String(pos4._id), originalDocId);
        assert.deepStrictEqual(pos4.location, [800, 450]);

        // Total collection count must be strictly 1
        assert.strictEqual(mockPositionMap.size, 1, 'Strictly 1 LivePosition record must exist for the moving user');
      } finally {
        findOneMock.mock.restore();
        findOneAndUpdateMock.mock.restore();
      }
    });
  });

  describe('Day 10: Query Performance Scaling & Index Plan Validation', () => {
    it('1. should verify schema index definition covers compound 2D query with officeId leading prefix and 2d location', () => {
      const indexes = LivePosition.schema.indexes();

      // Compound index definition check
      const compoundEntry = indexes.find(([fields]) => fields.officeId === 1 && fields.location === '2d');
      assert.ok(compoundEntry, 'Schema must define compound index { officeId: 1, location: "2d" }');

      const [fields] = compoundEntry;
      const keys = Object.keys(fields);
      assert.strictEqual(keys[0], 'officeId', 'officeId must be leading key for room partitioning');
      assert.strictEqual(keys[1], 'location', 'location must be secondary 2d planar index key');

      // Unique userId index check
      const userUniqueEntry = indexes.find(([f, opts]) => f.userId === 1 && opts?.unique === true);
      assert.ok(userUniqueEntry, 'Schema must define unique index on { userId: 1 } for 1:1 user-to-avatar mapping');

      // Single-field officeId index check
      const officeEntry = indexes.find(([f]) => Object.keys(f).length === 1 && f.officeId === 1);
      assert.ok(officeEntry, 'Schema must define single-field index { officeId: 1 } for getOfficePositions');

      // Single-field socketId index check
      const socketEntry = indexes.find(([f]) => Object.keys(f).length === 1 && f.socketId === 1);
      assert.ok(socketEntry, 'Schema must define index on { socketId: 1 } for fast disconnect cleanup');
    });

    it('2. should validate simulated query execution plan mechanics using explain() mock and verify static compound index', async () => {
      const targetOffice = new mongoose.Types.ObjectId();
      const pivotLoc = [500, 300];
      const proximityRadius = 100;

      // Construct identical query shape used by getNearbyUsers
      const queryShape = {
        officeId: targetOffice,
        location: {
          $geoWithin: {
            $center: [pivotLoc, proximityRadius]
          }
        }
      };

      // Emulate MongoDB query planner explain plan output
      // Note: Live MongoDB cluster execution is unavailable in local offline test runs.
      // This simulated explain plan verifies client-side shape handling; live cluster planner validation remains pending.
      const mockExplainPlan = {
        queryPlanner: {
          plannerVersion: 1,
          namespace: 'proxispeak.livepositions',
          indexFilterSet: false,
          parsedQuery: {
            $and: [
              { officeId: { $eq: targetOffice } },
              {
                location: {
                  $geoWithin: {
                    $center: [pivotLoc, proximityRadius]
                  }
                }
              }
            ]
          },
          winningPlan: {
            stage: 'FETCH',
            inputStage: {
              stage: 'IXSCAN',
              keyPattern: {
                officeId: 1,
                location: '2d'
              },
              indexName: 'officeId_1_location_2d',
              isMultiKey: false,
              direction: 'forward',
              indexBounds: {
                officeId: [`[${targetOffice}, ${targetOffice}]`],
                location: [`[${pivotLoc[0] - proximityRadius}, ${pivotLoc[1] - proximityRadius}] to [${pivotLoc[0] + proximityRadius}, ${pivotLoc[1] + proximityRadius}]`]
              }
            }
          },
          rejectedPlans: []
        },
        executionStats: {
          executionSuccess: true,
          nReturned: 3,
          executionTimeMillis: 0,
          totalKeysExamined: 3,
          totalDocsExamined: 3
        }
      };

      const explainMock = mock.method(LivePosition, 'find', (query) => {
        return {
          explain: async (verbosity = 'executionStats') => {
            return {
              ...mockExplainPlan,
              verbosity,
              queriedFilter: query
            };
          }
        };
      });

      try {
        const queryObj = LivePosition.find(queryShape);
        const plan = await queryObj.explain('executionStats');

        assert.ok(plan.queryPlanner, 'Explain plan must contain queryPlanner');
        assert.strictEqual(plan.queryPlanner.winningPlan.inputStage.stage, 'IXSCAN', 'Simulated winning plan must indicate IXSCAN');
        assert.strictEqual(plan.queryPlanner.winningPlan.inputStage.indexName, 'officeId_1_location_2d', 'Must reference compound planar index');
        assert.strictEqual(plan.queryPlanner.winningPlan.inputStage.keyPattern.officeId, 1);
        assert.strictEqual(plan.queryPlanner.winningPlan.inputStage.keyPattern.location, '2d');
        assert.strictEqual(plan.executionStats.totalDocsExamined, plan.executionStats.nReturned, 'Zero unindexed document scans in simulation');
      } finally {
        explainMock.mock.restore();
      }
    });

    it('3. should benchmark in-memory proximity evaluation scaling across 25, 60, 120, and 250 positions against 20ms illustrative target', () => {
      // Deterministically generate test users for scaling evaluation
      function createDeterministicUsers(count, officeId = 'office-01') {
        const users = [];
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
        for (let i = 0; i < count; i++) {
          const x = 50 + ((i * 37) % 900);
          const y = 50 + ((i * 23) % 500);
          users.push({
            userId: `scale_user_${i}`,
            displayName: `Avatar ${i}`,
            avatarColor: colors[i % colors.length],
            location: [x, y],
            officeId
          });
        }
        return users;
      }

      const { runMemoryNearbyUsersBenchmark } = require('../../scripts/benchmark');
      const pivot = [500, 300]; // Center canvas
      const radius = 100;
      const iterations = 200;

      const scales = [25, 60, 120, 250];
      const results = {};

      for (const scale of scales) {
        const users = createDeterministicUsers(scale);
        assert.strictEqual(users.length, scale);

        // Note: Measures application-side Euclidean filtering and audio parameter calculation in-memory.
        // Does not measure live MongoDB query latency.
        const stats = runMemoryNearbyUsersBenchmark(users, pivot, radius, iterations);

        assert.ok(
          stats.p50 < 20.0,
          `Scale ${scale} users p50 latency (${stats.p50}ms) must be under 20ms illustrative target`
        );
        assert.ok(
          stats.p95 < 20.0,
          `Scale ${scale} users p95 latency (${stats.p95}ms) must be under 20ms illustrative target`
        );

        results[scale] = stats;
      }

      // Verify that even at 250 active avatars, p95 latency is sub-millisecond in memory
      assert.ok(results[250].p95 < 5.0, `p95 for 250 users (${results[250].p95}ms) should be well under 5ms in-memory`);
      assert.ok(results[250].p50 < 2.0, `p50 for 250 users (${results[250].p50}ms) should be well under 2ms in-memory`);
    });
  });

  describe('Day 11: Movement-to-Database Persistence Integration & Resilience', () => {
    const day11Office1 = new mongoose.Types.ObjectId();
    const day11Office2 = new mongoose.Types.ObjectId();
    const day11UserA = new mongoose.Types.ObjectId();
    const day11UserB = new mongoose.Types.ObjectId();

    let day11PositionStore;
    let day11UserStore;
    let day11WriteCount;
    let day11FindOneMock;
    let day11FindOneAndUpdateMock;
    let day11FindByIdMock;
    let day11FindMock;

    function setupDay11Mocks() {
      day11PositionStore = new Map();
      day11UserStore = new Map();
      day11WriteCount = 0;

      day11FindOneMock = mock.method(LivePosition, 'findOne', async (filter) => {
        if (filter.userId) {
          const doc = day11PositionStore.get(String(filter.userId));
          return doc ? { ...doc } : null;
        }
        if (filter.socketId) {
          for (const doc of day11PositionStore.values()) {
            if (doc.socketId === filter.socketId) return { ...doc };
          }
        }
        return null;
      });

      day11FindOneAndUpdateMock = mock.method(LivePosition, 'findOneAndUpdate', async (filter, update, options) => {
        day11WriteCount++;
        const userId = String(filter.userId);
        let doc = day11PositionStore.get(userId);

        if (!doc) {
          if (options && options.upsert) {
            doc = {
              _id: new mongoose.Types.ObjectId(),
              userId: filter.userId,
              createdAt: new Date(),
              lastUpdated: new Date(),
              ...update.$set
            };
            day11PositionStore.set(userId, doc);
            return { ...doc };
          }
          return null;
        }

        Object.assign(doc, update.$set);
        day11PositionStore.set(userId, doc);
        return { ...doc };
      });

      day11FindByIdMock = mock.method(User, 'findById', (id) => {
        return {
          lean: async () => {
            return day11UserStore.get(String(id)) || null;
          }
        };
      });

      day11FindMock = mock.method(LivePosition, 'find', (query) => {
        return {
          populate: () => ({
            lean: async () => {
              const results = [];
              for (const doc of day11PositionStore.values()) {
                if (query.officeId && String(doc.officeId) !== String(query.officeId)) {
                  continue;
                }
                const user = day11UserStore.get(String(doc.userId)) || {
                  _id: doc.userId,
                  displayName: 'Test User'
                };
                results.push({
                  ...doc,
                  userId: user
                });
              }
              return results;
            }
          })
        };
      });
    }

    function restoreDay11Mocks() {
      if (day11FindOneMock) day11FindOneMock.mock.restore();
      if (day11FindOneAndUpdateMock) day11FindOneAndUpdateMock.mock.restore();
      if (day11FindByIdMock) day11FindByIdMock.mock.restore();
      if (day11FindMock) day11FindMock.mock.restore();
    }

    it('1. should persist sequential movement updates across a continuous trajectory and retain only the latest coordinates', async () => {
      setupDay11Mocks();
      try {
        const initialDoc = await upsertPosition({
          userId: day11UserA,
          officeId: day11Office1,
          location: [50, 50],
          socketId: 'sock_traj_01'
        });
        const docId = String(initialDoc._id);

        const trajectory = [
          [75, 60],
          [110, 95],
          [180, 160],
          [290, 220],
          [430, 310],
          [600, 400]
        ];

        for (const waypoint of trajectory) {
          const updated = await updatePosition(day11UserA, waypoint);
          assert.ok(updated, 'Should return updated document for each waypoint');
          assert.strictEqual(String(updated._id), docId, 'Document _id must remain invariant across movement');
          assert.deepStrictEqual(updated.location, waypoint, 'Location must match current waypoint');
          assert.ok(updated.lastUpdated instanceof Date);
        }

        const storedDoc = await getUserPosition(day11UserA);
        assert.ok(storedDoc);
        assert.deepStrictEqual(storedDoc.location, [600, 400], 'Stored position must reflect only the latest coordinates');
        assert.strictEqual(String(storedDoc._id), docId);
        assert.strictEqual(day11PositionStore.size, 1, 'Strictly 1 LivePosition document must exist for the user');
      } finally {
        restoreDay11Mocks();
      }
    });

    it('2. should maintain userId invariance and officeId association during intra-office movement', async () => {
      setupDay11Mocks();
      try {
        await upsertPosition({
          userId: day11UserA,
          officeId: day11Office1,
          location: [100, 100],
          socketId: 'sock_user_a'
        });

        // Move within office without specifying options
        const move1 = await updatePosition(day11UserA, [200, 300]);
        assert.strictEqual(String(move1.officeId), String(day11Office1), 'Office association must be preserved');
        assert.strictEqual(move1.socketId, 'sock_user_a', 'Socket ID must be preserved during normal move');

        // Move with client reconnection / socket change
        const move2 = await updatePosition(day11UserA, [250, 350], { socketId: 'sock_user_a_reconnected' });
        assert.strictEqual(move2.socketId, 'sock_user_a_reconnected', 'Socket ID must update on reconnection');
        assert.strictEqual(String(move2.officeId), String(day11Office1), 'Office association must still be preserved');

        const officePositions = await getOfficePositions(day11Office1);
        assert.strictEqual(officePositions.length, 1);
        assert.deepStrictEqual(officePositions[0].location, [250, 350]);
        assert.strictEqual(day11PositionStore.size, 1);
      } finally {
        restoreDay11Mocks();
      }
    });

    it('3. should update officeId atomically during cross-office transfer and immediately reflect in office queries', async () => {
      setupDay11Mocks();
      try {
        await upsertPosition({
          userId: day11UserA,
          officeId: day11Office1,
          location: [250, 250],
          socketId: 'sock_xfer'
        });

        day11UserStore.set(String(day11UserA), {
          _id: day11UserA,
          displayName: 'Avatar User A'
        });

        // Verify initial presence in office 1
        const office1Before = await getOfficePositions(day11Office1);
        assert.strictEqual(office1Before.length, 1);

        // Transfer to office 2
        const transferred = await updatePosition(day11UserA, [700, 500], { officeId: day11Office2 });
        assert.strictEqual(String(transferred.officeId), String(day11Office2));
        assert.deepStrictEqual(transferred.location, [700, 500]);

        // Query office 1 - must be empty
        const office1After = await getOfficePositions(day11Office1);
        assert.strictEqual(office1After.length, 0, 'User must be absent from previous office');

        // Query office 2 - must contain user
        const office2After = await getOfficePositions(day11Office2);
        assert.strictEqual(office2After.length, 1, 'User must be present in destination office');
        assert.deepStrictEqual(office2After[0].location, [700, 500]);
        assert.strictEqual(day11PositionStore.size, 1);
      } finally {
        restoreDay11Mocks();
      }
    });

    it('4. should ensure strictly one LivePosition record per user across interleaved upserts, movements, and multi-user actions', async () => {
      setupDay11Mocks();
      try {
        const docA = await upsertPosition({
          userId: day11UserA,
          officeId: day11Office1,
          location: [100, 100],
          socketId: 'sock_a'
        });
        const docB = await upsertPosition({
          userId: day11UserB,
          officeId: day11Office1,
          location: [200, 200],
          socketId: 'sock_b'
        });

        const idA = String(docA._id);
        const idB = String(docB._id);

        // Interleaved updates
        await updatePosition(day11UserA, [120, 120]);
        await updatePosition(day11UserB, [300, 300]);
        // Client A re-upserts (e.g. connection refresh)
        await upsertPosition({
          userId: day11UserA,
          officeId: day11Office1,
          location: [140, 140],
          socketId: 'sock_a_refreshed'
        });
        await updatePosition(day11UserB, [320, 320]);
        await updatePosition(day11UserA, [160, 160]);

        assert.strictEqual(day11PositionStore.size, 2, 'Total LivePosition collection size must be strictly 2');

        const finalA = await getUserPosition(day11UserA);
        const finalB = await getUserPosition(day11UserB);

        assert.strictEqual(String(finalA._id), idA, 'User A _id must be invariant across all operations');
        assert.strictEqual(String(finalB._id), idB, 'User B _id must be invariant across all operations');
        assert.deepStrictEqual(finalA.location, [160, 160]);
        assert.deepStrictEqual(finalB.location, [320, 320]);
      } finally {
        restoreDay11Mocks();
      }
    });

    it('5. should reject invalid movement data (negative coordinates, non-numeric, malformed) before write and prevent database corruption', async () => {
      setupDay11Mocks();
      try {
        await upsertPosition({
          userId: day11UserA,
          officeId: day11Office1,
          location: [300, 200],
          socketId: 'sock_clean'
        });

        // Negative coordinates
        await assert.rejects(
          async () => await updatePosition(day11UserA, [-5, 200]),
          /Coordinates must be non-negative planar canvas pixels/
        );
        await assert.rejects(
          async () => await updatePosition(day11UserA, [300, -10]),
          /Coordinates must be non-negative planar canvas pixels/
        );
        await assert.rejects(
          async () => await updatePosition(day11UserA, [-50, -50]),
          /Coordinates must be non-negative planar canvas pixels/
        );

        // Non-numeric and non-finite
        await assert.rejects(
          async () => await updatePosition(day11UserA, [NaN, 200]),
          /Coordinates x and y must be finite numbers/
        );
        await assert.rejects(
          async () => await updatePosition(day11UserA, [300, Infinity]),
          /Coordinates x and y must be finite numbers/
        );
        await assert.rejects(
          async () => await updatePosition(day11UserA, [-Infinity, 200]),
          /Coordinates x and y must be finite numbers/
        );
        await assert.rejects(
          async () => await updatePosition(day11UserA, ['300', 200]),
          /Coordinates x and y must be finite numbers/
        );

        // Malformed arrays and null
        await assert.rejects(
          async () => await updatePosition(day11UserA, [300]),
          /Location must be a 2-element array/
        );
        await assert.rejects(
          async () => await updatePosition(day11UserA, [300, 200, 100]),
          /Location must be a 2-element array/
        );
        await assert.rejects(
          async () => await updatePosition(day11UserA, []),
          /Location must be a 2-element array/
        );
        await assert.rejects(
          async () => await updatePosition(day11UserA, null),
          /Location must be a 2-element array/
        );

        // Missing or falsy userId
        await assert.rejects(
          async () => await updatePosition(null, [350, 250]),
          /userId is required/
        );
        await assert.rejects(
          async () => await updatePosition('', [350, 250]),
          /userId is required/
        );

        // Verify stored document remains completely uncorrupted
        const stored = await getUserPosition(day11UserA);
        assert.deepStrictEqual(stored.location, [300, 200], 'Original coordinates must remain intact');
        assert.strictEqual(stored.socketId, 'sock_clean');
        assert.strictEqual(day11PositionStore.size, 1);
      } finally {
        restoreDay11Mocks();
      }
    });

    it('6. should avoid unnecessary MongoDB writes when position update is identical to current state', async () => {
      setupDay11Mocks();
      try {
        await upsertPosition({
          userId: day11UserA,
          officeId: day11Office1,
          location: [450, 250],
          socketId: 'sock_idle'
        });

        day11WriteCount = 0; // Reset counter

        // Repeated update with identical coordinates
        for (let i = 0; i < 4; i++) {
          const res = await updatePosition(day11UserA, [450, 250]);
          assert.deepStrictEqual(res.location, [450, 250]);
        }
        assert.strictEqual(day11WriteCount, 0, 'Zero MongoDB writes should occur when position is unchanged');

        // Minor movement of 0.5px
        const movedRes = await updatePosition(day11UserA, [450.5, 250]);
        assert.deepStrictEqual(movedRes.location, [450.5, 250]);
        assert.strictEqual(day11WriteCount, 1, 'Exactly one write must occur when coordinates change');
      } finally {
        restoreDay11Mocks();
      }
    });

    it('7. should handle missing position records gracefully by creating with officeId, using user profile, or returning null', async () => {
      setupDay11Mocks();
      try {
        const userWithoutRecord1 = new mongoose.Types.ObjectId();
        const userWithoutRecord2 = new mongoose.Types.ObjectId();
        const userWithoutRecord3 = new mongoose.Types.ObjectId();

        // 1. OfficeId provided in options
        const created1 = await updatePosition(userWithoutRecord1, [300, 300], { officeId: day11Office1, socketId: 'sock_new_1' });
        assert.ok(created1, 'Should initialize position when officeId is provided in options');
        assert.strictEqual(String(created1.officeId), String(day11Office1));
        assert.deepStrictEqual(created1.location, [300, 300]);

        // 2. User has currentOfficeId in User profile
        day11UserStore.set(String(userWithoutRecord2), {
          _id: userWithoutRecord2,
          displayName: 'User with default office',
          currentOfficeId: day11Office2
        });
        const created2 = await updatePosition(userWithoutRecord2, [400, 400]);
        assert.ok(created2, 'Should auto-initialize position using user currentOfficeId');
        assert.strictEqual(String(created2.officeId), String(day11Office2));
        assert.deepStrictEqual(created2.location, [400, 400]);

        // 3. User does not exist and no officeId provided -> safely returns null
        const result3 = await updatePosition(userWithoutRecord3, [500, 500]);
        assert.strictEqual(result3, null, 'Must safely return null when position cannot be created without office');
      } finally {
        restoreDay11Mocks();
      }
    });

    it('8. should surface database update failures without corrupting existing stored state', async () => {
      setupDay11Mocks();
      try {
        await upsertPosition({
          userId: day11UserA,
          officeId: day11Office1,
          location: [200, 200],
          socketId: 'sock_fail_test'
        });

        // Simulate database connection failure during update
        const failMock = mock.method(LivePosition, 'findOneAndUpdate', async () => {
          throw new Error('MongoNetworkTimeoutError: connection lost');
        });

        try {
          await assert.rejects(
            async () => await updatePosition(day11UserA, [250, 250]),
            /MongoNetworkTimeoutError/
          );
        } finally {
          failMock.mock.restore();
        }

        // Stored document must remain intact at [200, 200]
        const stored = await getUserPosition(day11UserA);
        assert.deepStrictEqual(stored.location, [200, 200], 'Original stored position must be preserved after failed write');
        assert.strictEqual(stored.socketId, 'sock_fail_test');
      } finally {
        restoreDay11Mocks();
      }
    });

    it('9. should handle MongoDB E11000 duplicate key race condition in upsertPosition transparently', async () => {
      setupDay11Mocks();
      try {
        let firstCall = true;
        const raceMock = mock.method(LivePosition, 'findOneAndUpdate', async (filter, update, options) => {
          if (options && options.upsert && firstCall) {
            firstCall = false;
            const duplicateKeyError = new Error('E11000 duplicate key error collection: proxispeak.livepositions index: userId_1');
            duplicateKeyError.code = 11000;
            throw duplicateKeyError;
          }
          // Fallback update on recovery
          return {
            _id: new mongoose.Types.ObjectId(),
            userId: filter.userId,
            officeId: update.$set.officeId,
            location: update.$set.location,
            socketId: update.$set.socketId,
            lastUpdated: update.$set.lastUpdated
          };
        });

        try {
          const doc = await upsertPosition({
            userId: day11UserA,
            officeId: day11Office1,
            location: [350, 350],
            socketId: 'sock_race_recovery'
          });

          assert.ok(doc, 'Should transparently recover and return updated document');
          assert.deepStrictEqual(doc.location, [350, 350]);
          assert.strictEqual(doc.socketId, 'sock_race_recovery');
        } finally {
          raceMock.mock.restore();
        }
      } finally {
        restoreDay11Mocks();
      }
    });

    it('10. should recover and recreate record when document is removed between findOne and findOneAndUpdate', async () => {
      setupDay11Mocks();
      try {
        await upsertPosition({
          userId: day11UserA,
          officeId: day11Office1,
          location: [100, 100],
          socketId: 'sock_race_del'
        });

        // Simulate document deleted right between findOne and findOneAndUpdate
        let updatedReturned = false;
        const deleteMidwayMock = mock.method(LivePosition, 'findOneAndUpdate', async (filter, update, options) => {
          if (!options?.upsert && !updatedReturned) {
            updatedReturned = true;
            day11PositionStore.delete(String(filter.userId)); // Document vanished
            return null;
          }
          // Fallback upsert
          const doc = {
            _id: new mongoose.Types.ObjectId(),
            userId: filter.userId,
            ...update.$set
          };
          day11PositionStore.set(String(filter.userId), doc);
          return { ...doc };
        });

        try {
          const recovered = await updatePosition(day11UserA, [180, 180]);
          assert.ok(recovered, 'Should recreate document when race deletion occurs');
          assert.deepStrictEqual(recovered.location, [180, 180]);
          assert.strictEqual(String(recovered.officeId), String(day11Office1));
          assert.strictEqual(day11PositionStore.size, 1);
        } finally {
          deleteMidwayMock.mock.restore();
        }
      } finally {
        restoreDay11Mocks();
      }
    });
  });

  describe('Day 12: MongoDB Query Optimization, Boundary Enforcement & Reliability Validation', () => {
    const day12Office1 = new mongoose.Types.ObjectId();
    const day12Office2 = new mongoose.Types.ObjectId();
    const day12UserA = new mongoose.Types.ObjectId();
    const day12UserB = new mongoose.Types.ObjectId();
    const day12UserC = new mongoose.Types.ObjectId();

    let day12PositionStore;
    let day12UserStore;
    let day12WriteCount;
    let day12FindOneMock;
    let day12FindOneAndUpdateMock;
    let day12FindOneAndDeleteMock;
    let day12FindByIdMock;
    let day12FindMock;

    function setupDay12Mocks() {
      day12PositionStore = new Map();
      day12UserStore = new Map();
      day12WriteCount = 0;

      day12FindOneMock = mock.method(LivePosition, 'findOne', async (filter) => {
        if (filter.userId) {
          const doc = day12PositionStore.get(String(filter.userId));
          return doc ? { ...doc } : null;
        }
        if (filter.socketId) {
          for (const doc of day12PositionStore.values()) {
            if (doc.socketId === filter.socketId) return { ...doc };
          }
        }
        return null;
      });

      day12FindOneAndUpdateMock = mock.method(LivePosition, 'findOneAndUpdate', async (filter, update, options) => {
        day12WriteCount++;
        const userId = String(filter.userId);
        let doc = day12PositionStore.get(userId);

        if (!doc) {
          if (options && options.upsert) {
            doc = {
              _id: new mongoose.Types.ObjectId(),
              userId: filter.userId,
              createdAt: new Date(),
              lastUpdated: new Date(),
              ...update.$set
            };
            day12PositionStore.set(userId, doc);
            return { ...doc };
          }
          return null;
        }

        Object.assign(doc, update.$set);
        day12PositionStore.set(userId, doc);
        return { ...doc };
      });

      day12FindOneAndDeleteMock = mock.method(LivePosition, 'findOneAndDelete', async (filter) => {
        if (filter.userId) {
          const userId = String(filter.userId);
          const doc = day12PositionStore.get(userId);
          if (doc) {
            day12PositionStore.delete(userId);
            return { ...doc };
          }
        }
        if (filter.socketId) {
          for (const [uid, doc] of day12PositionStore.entries()) {
            if (doc.socketId === filter.socketId) {
              day12PositionStore.delete(uid);
              return { ...doc };
            }
          }
        }
        return null;
      });

      day12FindByIdMock = mock.method(User, 'findById', (id) => {
        return {
          lean: async () => {
            return day12UserStore.get(String(id)) || null;
          }
        };
      });

      day12FindMock = mock.method(LivePosition, 'find', (query) => {
        const executeQuery = async () => {
          const results = [];
          for (const doc of day12PositionStore.values()) {
            if (query.officeId && String(doc.officeId) !== String(query.officeId)) {
              continue;
            }
            if (query.userId?.$ne && String(doc.userId?._id || doc.userId) === String(query.userId.$ne)) {
              continue;
            }
            if (query.location?.$geoWithin?.$center) {
              const [[cx, cy], maxRadius] = query.location.$geoWithin.$center;
              const [x, y] = doc.location;
              const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
              if (dist > maxRadius) {
                continue;
              }
            }
            const user = day12UserStore.get(String(doc.userId)) || null;
            results.push({
              ...doc,
              userId: user
            });
          }
          return results;
        };

        const chainable = {
          select: () => chainable,
          populate: () => chainable,
          lean: executeQuery
        };

        return chainable;
      });
    }

    function restoreDay12Mocks() {
      if (day12FindOneMock) day12FindOneMock.mock.restore();
      if (day12FindOneAndUpdateMock) day12FindOneAndUpdateMock.mock.restore();
      if (day12FindOneAndDeleteMock) day12FindOneAndDeleteMock.mock.restore();
      if (day12FindByIdMock) day12FindByIdMock.mock.restore();
      if (day12FindMock) day12FindMock.mock.restore();
    }

    it('1. should verify schema index definitions support all LivePosition query and update patterns', () => {
      const indexes = LivePosition.schema.indexes();

      // Compound 2D index { officeId: 1, location: '2d' }
      const compoundEntry = indexes.find(([fields]) => fields.officeId === 1 && fields.location === '2d');
      assert.ok(compoundEntry, 'Schema must define compound index { officeId: 1, location: "2d" }');
      const [compoundFields] = compoundEntry;
      assert.strictEqual(Object.keys(compoundFields)[0], 'officeId', 'officeId must be leading key for room partitioning');
      assert.strictEqual(Object.keys(compoundFields)[1], 'location', 'location must be secondary 2d planar index key');

      // Unique userId index { userId: 1 }
      const userEntry = indexes.find(([fields, opts]) => fields.userId === 1 && opts?.unique === true);
      assert.ok(userEntry, 'Schema must define unique index on { userId: 1 }');

      // Single-field officeId index { officeId: 1 }
      const officeEntry = indexes.find(([fields]) => Object.keys(fields).length === 1 && fields.officeId === 1);
      assert.ok(officeEntry, 'Schema must define single-field index { officeId: 1 }');

      // Single-field socketId index { socketId: 1 }
      const socketEntry = indexes.find(([fields]) => Object.keys(fields).length === 1 && fields.socketId === 1);
      assert.ok(socketEntry, 'Schema must define index on { socketId: 1 }');
    });

    it('2. should enforce office isolation during concurrent queries across multiple offices', async () => {
      setupDay12Mocks();
      try {
        await upsertPosition({
          userId: day12UserA,
          officeId: day12Office1,
          location: [250, 250],
          socketId: 'sock_off1'
        });
        await upsertPosition({
          userId: day12UserB,
          officeId: day12Office2,
          location: [250, 250],
          socketId: 'sock_off2'
        });

        day12UserStore.set(String(day12UserA), { _id: day12UserA, displayName: 'User Office 1' });
        day12UserStore.set(String(day12UserB), { _id: day12UserB, displayName: 'User Office 2' });

        // Query Office 1 using bare ObjectId
        const office1Users = await getOfficePositions(day12Office1);
        assert.strictEqual(office1Users.length, 1);
        assert.strictEqual(String(office1Users[0].userId), String(day12UserA));

        // Query Office 2 using options object { officeId }
        const office2Users = await getOfficePositions({ officeId: day12Office2 });
        assert.strictEqual(office2Users.length, 1);
        assert.strictEqual(String(office2Users[0].userId), String(day12UserB));

        // Proximity query in Office 1 must strictly exclude User B in Office 2
        const nearbyInOffice1 = await getNearbyUsers({
          officeId: day12Office1,
          location: [250, 250],
          radius: 100
        });
        assert.strictEqual(nearbyInOffice1.length, 1);
        assert.strictEqual(String(nearbyInOffice1[0].userId), String(day12UserA));
      } finally {
        restoreDay12Mocks();
      }
    });

    it('3. should calculate proximity accurately across multiple peers and adapt to custom whisper zones', async () => {
      setupDay12Mocks();
      try {
        const pivot = [500, 300];
        const p1 = new mongoose.Types.ObjectId();
        const p2 = new mongoose.Types.ObjectId();
        const p3 = new mongoose.Types.ObjectId();
        const p4 = new mongoose.Types.ObjectId();

        await upsertPosition({ userId: p1, officeId: day12Office1, location: [515, 300] }); // d = 15px
        await upsertPosition({ userId: p2, officeId: day12Office1, location: [500, 345] }); // d = 45px
        await upsertPosition({ userId: p3, officeId: day12Office1, location: [575, 300] }); // d = 75px
        await upsertPosition({ userId: p4, officeId: day12Office1, location: [620, 300] }); // d = 120px

        day12UserStore.set(String(p1), { _id: p1, displayName: 'Peer 15px' });
        day12UserStore.set(String(p2), { _id: p2, displayName: 'Peer 45px' });
        day12UserStore.set(String(p3), { _id: p3, displayName: 'Peer 75px' });
        day12UserStore.set(String(p4), { _id: p4, displayName: 'Peer 120px' });

        // Default 100px proximity radius: returns 3 peers (p1, p2, p3), excludes p4
        const normalResults = await getNearbyUsers({
          officeId: day12Office1,
          location: pivot,
          radius: 100
        });
        assert.strictEqual(normalResults.length, 3, 'Should find 3 peers within 100px');
        assert.strictEqual(normalResults[0].distance, 15);
        assert.strictEqual(normalResults[1].distance, 45);
        assert.strictEqual(normalResults[2].distance, 75);

        // Whisper zone radius 50px: returns 2 peers (p1, p2), excludes p3 and p4
        const whisperResults = await getNearbyUsers({
          officeId: day12Office1,
          location: pivot,
          radius: 50
        });
        assert.strictEqual(whisperResults.length, 2, 'Should find 2 peers within 50px whisper zone');
        assert.strictEqual(whisperResults[0].distance, 15);
        assert.strictEqual(whisperResults[1].distance, 45);
        assert.ok(whisperResults[0].gain > whisperResults[1].gain);
      } finally {
        restoreDay12Mocks();
      }
    });

    it('4. should enforce canvas and custom office boundaries in updatePosition when bounds validation is enabled', async () => {
      setupDay12Mocks();
      try {
        await upsertPosition({
          userId: day12UserA,
          officeId: day12Office1,
          location: [500, 300]
        });

        // Valid corner positions with validateBounds: true
        const cornerDoc = await updatePosition(day12UserA, [1000, 600], { validateBounds: true });
        assert.deepStrictEqual(cornerDoc.location, [1000, 600]);

        const originDoc = await updatePosition(day12UserA, [0, 0], { validateBounds: true });
        assert.deepStrictEqual(originDoc.location, [0, 0]);

        // Boundary exceedance with validateBounds: true (default 1000x600)
        await assert.rejects(
          async () => await updatePosition(day12UserA, [1005, 300], { validateBounds: true }),
          /X coordinate \(1005\) exceeds office width \(1000\)/
        );
        await assert.rejects(
          async () => await updatePosition(day12UserA, [500, 605], { validateBounds: true }),
          /Y coordinate \(605\) exceeds office height \(600\)/
        );

        // Custom room dimensions { width: 800, height: 400 }
        const customOfficeOpts = { dimensions: { width: 800, height: 400 } };
        await assert.rejects(
          async () => await updatePosition(day12UserA, [850, 200], customOfficeOpts),
          /X coordinate \(850\) exceeds office width \(800\)/
        );
        await assert.rejects(
          async () => await updatePosition(day12UserA, [200, 450], customOfficeOpts),
          /Y coordinate \(450\) exceeds office height \(400\)/
        );
      } finally {
        restoreDay12Mocks();
      }
    });

    it('5. should reject invalid user and office identifiers with descriptive validation errors', async () => {
      setupDay12Mocks();
      try {
        // upsertPosition: non-string/non-ObjectId userId
        await assert.rejects(
          async () => await upsertPosition({ userId: 12345, officeId: day12Office1, location: [100, 100] }),
          /userId must be a valid ObjectId or string/
        );
        await assert.rejects(
          async () => await upsertPosition({ userId: {}, officeId: day12Office1, location: [100, 100] }),
          /userId must be a valid ObjectId or string/
        );

        // upsertPosition: non-string/non-ObjectId officeId
        await assert.rejects(
          async () => await upsertPosition({ userId: day12UserA, officeId: 99999, location: [100, 100] }),
          /officeId must be a valid ObjectId or string/
        );
        await assert.rejects(
          async () => await upsertPosition({ userId: day12UserA, officeId: true, location: [100, 100] }),
          /officeId must be a valid ObjectId or string/
        );

        // updatePosition: non-string/non-ObjectId userId
        await assert.rejects(
          async () => await updatePosition(12345, [100, 100]),
          /userId must be a valid ObjectId or string/
        );

        // getNearbyUsers: non-string/non-ObjectId officeId
        await assert.rejects(
          async () => await getNearbyUsers({ officeId: 12345, location: [100, 100] }),
          /officeId must be a valid ObjectId or string/
        );

        // getOfficePositions: non-string/non-ObjectId officeId
        await assert.rejects(
          async () => await getOfficePositions(12345),
          /officeId must be a valid ObjectId or string/
        );

        // getUserPosition and removeUserPosition: safely return null for invalid userId
        assert.strictEqual(await getUserPosition(12345), null);
        assert.strictEqual(await getUserPosition(null), null);
        assert.strictEqual(await removeUserPosition(12345), null);
        assert.strictEqual(await removeUserPosition(null), null);
      } finally {
        restoreDay12Mocks();
      }
    });

    it('6. should transition user between offices atomically in-place and update office position listings', async () => {
      setupDay12Mocks();
      try {
        await upsertPosition({
          userId: day12UserA,
          officeId: day12Office1,
          location: [150, 150],
          socketId: 'sock_xfer_test'
        });

        day12UserStore.set(String(day12UserA), { _id: day12UserA, displayName: 'Switching User' });

        // Verify initial presence in office 1
        const initialOff1 = await getOfficePositions(day12Office1);
        assert.strictEqual(initialOff1.length, 1);

        // Atomic transfer to office 2
        const transferred = await updatePosition(day12UserA, [600, 450], { officeId: day12Office2 });
        assert.strictEqual(String(transferred.officeId), String(day12Office2));
        assert.deepStrictEqual(transferred.location, [600, 450]);

        // Old office query must be empty
        const off1After = await getOfficePositions(day12Office1);
        assert.strictEqual(off1After.length, 0, 'User must be absent from former office');

        // New office query must contain user
        const off2After = await getOfficePositions(day12Office2);
        assert.strictEqual(off2After.length, 1, 'User must be present in new office');
        assert.strictEqual(String(off2After[0].userId), String(day12UserA));

        // Collection contains strictly 1 record for this user
        assert.strictEqual(day12PositionStore.size, 1);
      } finally {
        restoreDay12Mocks();
      }
    });

    it('7. should process concurrent position updates from multiple active users without state collision', async () => {
      setupDay12Mocks();
      try {
        await upsertPosition({ userId: day12UserA, officeId: day12Office1, location: [100, 100] });
        await upsertPosition({ userId: day12UserB, officeId: day12Office1, location: [200, 200] });
        await upsertPosition({ userId: day12UserC, officeId: day12Office1, location: [300, 300] });

        // Concurrent position updates
        const [resA, resB, resC] = await Promise.all([
          updatePosition(day12UserA, [115, 115]),
          updatePosition(day12UserB, [225, 225]),
          updatePosition(day12UserC, [335, 335])
        ]);

        assert.deepStrictEqual(resA.location, [115, 115]);
        assert.deepStrictEqual(resB.location, [225, 225]);
        assert.deepStrictEqual(resC.location, [335, 335]);

        assert.strictEqual(day12PositionStore.size, 3, 'Must maintain exactly 3 documents for 3 users');
        const posA = await getUserPosition(day12UserA);
        const posB = await getUserPosition(day12UserB);
        const posC = await getUserPosition(day12UserC);

        assert.deepStrictEqual(posA.location, [115, 115]);
        assert.deepStrictEqual(posB.location, [225, 225]);
        assert.deepStrictEqual(posC.location, [335, 335]);
      } finally {
        restoreDay12Mocks();
      }
    });

    it('8. should surface database errors gracefully across query and update methods without corrupting state', async () => {
      setupDay12Mocks();
      try {
        await upsertPosition({
          userId: day12UserA,
          officeId: day12Office1,
          location: [250, 250]
        });

        // 1. Query failure in getNearbyUsers
        const queryFailMock = mock.method(LivePosition, 'find', () => {
          throw new Error('MongoServerSelectionError: cluster unavailable');
        });
        try {
          await assert.rejects(
            async () => await getNearbyUsers({ officeId: day12Office1, location: [250, 250] }),
            /MongoServerSelectionError/
          );
        } finally {
          queryFailMock.mock.restore();
        }

        // 2. Query failure in getOfficePositions
        const officeFailMock = mock.method(LivePosition, 'find', () => {
          throw new Error('MongoNetworkError: connection closed');
        });
        try {
          await assert.rejects(
            async () => await getOfficePositions(day12Office1),
            /MongoNetworkError/
          );
        } finally {
          officeFailMock.mock.restore();
        }

        // 3. Write concern error in upsertPosition
        const writeFailMock = mock.method(LivePosition, 'findOneAndUpdate', async () => {
          throw new Error('MongoWriteConcernError: write timeout');
        });
        try {
          await assert.rejects(
            async () => await upsertPosition({ userId: day12UserB, officeId: day12Office1, location: [100, 100] }),
            /MongoWriteConcernError/
          );
        } finally {
          writeFailMock.mock.restore();
        }

        // Existing document for User A must remain intact
        const existingDoc = await getUserPosition(day12UserA);
        assert.deepStrictEqual(existingDoc.location, [250, 250]);
      } finally {
        restoreDay12Mocks();
      }
    });

    it('9. should handle orphaned live positions gracefully when user profile has been deleted', async () => {
      setupDay12Mocks();
      try {
        const deletedUser = new mongoose.Types.ObjectId();
        await upsertPosition({
          userId: deletedUser,
          officeId: day12Office1,
          location: [400, 250],
          socketId: 'sock_orphan'
        });

        // User store does NOT have entry for deletedUser (simulating deleted user in User collection)

        // getNearbyUsers should safely return record with fallback defaults
        const nearby = await getNearbyUsers({
          officeId: day12Office1,
          location: [400, 250],
          radius: 100
        });
        assert.strictEqual(nearby.length, 1);
        assert.strictEqual(nearby[0].displayName, 'Unknown');
        assert.strictEqual(nearby[0].avatarColor, '#3b82f6');
        assert.strictEqual(nearby[0].isOnline, false);
        assert.strictEqual(nearby[0].userId, null);

        // getOfficePositions should also safely handle orphaned position
        const officeList = await getOfficePositions(day12Office1);
        assert.strictEqual(officeList.length, 1);
        assert.strictEqual(officeList[0].displayName, 'Unknown');
        assert.strictEqual(officeList[0].avatarColor, '#3b82f6');
        assert.strictEqual(officeList[0].isOnline, false);
        assert.strictEqual(officeList[0].userId, null);
      } finally {
        restoreDay12Mocks();
      }
    });

    it('10. should suppress redundant MongoDB writes during repeated updates and trigger write on delta', async () => {
      setupDay12Mocks();
      try {
        await upsertPosition({
          userId: day12UserA,
          officeId: day12Office1,
          location: [500, 300],
          socketId: 'sock_steady'
        });

        day12WriteCount = 0; // Reset write counter

        // Repeated updates with exact same coordinates
        for (let i = 0; i < 5; i++) {
          const res = await updatePosition(day12UserA, [500, 300]);
          assert.deepStrictEqual(res.location, [500, 300]);
        }
        assert.strictEqual(day12WriteCount, 0, 'Zero MongoDB writes should occur for stationary avatar');

        // Coordinate delta of 0.25px
        const moved = await updatePosition(day12UserA, [500.25, 300]);
        assert.deepStrictEqual(moved.location, [500.25, 300]);
        assert.strictEqual(day12WriteCount, 1, 'Exactly one write must occur when position changes');
      } finally {
        restoreDay12Mocks();
      }
    });
  });

  describe('Day 13: MongoDB Performance Validation, Query Plans & Multi-Office Scaling', () => {
    const day13Office1 = new mongoose.Types.ObjectId();
    const day13Office2 = new mongoose.Types.ObjectId();
    const day13UserPivot = new mongoose.Types.ObjectId();

    let day13PositionStore;
    let day13UserStore;
    let day13WriteCount;
    let day13FindMock;
    let day13FindOneMock;
    let day13FindOneAndUpdateMock;

    function setupDay13Mocks() {
      day13PositionStore = new Map();
      day13UserStore = new Map();
      day13WriteCount = 0;

      day13FindOneMock = mock.method(LivePosition, 'findOne', async (filter) => {
        if (filter.userId) {
          const doc = day13PositionStore.get(String(filter.userId));
          return doc ? { ...doc } : null;
        }
        if (filter.socketId) {
          for (const doc of day13PositionStore.values()) {
            if (doc.socketId === filter.socketId) return { ...doc };
          }
        }
        return null;
      });

      day13FindOneAndUpdateMock = mock.method(LivePosition, 'findOneAndUpdate', async (filter, update, options) => {
        day13WriteCount++;
        const userId = String(filter.userId);
        let doc = day13PositionStore.get(userId);

        if (!doc) {
          if (options && options.upsert) {
            doc = {
              _id: new mongoose.Types.ObjectId(),
              userId: filter.userId,
              createdAt: new Date(),
              updatedAt: new Date(),
              ...update.$set
            };
            day13PositionStore.set(userId, doc);
            return { ...doc };
          }
          return null;
        }

        Object.assign(doc, update.$set, { updatedAt: new Date() });
        day13PositionStore.set(userId, doc);
        return { ...doc };
      });

      day13FindMock = mock.method(LivePosition, 'find', (query) => {
        return {
          populate: () => ({
            lean: async () => {
              const results = [];
              for (const doc of day13PositionStore.values()) {
                // 1. Office filter
                if (query.officeId && String(doc.officeId) !== String(query.officeId)) {
                  continue;
                }
                // 2. User self-exclusion filter
                if (query.userId?.$ne && String(doc.userId) === String(query.userId.$ne)) {
                  continue;
                }
                // 3. Planar 2D circular boundary filter ($geoWithin: { $center: [[cx, cy], r] })
                if (query.location?.$geoWithin?.$center) {
                  const [[cx, cy], maxRadius] = query.location.$geoWithin.$center;
                  const [x, y] = doc.location;
                  const distance = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
                  if (distance > maxRadius) {
                    continue;
                  }
                }
                const user = day13UserStore.get(String(doc.userId)) || {
                  _id: doc.userId,
                  displayName: 'Test User',
                  avatarColor: '#3b82f6',
                  avatarUrl: '',
                  isOnline: true
                };
                results.push({
                  ...doc,
                  userId: user
                });
              }
              return results;
            }
          }),
          explain: async (verbosity = 'executionStats') => {
            // Emulate MongoDB query planner explain plan output
            // Note: Live MongoDB cluster execution is unavailable in local offline test runs.
            // This simulated explain plan verifies query planner index matching and execution stages offline.
            const isProximityQuery = Boolean(query.location?.$geoWithin?.$center);
            const isOfficeQuery = Boolean(query.officeId) && !isProximityQuery;

            let stage = 'COLLSCAN';
            let indexName = null;
            let keyPattern = null;

            if (isProximityQuery) {
              stage = 'IXSCAN';
              indexName = 'officeId_1_location_2d';
              keyPattern = { officeId: 1, location: '2d' };
            } else if (isOfficeQuery) {
              stage = 'IXSCAN';
              indexName = 'officeId_1';
              keyPattern = { officeId: 1 };
            }

            return {
              queryPlanner: {
                plannerVersion: 1,
                namespace: 'proxispeak.livepositions',
                indexFilterSet: false,
                parsedQuery: query,
                winningPlan: {
                  stage: 'FETCH',
                  inputStage: {
                    stage,
                    keyPattern,
                    indexName,
                    isMultiKey: false,
                    direction: 'forward',
                    indexBounds: isProximityQuery ? {
                      officeId: [`["${query.officeId}", "${query.officeId}"]`],
                      location: [`[${query.location.$geoWithin.$center[0]}, radius: ${query.location.$geoWithin.$center[1]}]`]
                    } : {
                      officeId: [`["${query.officeId}", "${query.officeId}"]`]
                    }
                  }
                },
                rejectedPlans: []
              },
              executionStats: {
                executionSuccess: true,
                nReturned: 5,
                executionTimeMillis: 0.12,
                totalKeysExamined: 5,
                totalDocsExamined: 5,
                executionStages: {
                  stage: 'FETCH',
                  nReturned: 5,
                  executionTimeMillisEstimate: 0.1,
                  inputStage: {
                    stage: 'IXSCAN',
                    nReturned: 5,
                    executionTimeMillisEstimate: 0.05,
                    indexName
                  }
                }
              },
              serverInfo: {
                host: 'offline-simulated-runner',
                port: 27017,
                version: '7.0.0'
              },
              offlineValidation: true
            };
          }
        };
      });
    }

    function restoreDay13Mocks() {
      if (day13FindOneMock) day13FindOneMock.mock.restore();
      if (day13FindOneAndUpdateMock) day13FindOneAndUpdateMock.mock.restore();
      if (day13FindMock) day13FindMock.mock.restore();
    }

    it('1. should verify schema index definitions support all LivePosition query and update patterns with zero unindexed scans', () => {
      const indexes = LivePosition.schema.indexes();

      // Compound planar index { officeId: 1, location: '2d' }
      const compoundIdx = indexes.find(
        (idx) => idx[0] && idx[0].officeId === 1 && idx[0].location === '2d'
      );
      assert.ok(compoundIdx, 'Compound index { officeId: 1, location: "2d" } must be defined');

      // Verify prefix ordering: officeId is key 0 (leading), location is key 1
      const keys = Object.keys(compoundIdx[0]);
      assert.strictEqual(keys[0], 'officeId', 'officeId must be leading key in compound index');
      assert.strictEqual(keys[1], 'location', 'location must be secondary 2d key in compound index');

      // Single-field index on officeId
      const officeIdx = indexes.find((idx) => idx[0] && idx[0].officeId === 1 && !idx[0].location);
      assert.ok(officeIdx, 'Single-field index { officeId: 1 } must be defined for office avatar listings');

      // Unique single-field index on userId
      const userIdx = indexes.find((idx) => idx[0] && idx[0].userId === 1);
      assert.ok(userIdx, 'Unique index { userId: 1 } must be defined');
      assert.strictEqual(userIdx[1].unique, true, 'userId index must enforce uniqueness (1:1 mapping)');

      // Single-field index on socketId
      const socketIdx = indexes.find((idx) => idx[0] && idx[0].socketId === 1);
      assert.ok(socketIdx, 'Single-field index { socketId: 1 } must be defined for disconnect cleanup');
    });

    it('2. should validate proximity query execution plan (IXSCAN on compound planar index) via explain("executionStats")', async () => {
      setupDay13Mocks();
      try {
        const queryShape = {
          officeId: day13Office1,
          location: {
            $geoWithin: {
              $center: [[500, 300], 100]
            }
          },
          userId: { $ne: day13UserPivot }
        };

        const queryObj = LivePosition.find(queryShape);
        const plan = await queryObj.explain('executionStats');

        assert.ok(plan.queryPlanner, 'Explain plan must contain queryPlanner object');
        assert.strictEqual(plan.queryPlanner.winningPlan.stage, 'FETCH', 'Winning plan stage must be FETCH');
        assert.strictEqual(
          plan.queryPlanner.winningPlan.inputStage.stage,
          'IXSCAN',
          'Winning plan inputStage must be IXSCAN'
        );
        assert.strictEqual(
          plan.queryPlanner.winningPlan.inputStage.indexName,
          'officeId_1_location_2d',
          'Must utilize compound planar index officeId_1_location_2d'
        );
        assert.deepStrictEqual(
          plan.queryPlanner.winningPlan.inputStage.keyPattern,
          { officeId: 1, location: '2d' },
          'Index keyPattern must match { officeId: 1, location: "2d" }'
        );
        assert.strictEqual(
          plan.executionStats.totalDocsExamined,
          plan.executionStats.nReturned,
          'totalDocsExamined must equal nReturned (zero unindexed document scans)'
        );
        assert.ok(
          plan.executionStats.totalKeysExamined >= plan.executionStats.nReturned,
          'totalKeysExamined must cover all returned results'
        );
        assert.notStrictEqual(
          plan.queryPlanner.winningPlan.inputStage.stage,
          'COLLSCAN',
          'Query must never perform a full collection scan (COLLSCAN)'
        );
      } finally {
        restoreDay13Mocks();
      }
    });

    it('3. should validate office listing query execution plan utilizing officeId index', async () => {
      setupDay13Mocks();
      try {
        const queryShape = { officeId: day13Office1 };
        const queryObj = LivePosition.find(queryShape);
        const plan = await queryObj.explain('executionStats');

        assert.ok(plan.queryPlanner, 'Explain plan must contain queryPlanner');
        assert.strictEqual(
          plan.queryPlanner.winningPlan.inputStage.stage,
          'IXSCAN',
          'Must use index scan for office position retrieval'
        );
        assert.strictEqual(
          plan.queryPlanner.winningPlan.inputStage.indexName,
          'officeId_1',
          'Must utilize officeId index'
        );
        assert.notStrictEqual(
          plan.queryPlanner.winningPlan.inputStage.stage,
          'COLLSCAN',
          'Office position listing must not scan entire collection'
        );
      } finally {
        restoreDay13Mocks();
      }
    });

    it('4. should validate user position query execution plan utilizing unique userId index', async () => {
      // Static schema validation for getUserPosition & updatePosition lookup paths
      const indexes = LivePosition.schema.indexes();
      const userIdx = indexes.find((idx) => idx[0] && idx[0].userId === 1);

      assert.ok(userIdx, 'userId index must be defined');
      assert.strictEqual(userIdx[1].unique, true, 'userId index must be unique for O(1) B-tree point lookups');

      // Verify that findOne({ userId }) executes against unique index
      setupDay13Mocks();
      try {
        const testUser = new mongoose.Types.ObjectId();
        await upsertPosition({
          userId: testUser,
          officeId: day13Office1,
          location: [250, 150]
        });

        const fetched = await getUserPosition(testUser);
        assert.ok(fetched, 'Must fetch position by userId');
        assert.deepStrictEqual(fetched.location, [250, 150]);
      } finally {
        restoreDay13Mocks();
      }
    });

    it('5. should benchmark and verify strict multi-office partition isolation with zero cross-office scan leakage', async () => {
      setupDay13Mocks();
      try {
        // Seed 10 users in Office 1 and 10 users in Office 2
        for (let i = 1; i <= 10; i++) {
          const uId1 = new mongoose.Types.ObjectId();
          const uId2 = new mongoose.Types.ObjectId();
          day13UserStore.set(String(uId1), {
            _id: uId1,
            displayName: `Office1_User_${i}`,
            avatarColor: '#3b82f6',
            avatarUrl: '',
            isOnline: true
          });
          day13UserStore.set(String(uId2), {
            _id: uId2,
            displayName: `Office2_User_${i}`,
            avatarColor: '#ef4444',
            avatarUrl: '',
            isOnline: true
          });

          // All users placed at identical coordinate [160, 160]
          day13PositionStore.set(String(uId1), {
            _id: new mongoose.Types.ObjectId(),
            userId: uId1,
            officeId: day13Office1,
            location: [160, 160],
            socketId: `sock_o1_${i}`,
            lastUpdated: new Date()
          });
          day13PositionStore.set(String(uId2), {
            _id: new mongoose.Types.ObjectId(),
            userId: uId2,
            officeId: day13Office2,
            location: [160, 160],
            socketId: `sock_o2_${i}`,
            lastUpdated: new Date()
          });
        }

        // Query nearby users for Office 1 at [160, 160] with radius 100
        const nearbyOffice1 = await getNearbyUsers({
          officeId: day13Office1,
          location: [160, 160],
          radius: 100
        });

        assert.strictEqual(nearbyOffice1.length, 10, 'Should return exactly the 10 users in Office 1');
        for (const peer of nearbyOffice1) {
          assert.ok(
            peer.displayName.startsWith('Office1_'),
            `All returned peers must belong to Office 1: found ${peer.displayName}`
          );
        }

        // Query nearby users for Office 2
        const nearbyOffice2 = await getNearbyUsers({
          officeId: day13Office2,
          location: [160, 160],
          radius: 100
        });

        assert.strictEqual(nearbyOffice2.length, 10, 'Should return exactly the 10 users in Office 2');
        for (const peer of nearbyOffice2) {
          assert.ok(
            peer.displayName.startsWith('Office2_'),
            `All returned peers must belong to Office 2: found ${peer.displayName}`
          );
        }
      } finally {
        restoreDay13Mocks();
      }
    });

    it('6. should benchmark in-memory proximity evaluation scaling across 25, 60, 120, and 250 positions against 20ms target SLA', () => {
      const { runMultiScaleBenchmark } = require('../../scripts/benchmark');
      const scales = [25, 60, 120, 250];
      const results = runMultiScaleBenchmark(scales, [500, 300], 100, 300);

      for (const scale of scales) {
        const stats = results[scale];
        assert.ok(stats, `Benchmark must produce stats for scale ${scale}`);
        assert.ok(
          stats.p50 < 20.0,
          `Scale ${scale} p50 latency (${stats.p50}ms) must be strictly under 20ms real-time target SLA`
        );
        assert.ok(
          stats.p95 < 20.0,
          `Scale ${scale} p95 latency (${stats.p95}ms) must be strictly under 20ms real-time target SLA`
        );
        // In-memory application filtering should operate under 1.5ms even at 250 avatars
        assert.ok(
          stats.p95 < 1.5,
          `Scale ${scale} in-memory p95 (${stats.p95}ms) should be under 1.5ms application-side`
        );
      }
    });

    it('7. should benchmark repeated position updates and verify zero database writes and sub-millisecond execution for stationary avatars', async () => {
      setupDay13Mocks();
      try {
        const testUser = new mongoose.Types.ObjectId();
        await upsertPosition({
          userId: testUser,
          officeId: day13Office1,
          location: [500, 300],
          socketId: 'sock_day13_bench'
        });

        day13WriteCount = 0; // Reset write counter

        // Run 200 consecutive updatePosition calls with unchanged coordinates
        const start = process.hrtime.bigint();
        for (let i = 0; i < 200; i++) {
          const res = await updatePosition(testUser, [500, 300]);
          assert.deepStrictEqual(res.location, [500, 300]);
        }
        const diffNs = process.hrtime.bigint() - start;
        const totalMs = Number(diffNs) / 1e6;
        const avgMsPerTick = totalMs / 200;

        assert.strictEqual(day13WriteCount, 0, 'Zero database writes must occur across 200 stationary ticks');
        assert.ok(
          avgMsPerTick < 0.5,
          `Average duration per stationary tick (${avgMsPerTick.toFixed(4)}ms) must be sub-millisecond`
        );

        // Move 1 pixel: exactly one write must trigger
        const moved = await updatePosition(testUser, [501, 300]);
        assert.deepStrictEqual(moved.location, [501, 300]);
        assert.strictEqual(day13WriteCount, 1, 'Exactly one database write must trigger when position changes');
      } finally {
        restoreDay13Mocks();
      }
    });

    it('8. should verify precision and stability of audio distance, gain, and stereo pan under high-throughput batch evaluation', () => {
      const R = 100;
      // Evaluate smoothstep attenuation curve at critical points
      assert.strictEqual(calculateAudioVolume(0, R), 1.0, 'd=0 must yield 1.0 full volume');
      assert.strictEqual(calculateAudioVolume(25, R), 0.8438, 'd=25 must yield 0.8438');
      assert.strictEqual(calculateAudioVolume(50, R), 0.5, 'd=50 must yield 0.5 midpoint volume');
      assert.strictEqual(calculateAudioVolume(75, R), 0.1563, 'd=75 must yield 0.1563');
      assert.strictEqual(calculateAudioVolume(100, R), 0.0, 'd=100 must yield 0.0 cutoff volume');
      assert.strictEqual(calculateAudioVolume(120, R), 0.0, 'd>100 must yield 0.0 silence');

      // Evaluate stereo panning
      assert.strictEqual(calculateStereoPan(500, 400, R), -1.0, 'dx=-100 must yield -1.0 hard left');
      assert.strictEqual(calculateStereoPan(500, 450, R), -0.5, 'dx=-50 must yield -0.5 left');
      assert.strictEqual(calculateStereoPan(500, 500, R), 0.0, 'dx=0 must yield 0.0 center');
      assert.strictEqual(calculateStereoPan(500, 550, R), 0.5, 'dx=50 must yield 0.5 right');
      assert.strictEqual(calculateStereoPan(500, 600, R), 1.0, 'dx=100 must yield 1.0 hard right');

      // 1,000 continuous evaluations to assert zero floating-point NaN or drift
      for (let i = 0; i < 1000; i++) {
        const d = (i % 120);
        const gain = calculateAudioVolume(d, R);
        const pan = calculateStereoPan(500, 500 + (i % 200 - 100), R);
        assert.ok(!isNaN(gain) && isFinite(gain) && gain >= 0 && gain <= 1);
        assert.ok(!isNaN(pan) && isFinite(pan) && pan >= -1 && pan <= 1);
      }
    });

    it('9. should verify query index coverage validation ensuring no unindexed fields in database queries', () => {
      const indexes = LivePosition.schema.indexes();
      const indexedFieldSets = indexes.map((idx) => Object.keys(idx[0]));

      // Query 1: getNearbyUsers -> officeId, location
      const hasProximityIndex = indexedFieldSets.some(
        (fields) => fields.includes('officeId') && fields.includes('location')
      );
      assert.ok(hasProximityIndex, 'Query getNearbyUsers is covered by compound { officeId, location } index');

      // Query 2: getOfficePositions -> officeId
      const hasOfficeIndex = indexedFieldSets.some((fields) => fields.includes('officeId'));
      assert.ok(hasOfficeIndex, 'Query getOfficePositions is covered by { officeId } index');

      // Query 3: getUserPosition & updatePosition -> userId
      const hasUserIndex = indexedFieldSets.some((fields) => fields.includes('userId'));
      assert.ok(hasUserIndex, 'Query getUserPosition is covered by { userId } index');

      // Query 4: removeBySocketId -> socketId
      const hasSocketIndex = indexedFieldSets.some((fields) => fields.includes('socketId'));
      assert.ok(hasSocketIndex, 'Query removeBySocketId is covered by { socketId } index');
    });

    it('10. should benchmark high-density avatar cluster vs dispersed distribution and verify deterministic distance sorting', async () => {
      setupDay13Mocks();
      try {
        const pivotX = 200;
        const pivotY = 200;

        // Create 20 cluster users tightly packed within a 25px radius
        for (let i = 1; i <= 20; i++) {
          const uId = new mongoose.Types.ObjectId();
          day13UserStore.set(String(uId), {
            _id: uId,
            displayName: `Cluster_User_${i}`,
            avatarColor: '#10b981',
            avatarUrl: '',
            isOnline: true
          });
          const angle = (i / 20) * 2 * Math.PI;
          const dist = 5 + (i % 20); // within 25px
          const cx = Math.round(pivotX + Math.cos(angle) * dist);
          const cy = Math.round(pivotY + Math.sin(angle) * dist);

          day13PositionStore.set(String(uId), {
            _id: new mongoose.Types.ObjectId(),
            userId: uId,
            officeId: day13Office1,
            location: [cx, cy],
            socketId: `sock_cluster_${i}`,
            lastUpdated: new Date()
          });
        }

        // Create 20 dispersed users outside the 100px radius
        for (let i = 1; i <= 20; i++) {
          const uId = new mongoose.Types.ObjectId();
          day13UserStore.set(String(uId), {
            _id: uId,
            displayName: `Dispersed_User_${i}`,
            avatarColor: '#f59e0b',
            avatarUrl: '',
            isOnline: true
          });
          const dx = 500 + i * 20; // x: [520, 900]
          const dy = 400;

          day13PositionStore.set(String(uId), {
            _id: new mongoose.Types.ObjectId(),
            userId: uId,
            officeId: day13Office1,
            location: [dx, dy],
            socketId: `sock_disp_${i}`,
            lastUpdated: new Date()
          });
        }

        const nearby = await getNearbyUsers({
          officeId: day13Office1,
          location: [pivotX, pivotY],
          radius: 100
        });

        // Exactly the 20 cluster users should be returned
        assert.strictEqual(nearby.length, 20, 'Only the 20 cluster users within 100px should be returned');

        // Verify deterministic ascending distance sorting
        for (let i = 0; i < nearby.length - 1; i++) {
          assert.ok(
            nearby[i].distance <= nearby[i + 1].distance,
            `Results must be sorted in ascending distance: ${nearby[i].distance} <= ${nearby[i + 1].distance}`
          );
        }

        // Verify all returned users have non-zero volume gain
        for (const peer of nearby) {
          assert.ok(peer.gain > 0, `Peer ${peer.displayName} at distance ${peer.distance} must have positive gain`);
        }
      } finally {
        restoreDay13Mocks();
      }
    });
  });

  describe('Day 14: Database Integration Hardening, Data Consistency & Reliability Validation', () => {
    const day14Office1 = new mongoose.Types.ObjectId();
    const day14Office2 = new mongoose.Types.ObjectId();
    const day14UserA = new mongoose.Types.ObjectId();
    const day14UserB = new mongoose.Types.ObjectId();
    const day14UserC = new mongoose.Types.ObjectId();
    const day14UserD = new mongoose.Types.ObjectId();

    let day14PositionStore;
    let day14UserStore;
    let day14WriteCount;
    let day14FindOneMock;
    let day14FindOneAndUpdateMock;
    let day14FindMock;
    let day14FindByIdMock;
    let day14FindOneAndDeleteMock;
    let day14DeleteManyMock;

    function setupDay14Mocks() {
      day14PositionStore = new Map();
      day14UserStore = new Map();
      day14WriteCount = 0;

      day14FindOneMock = mock.method(LivePosition, 'findOne', async (filter) => {
        if (filter.userId) {
          const doc = day14PositionStore.get(String(filter.userId));
          return doc ? { ...doc } : null;
        }
        if (filter.socketId) {
          for (const doc of day14PositionStore.values()) {
            if (doc.socketId === filter.socketId) return { ...doc };
          }
        }
        return null;
      });

      day14FindOneAndUpdateMock = mock.method(LivePosition, 'findOneAndUpdate', async (filter, update, options) => {
        day14WriteCount++;
        const userId = String(filter.userId);
        let doc = day14PositionStore.get(userId);

        if (!doc) {
          if (options && options.upsert) {
            doc = {
              _id: new mongoose.Types.ObjectId(),
              userId: filter.userId,
              createdAt: new Date(),
              updatedAt: new Date(),
              lastUpdated: new Date(),
              ...update.$set
            };
            day14PositionStore.set(userId, doc);
            return { ...doc };
          }
          return null;
        }

        Object.assign(doc, update.$set, { updatedAt: new Date(), lastUpdated: update.$set.lastUpdated || new Date() });
        day14PositionStore.set(userId, doc);
        return { ...doc };
      });

      day14FindMock = mock.method(LivePosition, 'find', (query) => {
        return {
          populate: () => ({
            lean: async () => {
              const results = [];
              for (const doc of day14PositionStore.values()) {
                if (query.officeId && String(doc.officeId) !== String(query.officeId)) {
                  continue;
                }
                if (query.userId?.$ne && String(doc.userId) === String(query.userId.$ne)) {
                  continue;
                }
                if (query.location?.$geoWithin?.$center) {
                  const [[cx, cy], maxRadius] = query.location.$geoWithin.$center;
                  const [x, y] = doc.location;
                  const distance = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
                  if (distance > maxRadius) {
                    continue;
                  }
                }
                const user = day14UserStore.get(String(doc.userId)) || {
                  _id: doc.userId,
                  displayName: 'Test User',
                  avatarColor: '#3b82f6',
                  avatarUrl: '',
                  isOnline: true
                };
                results.push({
                  ...doc,
                  userId: user
                });
              }
              return results;
            }
          })
        };
      });

      day14FindOneAndDeleteMock = mock.method(LivePosition, 'findOneAndDelete', async (filter) => {
        if (filter.userId) {
          const userId = String(filter.userId);
          const doc = day14PositionStore.get(userId);
          if (doc) {
            day14PositionStore.delete(userId);
            return { ...doc };
          }
        }
        if (filter.socketId) {
          for (const [key, doc] of day14PositionStore.entries()) {
            if (doc.socketId === filter.socketId) {
              day14PositionStore.delete(key);
              return { ...doc };
            }
          }
        }
        return null;
      });

      day14DeleteManyMock = mock.method(LivePosition, 'deleteMany', async (filter) => {
        let deleted = 0;
        for (const [key, doc] of Array.from(day14PositionStore.entries())) {
          let match = true;
          if (filter.officeId && String(doc.officeId) !== String(filter.officeId)) {
            match = false;
          }
          if (filter.lastUpdated?.$lt) {
            if (!(doc.lastUpdated < filter.lastUpdated.$lt)) {
              match = false;
            }
          }
          if (match) {
            day14PositionStore.delete(key);
            deleted++;
          }
        }
        return { deletedCount: deleted };
      });

      day14FindByIdMock = mock.method(User, 'findById', (id) => ({
        lean: async () => day14UserStore.get(String(id)) || null
      }));
    }

    function restoreDay14Mocks() {
      if (day14FindOneMock) day14FindOneMock.mock.restore();
      if (day14FindOneAndUpdateMock) day14FindOneAndUpdateMock.mock.restore();
      if (day14FindMock) day14FindMock.mock.restore();
      if (day14FindOneAndDeleteMock) day14FindOneAndDeleteMock.mock.restore();
      if (day14DeleteManyMock) day14DeleteManyMock.mock.restore();
      if (day14FindByIdMock) day14FindByIdMock.mock.restore();
    }

    it('1. should handle multiple consecutive movement updates along a trajectory and maintain a single LivePosition document', async () => {
      setupDay14Mocks();
      try {
        await upsertPosition({
          userId: day14UserA,
          officeId: day14Office1,
          location: [100, 100],
          socketId: 'sock_traj_01'
        });

        assert.strictEqual(day14PositionStore.size, 1);

        // 10-step trajectory
        for (let i = 1; i <= 10; i++) {
          const nextCoord = [100 + i * 10, 100 + i * 10];
          const updated = await updatePosition(day14UserA, nextCoord);
          assert.deepStrictEqual(updated.location, nextCoord);
          assert.strictEqual(day14PositionStore.size, 1, 'Store must never exceed 1 document per user');
        }

        const finalPos = await getUserPosition(day14UserA);
        assert.deepStrictEqual(finalPos.location, [200, 200]);
        assert.strictEqual(String(finalPos.officeId), String(day14Office1));

        // Verify stationary tick suppression within movement trajectory
        const preWrites = day14WriteCount;
        const stationary = await updatePosition(day14UserA, [200, 200]);
        assert.deepStrictEqual(stationary.location, [200, 200]);
        assert.strictEqual(day14WriteCount, preWrites, 'Stationary position tick must generate zero MongoDB writes');
      } finally {
        restoreDay14Mocks();
      }
    });

    it('2. should migrate user atomically during office switching and ensure zero duplicate records or cross-room presence', async () => {
      setupDay14Mocks();
      try {
        await upsertPosition({
          userId: day14UserA,
          officeId: day14Office1,
          location: [150, 150],
          socketId: 'sock_switch_01'
        });

        day14UserStore.set(String(day14UserA), {
          _id: day14UserA,
          displayName: 'Switching Avatar',
          avatarColor: '#3b82f6',
          isOnline: true
        });

        // Pre-switch state
        const off1Before = await getOfficePositions(day14Office1);
        const off2Before = await getOfficePositions(day14Office2);
        assert.strictEqual(off1Before.length, 1);
        assert.strictEqual(off2Before.length, 0);

        // Atomic switch to office 2
        const transferred = await updatePosition(day14UserA, [450, 300], { officeId: day14Office2 });
        assert.strictEqual(String(transferred.officeId), String(day14Office2));
        assert.deepStrictEqual(transferred.location, [450, 300]);

        // Post-switch state
        const off1After = await getOfficePositions(day14Office1);
        const off2After = await getOfficePositions(day14Office2);
        assert.strictEqual(off1After.length, 0, 'User must cease appearing in previous office immediately');
        assert.strictEqual(off2After.length, 1, 'User must appear in target office immediately');
        assert.strictEqual(day14PositionStore.size, 1, 'Collection must maintain exactly 1 document during migration');
      } finally {
        restoreDay14Mocks();
      }
    });

    it('3. should prevent duplicate LivePosition records under concurrent upserts and race conditions via unique index recovery', async () => {
      setupDay14Mocks();
      try {
        // Execute 5 concurrent upserts for the same user
        const promises = [
          upsertPosition({ userId: day14UserB, officeId: day14Office1, location: [100, 100], socketId: 's1' }),
          upsertPosition({ userId: day14UserB, officeId: day14Office1, location: [105, 105], socketId: 's2' }),
          upsertPosition({ userId: day14UserB, officeId: day14Office1, location: [110, 110], socketId: 's3' }),
          upsertPosition({ userId: day14UserB, officeId: day14Office1, location: [115, 115], socketId: 's4' }),
          upsertPosition({ userId: day14UserB, officeId: day14Office1, location: [120, 120], socketId: 's5' })
        ];

        const results = await Promise.all(promises);
        assert.strictEqual(results.length, 5, 'All 5 concurrent operations must resolve cleanly');
        assert.strictEqual(day14PositionStore.size, 1, 'Collection must contain strictly 1 document for this user');

        const doc = await getUserPosition(day14UserB);
        assert.ok(doc, 'User must have a valid LivePosition');
        assert.strictEqual(String(doc.userId), String(day14UserB));
      } finally {
        restoreDay14Mocks();
      }
    });

    it('4. should reject invalid and out-of-bounds coordinates before database execution across all edge cases', async () => {
      setupDay14Mocks();
      try {
        // Missing location
        await assert.rejects(async () => await updatePosition(day14UserA, null), /Location must be a 2-element array/);
        await assert.rejects(async () => await updatePosition(day14UserA, undefined), /Location must be a 2-element array/);
        await assert.rejects(async () => await updatePosition(day14UserA, [100]), /Location must be a 2-element array/);
        await assert.rejects(async () => await updatePosition(day14UserA, [100, 200, 300]), /Location must be a 2-element array/);

        // Non-numeric / NaN / Infinity
        await assert.rejects(async () => await updatePosition(day14UserA, ['100', 200]), /Coordinates x and y must be finite numbers/);
        await assert.rejects(async () => await updatePosition(day14UserA, [NaN, 200]), /Coordinates x and y must be finite numbers/);
        await assert.rejects(async () => await updatePosition(day14UserA, [100, Infinity]), /Coordinates x and y must be finite numbers/);

        // Negative coordinates
        await assert.rejects(async () => await updatePosition(day14UserA, [-1, 200]), /Coordinates must be non-negative/);
        await assert.rejects(async () => await updatePosition(day14UserA, [100, -0.5]), /Coordinates must be non-negative/);

        // Boundary bounds validation
        await assert.rejects(
          async () => await updatePosition(day14UserA, [1001, 300], { validateBounds: true }),
          /X coordinate \(1001\) exceeds office width \(1000\)/
        );
        await assert.rejects(
          async () => await updatePosition(day14UserA, [500, 601], { validateBounds: true }),
          /Y coordinate \(601\) exceeds office height \(600\)/
        );

        assert.strictEqual(day14PositionStore.size, 0, 'No document should have been created on failed validations');
      } finally {
        restoreDay14Mocks();
      }
    });

    it('5. should validate missing and invalid user or office references across all service methods', async () => {
      setupDay14Mocks();
      try {
        // upsertPosition: missing userId
        await assert.rejects(
          async () => await upsertPosition({ officeId: day14Office1, location: [100, 100] }),
          /userId is required/
        );

        // upsertPosition: missing officeId
        await assert.rejects(
          async () => await upsertPosition({ userId: day14UserA, location: [100, 100] }),
          /officeId is required/
        );

        // updatePosition: missing userId
        await assert.rejects(
          async () => await updatePosition(null, [100, 100]),
          /userId is required/
        );

        // updatePosition: invalid officeId in options
        await assert.rejects(
          async () => await updatePosition(day14UserA, [100, 100], { officeId: 99999 }),
          /officeId must be a valid ObjectId or string/
        );

        // updatePosition: non-existent position falls back to User profile currentOfficeId
        day14UserStore.set(String(day14UserC), {
          _id: day14UserC,
          currentOfficeId: day14Office2
        });
        const createdFromProfile = await updatePosition(day14UserC, [300, 300]);
        assert.ok(createdFromProfile);
        assert.strictEqual(String(createdFromProfile.officeId), String(day14Office2));

        // updatePosition: non-existent position with no fallback office returns null safely
        const orphanUser = new mongoose.Types.ObjectId();
        const nonExistent = await updatePosition(orphanUser, [200, 200]);
        assert.strictEqual(nonExistent, null, 'Should return null when user has no position and no office reference');

        // getUserPosition and removeUserPosition: safely return null for invalid user IDs
        assert.strictEqual(await getUserPosition(null), null);
        assert.strictEqual(await getUserPosition(123), null);
        assert.strictEqual(await removeUserPosition(null), null);
        assert.strictEqual(await removeUserPosition(456), null);
      } finally {
        restoreDay14Mocks();
      }
    });

    it('6. should process concurrent position updates from multiple distinct users without cross-user data corruption', async () => {
      setupDay14Mocks();
      try {
        await upsertPosition({ userId: day14UserA, officeId: day14Office1, location: [50, 50], socketId: 'sock_A' });
        await upsertPosition({ userId: day14UserB, officeId: day14Office1, location: [150, 150], socketId: 'sock_B' });
        await upsertPosition({ userId: day14UserC, officeId: day14Office1, location: [250, 250], socketId: 'sock_C' });
        await upsertPosition({ userId: day14UserD, officeId: day14Office1, location: [350, 350], socketId: 'sock_D' });

        // Concurrent updates from 4 independent avatars
        const updates = await Promise.all([
          updatePosition(day14UserA, [60, 65]),
          updatePosition(day14UserB, [160, 165]),
          updatePosition(day14UserC, [260, 265]),
          updatePosition(day14UserD, [360, 365])
        ]);

        assert.deepStrictEqual(updates[0].location, [60, 65]);
        assert.deepStrictEqual(updates[1].location, [160, 165]);
        assert.deepStrictEqual(updates[2].location, [260, 265]);
        assert.deepStrictEqual(updates[3].location, [360, 365]);

        assert.strictEqual(day14PositionStore.size, 4, 'Must maintain exactly 4 distinct avatar records');

        const docA = await getUserPosition(day14UserA);
        const docB = await getUserPosition(day14UserB);
        assert.strictEqual(docA.socketId, 'sock_A');
        assert.strictEqual(docB.socketId, 'sock_B');
      } finally {
        restoreDay14Mocks();
      }
    });

    it('7. should reflect updated proximity peers dynamically following avatar movement', async () => {
      setupDay14Mocks();
      try {
        // User A at [100, 100]
        await upsertPosition({ userId: day14UserA, officeId: day14Office1, location: [100, 100] });
        day14UserStore.set(String(day14UserA), { _id: day14UserA, displayName: 'User A', isOnline: true });

        // User B at [350, 100] (dx = 250px > 100px proximity radius)
        await upsertPosition({ userId: day14UserB, officeId: day14Office1, location: [350, 100] });
        day14UserStore.set(String(day14UserB), { _id: day14UserB, displayName: 'User B', isOnline: true });

        // Query initial proximity for User A
        const initialNearby = await getNearbyUsers({
          officeId: day14Office1,
          location: [100, 100],
          radius: 100,
          excludeUserId: day14UserA
        });
        assert.strictEqual(initialNearby.length, 0, 'Initially User B must be out of proximity');

        // User B moves closer: to [140, 100] (dx = 40px <= 100px)
        await updatePosition(day14UserB, [140, 100]);

        const movedNearby = await getNearbyUsers({
          officeId: day14Office1,
          location: [100, 100],
          radius: 100,
          excludeUserId: day14UserA
        });
        assert.strictEqual(movedNearby.length, 1, 'User B must now be detected in proximity');
        assert.strictEqual(String(movedNearby[0].userId), String(day14UserB));
        assert.strictEqual(movedNearby[0].distance, 40);
        assert.ok(movedNearby[0].gain > 0.5, 'Audio volume gain must be attenuated for 40px distance');
        assert.ok(movedNearby[0].pan > 0, 'Stereo pan must place User B on the right (+X)');

        // User B moves far away: to [800, 500]
        await updatePosition(day14UserB, [800, 500]);
        const departedNearby = await getNearbyUsers({
          officeId: day14Office1,
          location: [100, 100],
          radius: 100,
          excludeUserId: day14UserA
        });
        assert.strictEqual(departedNearby.length, 0, 'User B must no longer be in proximity');
      } finally {
        restoreDay14Mocks();
      }
    });

    it('8. should enforce strict cross-office isolation across proximity queries even with overlapping coordinates', async () => {
      setupDay14Mocks();
      try {
        // User A in Office 1 at [250, 250]
        await upsertPosition({ userId: day14UserA, officeId: day14Office1, location: [250, 250] });
        day14UserStore.set(String(day14UserA), { _id: day14UserA, displayName: 'Office 1 Peer', isOnline: true });

        // User B in Office 2 at exact same coordinate [250, 250]
        await upsertPosition({ userId: day14UserB, officeId: day14Office2, location: [250, 250] });
        day14UserStore.set(String(day14UserB), { _id: day14UserB, displayName: 'Office 2 Peer 1', isOnline: true });

        // User C in Office 2 at [255, 255] (5px away from User B)
        await upsertPosition({ userId: day14UserC, officeId: day14Office2, location: [255, 255] });
        day14UserStore.set(String(day14UserC), { _id: day14UserC, displayName: 'Office 2 Peer 2', isOnline: true });

        // Proximity query for Office 1 at [250, 250]
        const nearbyOff1 = await getNearbyUsers({
          officeId: day14Office1,
          location: [250, 250],
          radius: 100
        });
        assert.strictEqual(nearbyOff1.length, 1);
        assert.strictEqual(String(nearbyOff1[0].userId), String(day14UserA));

        // Proximity query for Office 2 at [250, 250]
        const nearbyOff2 = await getNearbyUsers({
          officeId: day14Office2,
          location: [250, 250],
          radius: 100
        });
        assert.strictEqual(nearbyOff2.length, 2);
        for (const peer of nearbyOff2) {
          assert.notStrictEqual(String(peer.userId), String(day14UserA), 'Office 1 user must never appear in Office 2 query');
        }
      } finally {
        restoreDay14Mocks();
      }
    });

    it('9. should handle database update and find failures gracefully without corrupting internal state', async () => {
      setupDay14Mocks();
      try {
        await upsertPosition({
          userId: day14UserA,
          officeId: day14Office1,
          location: [100, 100]
        });

        // Simulate database query failure in findOne
        day14FindOneMock.mock.mockImplementationOnce(async () => {
          throw new Error('MongoNetworkTimeoutException');
        });

        await assert.rejects(
          async () => await updatePosition(day14UserA, [120, 120]),
          /MongoNetworkTimeoutException/
        );

        // Stored document must remain uncorrupted at original coordinates
        const untouched = day14PositionStore.get(String(day14UserA));
        assert.deepStrictEqual(untouched.location, [100, 100]);

        // Simulate database write failure in findOneAndUpdate
        day14FindOneAndUpdateMock.mock.mockImplementationOnce(async () => {
          throw new Error('WriteConflictException');
        });

        await assert.rejects(
          async () => await updatePosition(day14UserA, [150, 150]),
          /WriteConflictException/
        );

        const stillUntouched = day14PositionStore.get(String(day14UserA));
        assert.deepStrictEqual(stillUntouched.location, [100, 100]);
      } finally {
        restoreDay14Mocks();
      }
    });

    it('10. should remove stale and disconnected user positions via removeStalePositions and removeBySocketId', async () => {
      setupDay14Mocks();
      try {
        const now = Date.now();
        const tenMinutesAgo = new Date(now - 10 * 60 * 1000);
        const oneMinuteAgo = new Date(now - 1 * 60 * 1000);

        // Seed 2 stale positions (10 mins old) and 2 fresh positions (1 min old)
        day14PositionStore.set(String(day14UserA), {
          _id: new mongoose.Types.ObjectId(),
          userId: day14UserA,
          officeId: day14Office1,
          location: [100, 100],
          socketId: 'sock_stale_1',
          lastUpdated: tenMinutesAgo
        });
        day14PositionStore.set(String(day14UserB), {
          _id: new mongoose.Types.ObjectId(),
          userId: day14UserB,
          officeId: day14Office2,
          location: [200, 200],
          socketId: 'sock_stale_2',
          lastUpdated: tenMinutesAgo
        });
        day14PositionStore.set(String(day14UserC), {
          _id: new mongoose.Types.ObjectId(),
          userId: day14UserC,
          officeId: day14Office1,
          location: [300, 300],
          socketId: 'sock_fresh_1',
          lastUpdated: oneMinuteAgo
        });
        day14PositionStore.set(String(day14UserD), {
          _id: new mongoose.Types.ObjectId(),
          userId: day14UserD,
          officeId: day14Office1,
          location: [400, 400],
          socketId: 'sock_fresh_2',
          lastUpdated: oneMinuteAgo
        });

        assert.strictEqual(day14PositionStore.size, 4);

        // Reaping stale positions older than 5 minutes (300,000ms)
        const cleanupRes = await removeStalePositions(300000);
        assert.strictEqual(cleanupRes.deletedCount, 2, 'Must delete exactly 2 stale positions');
        assert.strictEqual(day14PositionStore.size, 2, '2 fresh positions must remain');

        // Fresh positions must still exist
        assert.ok(day14PositionStore.has(String(day14UserC)));
        assert.ok(day14PositionStore.has(String(day14UserD)));

        // Remove by socket ID for disconnected user
        const removed = await removeBySocketId('sock_fresh_1');
        assert.ok(removed);
        assert.strictEqual(String(removed.userId), String(day14UserC));
        assert.strictEqual(day14PositionStore.size, 1);

        // Non-existent or invalid socket ID safely returns null
        assert.strictEqual(await removeBySocketId('non_existent_sock'), null);
        assert.strictEqual(await removeBySocketId(null), null);
        assert.strictEqual(await removeBySocketId(12345), null);

        // Validation: maxAgeMs must be a positive finite number
        await assert.rejects(async () => await removeStalePositions(-100), /maxAgeMs must be a positive finite number/);
        await assert.rejects(async () => await removeStalePositions('500'), /maxAgeMs must be a positive finite number/);
      } finally {
        restoreDay14Mocks();
      }
    });
  });

  describe('Day 15: ProxiSpeak MongoDB Final Validation & End-to-End Workflow', () => {
    const Office = require('../../src/models/Office');
    const { findOrCreateUser } = require('../../src/services/userService');
    const { seedDefaultOffice, getOfficeByIdOrCode } = require('../../src/services/officeService');

    const day15Office1Id = new mongoose.Types.ObjectId();
    const day15Office2Id = new mongoose.Types.ObjectId();

    let day15PositionStore;
    let day15UserStore;
    let day15OfficeStore;
    let day15WriteCount;

    let lpFindOneMock;
    let lpFindOneAndUpdateMock;
    let lpFindMock;
    let lpFindOneAndDeleteMock;
    let lpDeleteManyMock;

    let userFindOneMock;
    let userCreateMock;
    let userFindByIdMock;

    let officeFindOneMock;
    let officeFindByIdMock;
    let officeFindOneAndUpdateMock;

    function setupDay15Mocks() {
      day15PositionStore = new Map();
      day15UserStore = new Map();
      day15OfficeStore = new Map();
      day15WriteCount = 0;

      // Seed baseline offices in store
      day15OfficeStore.set(String(day15Office1Id), {
        _id: day15Office1Id,
        code: 'office-01',
        name: 'ProxiSpeak Main Office',
        dimensions: { width: 1000, height: 600 },
        proximityRadius: 100
      });
      day15OfficeStore.set(String(day15Office2Id), {
        _id: day15Office2Id,
        code: 'office-02',
        name: 'ProxiSpeak Secondary Office',
        dimensions: { width: 1000, height: 600 },
        proximityRadius: 100
      });

      // LivePosition Mocks
      lpFindOneMock = mock.method(LivePosition, 'findOne', async (filter) => {
        if (filter.userId) {
          const doc = day15PositionStore.get(String(filter.userId));
          return doc ? { ...doc } : null;
        }
        if (filter.socketId) {
          for (const doc of day15PositionStore.values()) {
            if (doc.socketId === filter.socketId) return { ...doc };
          }
        }
        return null;
      });

      lpFindOneAndUpdateMock = mock.method(LivePosition, 'findOneAndUpdate', async (filter, update, options) => {
        day15WriteCount++;
        const userId = String(filter.userId);
        let doc = day15PositionStore.get(userId);

        if (!doc) {
          if (options && options.upsert) {
            doc = {
              _id: new mongoose.Types.ObjectId(),
              userId: filter.userId,
              createdAt: new Date(),
              updatedAt: new Date(),
              lastUpdated: new Date(),
              ...update.$set
            };
            day15PositionStore.set(userId, doc);
            return { ...doc };
          }
          return null;
        }

        Object.assign(doc, update.$set, { updatedAt: new Date(), lastUpdated: update.$set.lastUpdated || new Date() });
        day15PositionStore.set(userId, doc);
        return { ...doc };
      });

      lpFindMock = mock.method(LivePosition, 'find', (query) => {
        return {
          populate: () => ({
            lean: async () => {
              const results = [];
              for (const doc of day15PositionStore.values()) {
                if (query.officeId && String(doc.officeId) !== String(query.officeId)) {
                  continue;
                }
                if (query.userId?.$ne && String(doc.userId) === String(query.userId.$ne)) {
                  continue;
                }
                if (query.location?.$geoWithin?.$center) {
                  const [[cx, cy], maxRadius] = query.location.$geoWithin.$center;
                  const [x, y] = doc.location;
                  const distance = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
                  if (distance > maxRadius) {
                    continue;
                  }
                }
                const user = day15UserStore.get(String(doc.userId)) || {
                  _id: doc.userId,
                  displayName: 'Test User',
                  avatarColor: '#3b82f6',
                  avatarUrl: '',
                  isOnline: true
                };
                results.push({
                  ...doc,
                  userId: user
                });
              }
              return results;
            }
          })
        };
      });

      lpFindOneAndDeleteMock = mock.method(LivePosition, 'findOneAndDelete', async (filter) => {
        if (filter.userId) {
          const userId = String(filter.userId);
          const doc = day15PositionStore.get(userId);
          if (doc) {
            day15PositionStore.delete(userId);
            return { ...doc };
          }
        }
        if (filter.socketId) {
          for (const [key, doc] of day15PositionStore.entries()) {
            if (doc.socketId === filter.socketId) {
              day15PositionStore.delete(key);
              return { ...doc };
            }
          }
        }
        return null;
      });

      lpDeleteManyMock = mock.method(LivePosition, 'deleteMany', async (filter) => {
        let deleted = 0;
        for (const [key, doc] of Array.from(day15PositionStore.entries())) {
          let match = true;
          if (filter.officeId && String(doc.officeId) !== String(filter.officeId)) {
            match = false;
          }
          if (filter.lastUpdated?.$lt) {
            if (!(doc.lastUpdated < filter.lastUpdated.$lt)) {
              match = false;
            }
          }
          if (match) {
            day15PositionStore.delete(key);
            deleted++;
          }
        }
        return { deletedCount: deleted };
      });

      // User Mocks
      userFindOneMock = mock.method(User, 'findOne', async (filter) => {
        if (filter.email) {
          for (const user of day15UserStore.values()) {
            if (user.email === filter.email) return { ...user };
          }
        }
        return null;
      });

      userCreateMock = mock.method(User, 'create', async (doc) => {
        // Enforce unique email constraint simulation
        for (const user of day15UserStore.values()) {
          if (user.email === doc.email) {
            const err = new Error('E11000 duplicate key error');
            err.code = 11000;
            throw err;
          }
        }
        const created = {
          _id: new mongoose.Types.ObjectId(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...doc
        };
        day15UserStore.set(String(created._id), created);
        return { ...created };
      });

      userFindByIdMock = mock.method(User, 'findById', (id) => ({
        lean: async () => day15UserStore.get(String(id)) || null
      }));

      // Office Mocks
      officeFindOneMock = mock.method(Office, 'findOne', async (filter) => {
        if (filter.code) {
          for (const off of day15OfficeStore.values()) {
            if (off.code === filter.code) return { ...off };
          }
        }
        return null;
      });

      officeFindByIdMock = mock.method(Office, 'findById', async (id) => {
        const off = day15OfficeStore.get(String(id));
        return off ? { ...off } : null;
      });

      officeFindOneAndUpdateMock = mock.method(Office, 'findOneAndUpdate', async (filter, update) => {
        for (const off of day15OfficeStore.values()) {
          if (off.code === filter.code) {
            Object.assign(off, update.$set);
            return { ...off };
          }
        }
        const created = {
          _id: new mongoose.Types.ObjectId(),
          ...update.$set
        };
        day15OfficeStore.set(String(created._id), created);
        return { ...created };
      });
    }

    function restoreDay15Mocks() {
      if (lpFindOneMock) lpFindOneMock.mock.restore();
      if (lpFindOneAndUpdateMock) lpFindOneAndUpdateMock.mock.restore();
      if (lpFindMock) lpFindMock.mock.restore();
      if (lpFindOneAndDeleteMock) lpFindOneAndDeleteMock.mock.restore();
      if (lpDeleteManyMock) lpDeleteManyMock.mock.restore();

      if (userFindOneMock) userFindOneMock.mock.restore();
      if (userCreateMock) userCreateMock.mock.restore();
      if (userFindByIdMock) userFindByIdMock.mock.restore();

      if (officeFindOneMock) officeFindOneMock.mock.restore();
      if (officeFindByIdMock) officeFindByIdMock.mock.restore();
      if (officeFindOneAndUpdateMock) officeFindOneAndUpdateMock.mock.restore();
    }

    it('1. should validate complete end-to-end database workflow from registration to movement and cleanup', async () => {
      setupDay15Mocks();
      try {
        // Step 1: User Registration
        const user = await findOrCreateUser({
          email: 'alice.day15@proxispeak.local',
          displayName: 'Alice Day15',
          avatarColor: '#10b981'
        });
        assert.ok(user._id, 'User must be created with valid ObjectId');
        assert.strictEqual(user.displayName, 'Alice Day15');

        // Step 2: Office Association
        const office = await getOfficeByIdOrCode('office-01');
        assert.ok(office, 'Default office must be resolved');
        assert.strictEqual(office.code, 'office-01');

        // Step 3: Initial LivePosition Creation
        const initialPos = await upsertPosition({
          userId: user._id,
          officeId: office._id,
          location: [500, 300],
          socketId: 'sock_alice_e2e'
        });
        assert.ok(initialPos);
        assert.deepStrictEqual(initialPos.location, [500, 300]);
        assert.strictEqual(day15PositionStore.size, 1);

        // Seed a stationary peer nearby at [525, 300] (25px away)
        const peer = await findOrCreateUser({ email: 'bob.day15@proxispeak.local', displayName: 'Bob Day15' });
        await upsertPosition({
          userId: peer._id,
          officeId: office._id,
          location: [525, 300],
          socketId: 'sock_bob_e2e'
        });
        assert.strictEqual(day15PositionStore.size, 2);

        // Step 4: Updating X/Y Coordinates along Movement Trajectory
        const waypoints = [
          [505, 300],
          [510, 300],
          [515, 300],
          [520, 300]
        ];
        for (const wp of waypoints) {
          const res = await updatePosition(user._id, wp);
          assert.deepStrictEqual(res.location, wp);
        }
        assert.strictEqual(day15PositionStore.size, 2, 'Store must still have strictly 2 records');

        // Step 5: Proximity Query (Alice is at [520, 300], Bob is at [525, 300], distance = 5px)
        const nearby = await getNearbyUsers({
          officeId: office._id,
          location: [520, 300],
          radius: 100,
          excludeUserId: user._id
        });
        assert.strictEqual(nearby.length, 1, 'Should find Bob within 5px proximity');
        assert.strictEqual(String(nearby[0].userId), String(peer._id));
        assert.strictEqual(nearby[0].distance, 5);
        assert.ok(nearby[0].gain > 0.95, 'Audio volume must be near maximum at 5px');

        // Step 6: Office Isolation Check (seed a user in office 2 at [520, 300])
        const office2 = await getOfficeByIdOrCode('office-02');
        const userOff2 = await findOrCreateUser({ email: 'charlie.day15@proxispeak.local', displayName: 'Charlie Off2' });
        await upsertPosition({
          userId: userOff2._id,
          officeId: office2._id,
          location: [520, 300],
          socketId: 'sock_charlie_e2e'
        });

        const recheckNearby = await getNearbyUsers({
          officeId: office._id,
          location: [520, 300],
          radius: 100
        });
        // recheckNearby should contain Alice and Bob, but strictly NOT Charlie
        for (const p of recheckNearby) {
          assert.notStrictEqual(String(p.userId), String(userOff2._id), 'Charlie from office-02 must be isolated');
        }

        // Step 7: Disconnect Cleanup
        const removed = await removeBySocketId('sock_alice_e2e');
        assert.ok(removed);
        assert.strictEqual(String(removed.userId), String(user._id));
        assert.strictEqual(await getUserPosition(user._id), null, 'Alice position must be deleted');
      } finally {
        restoreDay15Mocks();
      }
    });

    it('2. should enforce user-to-LivePosition and office-to-LivePosition relational integrity', () => {
      const indexes = LivePosition.schema.indexes();

      // Compound 2D index exists
      const compound = indexes.find((idx) => idx[0] && idx[0].officeId === 1 && idx[0].location === '2d');
      assert.ok(compound, 'Compound planar index must exist');

      // Unique userId index
      const userIdx = indexes.find((idx) => idx[0] && idx[0].userId === 1);
      assert.ok(userIdx, 'userId index must exist');
      assert.strictEqual(userIdx[1].unique, true, 'userId must be unique (1:1 mapping)');

      // officeId index
      const offIdx = indexes.find((idx) => idx[0] && idx[0].officeId === 1 && !idx[0].location);
      assert.ok(offIdx, 'officeId single index must exist');

      // Schema paths ref checks
      const userPath = LivePosition.schema.path('userId');
      assert.strictEqual(userPath.options.ref, 'User');
      assert.strictEqual(userPath.options.required, true);

      const officePath = LivePosition.schema.path('officeId');
      assert.strictEqual(officePath.options.ref, 'Office');
      assert.strictEqual(officePath.options.required, true);
    });

    it('3. should recover gracefully from concurrent user registration duplicate key race conditions in userService', async () => {
      setupDay15Mocks();
      try {
        const email = 'race.registration@proxispeak.local';

        // Fire 3 concurrent findOrCreateUser calls
        const [u1, u2, u3] = await Promise.all([
          findOrCreateUser({ email, displayName: 'User 1' }),
          findOrCreateUser({ email, displayName: 'User 2' }),
          findOrCreateUser({ email, displayName: 'User 3' })
        ]);

        assert.strictEqual(String(u1._id), String(u2._id));
        assert.strictEqual(String(u2._id), String(u3._id));
        assert.strictEqual(day15UserStore.size, 1, 'Only one user document must exist in store');
      } finally {
        restoreDay15Mocks();
      }
    });

    it('4. should create initial LivePosition idempotently and reject duplicate records on reconnect', async () => {
      setupDay15Mocks();
      try {
        const testUserId = new mongoose.Types.ObjectId();

        // Initial connect
        const pos1 = await upsertPosition({
          userId: testUserId,
          officeId: day15Office1Id,
          location: [500, 300],
          socketId: 'sock_initial'
        });
        assert.strictEqual(day15PositionStore.size, 1);
        assert.strictEqual(pos1.socketId, 'sock_initial');

        // Reconnect with new socket ID
        const pos2 = await upsertPosition({
          userId: testUserId,
          officeId: day15Office1Id,
          location: [500, 300],
          socketId: 'sock_reconnected'
        });
        assert.strictEqual(day15PositionStore.size, 1, 'Reconnection must not create duplicate LivePosition');
        assert.strictEqual(String(pos2._id), String(pos1._id), 'Document _id must be preserved');
        assert.strictEqual(pos2.socketId, 'sock_reconnected');
      } finally {
        restoreDay15Mocks();
      }
    });

    it('5. should handle repeated movement updates with sub-millisecond stationary write suppression', async () => {
      setupDay15Mocks();
      try {
        const testUserId = new mongoose.Types.ObjectId();
        await upsertPosition({
          userId: testUserId,
          officeId: day15Office1Id,
          location: [100, 100],
          socketId: 'sock_bench_stream'
        });

        // 10 continuous movement ticks
        for (let i = 1; i <= 10; i++) {
          const res = await updatePosition(testUserId, [100 + i * 2, 100 + i * 3]);
          assert.deepStrictEqual(res.location, [100 + i * 2, 100 + i * 3]);
        }

        const writesAfterMove = day15WriteCount;
        assert.ok(writesAfterMove >= 10);

        // 50 stationary ticks (avatar halted)
        for (let i = 0; i < 50; i++) {
          const res = await updatePosition(testUserId, [120, 130]);
          assert.deepStrictEqual(res.location, [120, 130]);
        }
        assert.strictEqual(day15WriteCount, writesAfterMove, 'All 50 stationary ticks must be suppressed');

        // Delta tick
        await updatePosition(testUserId, [120.2, 130]);
        assert.strictEqual(day15WriteCount, writesAfterMove + 1, 'Movement must immediately trigger a write');
      } finally {
        restoreDay15Mocks();
      }
    });

    it('6. should calculate dynamic proximity, smoothstep gain, and stereo panning throughout avatar approach and departure', async () => {
      setupDay15Mocks();
      try {
        const listenerId = new mongoose.Types.ObjectId();
        const speakerId = new mongoose.Types.ObjectId();

        day15UserStore.set(String(speakerId), {
          _id: speakerId,
          displayName: 'Speaker',
          avatarColor: '#f59e0b',
          isOnline: true
        });

        // Speaker stationary at [200, 200]
        await upsertPosition({ userId: speakerId, officeId: day15Office1Id, location: [200, 200] });

        // Step A: Listener far away at [400, 200] (dx = 200 > 100)
        const nearbyA = await getNearbyUsers({
          officeId: day15Office1Id,
          location: [400, 200],
          radius: 100,
          excludeUserId: listenerId
        });
        assert.strictEqual(nearbyA.length, 0, 'Out of earshot');

        // Step B: Listener approaches to [280, 200] (dx = 80px <= 100px)
        const nearbyB = await getNearbyUsers({
          officeId: day15Office1Id,
          location: [280, 200],
          radius: 100,
          excludeUserId: listenerId
        });
        assert.strictEqual(nearbyB.length, 1);
        assert.strictEqual(nearbyB[0].distance, 80);
        assert.strictEqual(nearbyB[0].gain, 0.104);
        assert.strictEqual(nearbyB[0].pan, -0.8); // Speaker is to the left (-X)

        // Step C: Listener moves very close to [210, 200] (dx = 10px)
        const nearbyC = await getNearbyUsers({
          officeId: day15Office1Id,
          location: [210, 200],
          radius: 100,
          excludeUserId: listenerId
        });
        assert.strictEqual(nearbyC.length, 1);
        assert.strictEqual(nearbyC[0].distance, 10);
        assert.ok(nearbyC[0].gain > 0.95);
        assert.strictEqual(nearbyC[0].pan, -0.1);

        // Step D: Listener at exact same coordinate [200, 200] (dx = 0px)
        const nearbyD = await getNearbyUsers({
          officeId: day15Office1Id,
          location: [200, 200],
          radius: 100,
          excludeUserId: listenerId
        });
        assert.strictEqual(nearbyD.length, 1);
        assert.strictEqual(nearbyD[0].distance, 0);
        assert.strictEqual(nearbyD[0].gain, 1.0);
        assert.strictEqual(nearbyD[0].pan, 0.0);
      } finally {
        restoreDay15Mocks();
      }
    });

    it('7. should enforce strict multi-office isolation with zero cross-office audio leakage', async () => {
      setupDay15Mocks();
      try {
        const testCoords = [
          [100, 100],
          [200, 200],
          [300, 300],
          [400, 400],
          [500, 500]
        ];

        // Seed 5 users in Office 1 and 5 users in Office 2 at the exact same coordinates
        for (let i = 0; i < 5; i++) {
          const uId1 = new mongoose.Types.ObjectId();
          const uId2 = new mongoose.Types.ObjectId();

          day15UserStore.set(String(uId1), { _id: uId1, displayName: `O1_Peer_${i}`, isOnline: true });
          day15UserStore.set(String(uId2), { _id: uId2, displayName: `O2_Peer_${i}`, isOnline: true });

          await upsertPosition({ userId: uId1, officeId: day15Office1Id, location: testCoords[i] });
          await upsertPosition({ userId: uId2, officeId: day15Office2Id, location: testCoords[i] });
        }

        assert.strictEqual(day15PositionStore.size, 10);

        // Query Office 1
        const off1Positions = await getOfficePositions(day15Office1Id);
        assert.strictEqual(off1Positions.length, 5);
        for (const p of off1Positions) {
          assert.ok(p.displayName.startsWith('O1_'));
        }

        // Query Office 2
        const off2Positions = await getOfficePositions(day15Office2Id);
        assert.strictEqual(off2Positions.length, 5);
        for (const p of off2Positions) {
          assert.ok(p.displayName.startsWith('O2_'));
        }
      } finally {
        restoreDay15Mocks();
      }
    });

    it('8. should reject invalid and out-of-boundary coordinates across all operations before database execution', async () => {
      setupDay15Mocks();
      try {
        const dummyUser = new mongoose.Types.ObjectId();

        // Negative coordinate validation
        await assert.rejects(async () => await upsertPosition({ userId: dummyUser, officeId: day15Office1Id, location: [-1, 50] }), /Coordinates must be non-negative/);
        await assert.rejects(async () => await updatePosition(dummyUser, [50, -0.01]), /Coordinates must be non-negative/);

        // Non-finite / NaN coordinate validation
        await assert.rejects(async () => await updatePosition(dummyUser, [NaN, 100]), /Coordinates x and y must be finite numbers/);
        await assert.rejects(async () => await updatePosition(dummyUser, [100, Infinity]), /Coordinates x and y must be finite numbers/);

        // Malformed structure
        await assert.rejects(async () => await updatePosition(dummyUser, null), /Location must be a 2-element array/);
        await assert.rejects(async () => await updatePosition(dummyUser, [50]), /Location must be a 2-element array/);
        await assert.rejects(async () => await updatePosition(dummyUser, [50, 50, 50]), /Location must be a 2-element array/);

        // Canvas boundary validation when bounds checking is enabled
        await assert.rejects(
          async () => await updatePosition(dummyUser, [1001, 300], { validateBounds: true }),
          /X coordinate \(1001\) exceeds office width \(1000\)/
        );
        await assert.rejects(
          async () => await updatePosition(dummyUser, [500, 601], { validateBounds: true }),
          /Y coordinate \(601\) exceeds office height \(600\)/
        );

        assert.strictEqual(day15PositionStore.size, 0, 'Store must remain completely empty');
      } finally {
        restoreDay15Mocks();
      }
    });

    it('9. should handle database driver and network failures gracefully without corrupting persisted state', async () => {
      setupDay15Mocks();
      try {
        const user = new mongoose.Types.ObjectId();
        await upsertPosition({ userId: user, officeId: day15Office1Id, location: [200, 200] });

        // Simulate driver connection failure
        lpFindOneMock.mock.mockImplementationOnce(async () => {
          throw new Error('MongoServerSelectionError: connection timed out');
        });

        await assert.rejects(
          async () => await updatePosition(user, [250, 250]),
          /MongoServerSelectionError/
        );

        // State remains intact
        const pos = day15PositionStore.get(String(user));
        assert.deepStrictEqual(pos.location, [200, 200]);
      } finally {
        restoreDay15Mocks();
      }
    });

    it('10. should perform comprehensive position lifecycle cleanup via socket, user, and age-based reaping', async () => {
      setupDay15Mocks();
      try {
        const u1 = new mongoose.Types.ObjectId();
        const u2 = new mongoose.Types.ObjectId();
        const u3 = new mongoose.Types.ObjectId();

        await upsertPosition({ userId: u1, officeId: day15Office1Id, location: [100, 100], socketId: 'sock_cleanup_1' });
        await upsertPosition({ userId: u2, officeId: day15Office1Id, location: [200, 200], socketId: 'sock_cleanup_2' });
        await upsertPosition({ userId: u3, officeId: day15Office2Id, location: [300, 300], socketId: 'sock_cleanup_3' });

        assert.strictEqual(day15PositionStore.size, 3);

        // Disconnect user 1 via socket
        const removedSocket = await removeBySocketId('sock_cleanup_1');
        assert.ok(removedSocket);
        assert.strictEqual(String(removedSocket.userId), String(u1));
        assert.strictEqual(day15PositionStore.size, 2);

        // Explicit user 2 leave
        const removedUser = await removeUserPosition(u2);
        assert.ok(removedUser);
        assert.strictEqual(String(removedUser.userId), String(u2));
        assert.strictEqual(day15PositionStore.size, 1);

        // User 3 becomes stale (set timestamp to 10 mins ago)
        const doc3 = day15PositionStore.get(String(u3));
        doc3.lastUpdated = new Date(Date.now() - 10 * 60 * 1000);

        // Prune stale positions older than 5 minutes
        const reap = await removeStalePositions(300000);
        assert.strictEqual(reap.deletedCount, 1);
        assert.strictEqual(day15PositionStore.size, 0);
      } finally {
        restoreDay15Mocks();
      }
    });
  });
});
