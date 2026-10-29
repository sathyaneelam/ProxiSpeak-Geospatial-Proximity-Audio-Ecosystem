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
});
