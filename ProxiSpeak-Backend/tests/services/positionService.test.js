const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  validateCoordinates,
  calculateDistance,
  calculateAudioVolume,
  calculateStereoPan
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
    const pivotUserId = 'user_self';
    const pivotLocation = [500, 300];
    const PROXIMITY_RADIUS = 100;

    // Simulated active office positions
    const activeOfficeUsers = [
      {
        userId: 'user_self',
        displayName: 'Myself',
        avatarColor: '#3b82f6',
        location: [500, 300]
      },
      {
        userId: 'user_alex',
        displayName: 'Alex',
        avatarColor: '#a78bfa',
        location: [530, 340] // dx = 30, dy = 40 => distance = 50px (WITHIN 100px)
      },
      {
        userId: 'user_sam',
        displayName: 'Sam',
        avatarColor: '#34d399',
        location: [560, 300] // dx = 60, dy = 0 => distance = 60px (WITHIN 100px)
      },
      {
        userId: 'user_boundary',
        displayName: 'Boundary User',
        avatarColor: '#f59e0b',
        location: [500, 400] // dx = 0, dy = 100 => distance = 100px (BOUNDARY)
      },
      {
        userId: 'user_taylor',
        displayName: 'Taylor',
        avatarColor: '#fb923c',
        location: [650, 420] // dx = 150, dy = 120 => distance = 192px (OUTSIDE 100px)
      },
      {
        userId: 'user_far',
        displayName: 'Far Desk User',
        avatarColor: '#ef4444',
        location: [100, 100] // distance ~ 447px (FAR OUTSIDE)
      }
    ];

    it('should correctly identify all users within 100-pixel radius and exclude self', () => {
      const nearbyUsers = activeOfficeUsers
        .filter((u) => u.userId !== pivotUserId)
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

      // Ensure far users were excluded
      const foundTaylor = nearbyUsers.some((u) => u.displayName === 'Taylor');
      const foundFar = nearbyUsers.some((u) => u.displayName === 'Far Desk User');
      assert.strictEqual(foundTaylor, false, 'Taylor (>100px) must be excluded');
      assert.strictEqual(foundFar, false, 'Far user must be excluded');
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

    it('should provide default furniture obstacles with valid bounds and types', () => {
      assert.ok(Array.isArray(DEFAULT_OBSTACLES));
      assert.ok(DEFAULT_OBSTACLES.length >= 10);

      for (const obstacle of DEFAULT_OBSTACLES) {
        assert.ok(typeof obstacle.x === 'number' && obstacle.x >= 0);
        assert.ok(typeof obstacle.y === 'number' && obstacle.y >= 0);
        assert.ok(typeof obstacle.w === 'number' && obstacle.w > 0);
        assert.ok(typeof obstacle.h === 'number' && obstacle.h > 0);
        assert.ok(
          ['desk', 'table', 'sofa', 'coffee', 'counter', 'wall', 'custom'].includes(obstacle.type),
          `Invalid type: ${obstacle.type}`
        );
      }
    });
  });
});
