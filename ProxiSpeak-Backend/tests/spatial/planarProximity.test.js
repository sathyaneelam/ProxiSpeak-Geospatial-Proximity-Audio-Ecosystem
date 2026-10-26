const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const LivePosition = require('../../src/models/LivePosition');
const Office = require('../../src/models/Office');
const {
  calculateDistance,
  calculateAudioVolume,
  calculateStereoPan,
  isWithinEarshot,
  validateCoordinates,
  isPositionWithinOffice,
  validatePositionInOffice,
  getNearbyUsers
} = require('../../src/services/positionService');

describe('Planar 2D Geometry & Proximity Calculation', () => {
  it('should accurately calculate Euclidean distance on standard Cartesian triangles', () => {
    // Same point -> distance 0
    assert.strictEqual(calculateDistance([100, 100], [100, 100]), 0);

    // 3-4-5 right triangle scaled by 10: dx = 30, dy = 40 => distance = 50
    const d1 = calculateDistance([0, 0], [30, 40]);
    assert.strictEqual(d1, 50, '30-40 right triangle hypotenuse must be 50');

    // Straight horizontal line of 100 pixels
    const dHorizontal = calculateDistance([200, 150], [300, 150]);
    assert.strictEqual(dHorizontal, 100, 'Horizontal distance should be 100px');

    // Straight vertical line of 100 pixels
    const dVertical = calculateDistance([500, 200], [500, 300]);
    assert.strictEqual(dVertical, 100, 'Vertical distance should be 100px');

    // Diagonal distance: dx = 70.71, dy = 70.71 => ~100
    const dDiagonal = calculateDistance([0, 0], [70.710678, 70.710678]);
    assert.strictEqual(Math.round(dDiagonal), 100);
  });

  it('demonstrates why 2D Planar representation is required over spherical GeoJSON (2dsphere)', () => {
    // Virtual office uses pixel coordinates, e.g. [500, 300]
    const virtualOfficeCoord = [500, 300];

    // GeoJSON spherical (WGS84) coordinates require longitude in [-180, 180] and latitude in [-90, 90]
    const isValidGeoJsonLatitude = virtualOfficeCoord[1] >= -90 && virtualOfficeCoord[1] <= 90;
    const isValidGeoJsonLongitude = virtualOfficeCoord[0] >= -180 && virtualOfficeCoord[0] <= 180;

    assert.strictEqual(
      isValidGeoJsonLatitude,
      false,
      'Y-coordinate (300px) exceeds maximum WGS84 latitude (+90), causing 2dsphere errors'
    );
    assert.strictEqual(
      isValidGeoJsonLongitude,
      false,
      'X-coordinate (500px) exceeds maximum WGS84 longitude (+180), causing 2dsphere errors'
    );

    // Flat Euclidean distance is symmetric and translation-invariant across the canvas
    const p1 = [100, 100];
    const p2 = [160, 180];
    const euclideanDist = calculateDistance(p1, p2);
    // dx = 60, dy = 80 => hypotenuse = 100
    assert.strictEqual(euclideanDist, 100, 'Flat planar distance is exact 100 pixels');
  });

  describe('Audio Volume Attenuation (100-pixel Proximity Radius)', () => {
    const RADIUS = 100;

    it('should return 1.0 (100% volume) when avatars are at the exact same location', () => {
      const vol = calculateAudioVolume(0, RADIUS);
      assert.strictEqual(vol, 1.0);
    });

    it('should calculate smoothstep gain with smooth, monotonic attenuation', () => {
      // At 25px away (1/4 radius), gain should be 0.8438 (smoothstep 1 - (3t^2 - 2t^3))
      const vol25 = calculateAudioVolume(25, RADIUS);
      assert.strictEqual(vol25, 0.8438);

      // At 50px away (halfway), gain should be 0.50
      const vol50 = calculateAudioVolume(50, RADIUS);
      assert.strictEqual(vol50, 0.5);

      // At 75px away, gain should be 0.1563
      const vol75 = calculateAudioVolume(75, RADIUS);
      assert.strictEqual(vol75, 0.1563);

      assert.ok(vol25 > vol50, '25px gain should be greater than 50px gain');
      assert.ok(vol50 > vol75, '50px gain should be greater than 75px gain');
      assert.ok(vol75 > 0, '75px gain should be positive');
    });

    it('should return 0.0 when avatars are at or beyond the 100-pixel radius', () => {
      const vol100 = calculateAudioVolume(100, RADIUS);
      assert.strictEqual(vol100, 0.0, 'Volume should be 0 at exactly 100px cutoff');

      const vol150 = calculateAudioVolume(150, RADIUS);
      assert.strictEqual(vol150, 0.0, 'Volume should be 0 beyond 100px');
    });

    it('should support configurable custom proximity radii (e.g., 50px whisper or 200px broadcast)', () => {
      // 50-pixel quiet zone: halfway is 25px => 0.5
      assert.strictEqual(calculateAudioVolume(25, 50), 0.5);
      assert.strictEqual(calculateAudioVolume(50, 50), 0.0);

      // 200-pixel megaphone / presentation zone: halfway is 100px => 0.5
      assert.strictEqual(calculateAudioVolume(100, 200), 0.5);
      assert.strictEqual(calculateAudioVolume(200, 200), 0.0);
    });
  });

  describe('Stereo Panning (Pan = clamp(dx/100, -1, 1))', () => {
    const RADIUS = 100;

    it('should compute full left (-1.0), center (0.0), and full right (+1.0) pan', () => {
      // Peer 100px to the left
      assert.strictEqual(calculateStereoPan(500, 400, RADIUS), -1.0);
      // Peer aligned vertically (dx = 0)
      assert.strictEqual(calculateStereoPan(500, 500, RADIUS), 0.0);
      // Peer 100px to the right
      assert.strictEqual(calculateStereoPan(500, 600, RADIUS), 1.0);
    });

    it('should compute intermediate proportional panning and clamp extreme deltas', () => {
      assert.strictEqual(calculateStereoPan(500, 450, RADIUS), -0.5);
      assert.strictEqual(calculateStereoPan(500, 550, RADIUS), 0.5);

      // Clamped beyond radius
      assert.strictEqual(calculateStereoPan(500, 300, RADIUS), -1.0);
      assert.strictEqual(calculateStereoPan(500, 800, RADIUS), 1.0);
    });

    it('should correctly evaluate isWithinEarshot for 100px proximity radius', () => {
      assert.strictEqual(isWithinEarshot(0, RADIUS), true);
      assert.strictEqual(isWithinEarshot(50, RADIUS), true);
      assert.strictEqual(isWithinEarshot(100, RADIUS), true);
      assert.strictEqual(isWithinEarshot(100.1, RADIUS), false);
      assert.strictEqual(isWithinEarshot(200, RADIUS), false);
      assert.strictEqual(isWithinEarshot(-1, RADIUS), false);
    });
  });

  // =========================================================================
  // Planar LivePosition Coordinates & Office Boundary Constraints (1 to 14)
  // =========================================================================
  describe('Planar LivePosition Coordinates & Office Boundary Constraints', () => {
    const defaultOffice = { dimensions: { width: 1000, height: 600 } };
    const dummyUserId = new mongoose.Types.ObjectId();
    const dummyOfficeId = new mongoose.Types.ObjectId();

    it('1. should validate a position completely inside an office', async () => {
      const loc = [500, 300];
      const valid = validatePositionInOffice(loc, defaultOffice);
      assert.deepStrictEqual(valid, [500, 300]);
      assert.strictEqual(isPositionWithinOffice(loc, defaultOffice), true);

      // Schema model validation
      const posDoc = new LivePosition({
        userId: dummyUserId,
        officeId: dummyOfficeId,
        location: loc
      });
      await posDoc.validate();
      assert.deepStrictEqual(posDoc.location, [500, 300]);
    });

    it('2. should accept a position at x = 0 (left canvas edge boundary)', async () => {
      const loc = [0, 300];
      const valid = validatePositionInOffice(loc, defaultOffice);
      assert.deepStrictEqual(valid, [0, 300]);
      assert.strictEqual(isPositionWithinOffice(loc, defaultOffice), true);

      const posDoc = new LivePosition({
        userId: dummyUserId,
        officeId: dummyOfficeId,
        location: loc
      });
      await posDoc.validate();
      assert.deepStrictEqual(posDoc.location, [0, 300]);
    });

    it('3. should accept a position at y = 0 (top canvas edge boundary)', async () => {
      const loc = [500, 0];
      const valid = validatePositionInOffice(loc, defaultOffice);
      assert.deepStrictEqual(valid, [500, 0]);
      assert.strictEqual(isPositionWithinOffice(loc, defaultOffice), true);

      const posDoc = new LivePosition({
        userId: dummyUserId,
        officeId: dummyOfficeId,
        location: loc
      });
      await posDoc.validate();
      assert.deepStrictEqual(posDoc.location, [500, 0]);
    });

    it('4. should accept a position at the maximum office width', async () => {
      const loc = [1000, 300];
      const valid = validatePositionInOffice(loc, defaultOffice);
      assert.deepStrictEqual(valid, [1000, 300]);
      assert.strictEqual(isPositionWithinOffice(loc, defaultOffice), true);

      const posDoc = new LivePosition({
        userId: dummyUserId,
        officeId: dummyOfficeId,
        location: loc
      });
      await posDoc.validate();
      assert.deepStrictEqual(posDoc.location, [1000, 300]);
    });

    it('5. should accept a position at the maximum office height', async () => {
      const loc = [500, 600];
      const valid = validatePositionInOffice(loc, defaultOffice);
      assert.deepStrictEqual(valid, [500, 600]);
      assert.strictEqual(isPositionWithinOffice(loc, defaultOffice), true);

      const posDoc = new LivePosition({
        userId: dummyUserId,
        officeId: dummyOfficeId,
        location: loc
      });
      await posDoc.validate();
      assert.deepStrictEqual(posDoc.location, [500, 600]);
    });

    it('6. should accept a position at the bottom-right corner boundary [1000, 600] and origin [0, 0]', async () => {
      const corner = [1000, 600];
      const origin = [0, 0];

      assert.deepStrictEqual(validatePositionInOffice(corner, defaultOffice), [1000, 600]);
      assert.strictEqual(isPositionWithinOffice(corner, defaultOffice), true);

      assert.deepStrictEqual(validatePositionInOffice(origin, defaultOffice), [0, 0]);
      assert.strictEqual(isPositionWithinOffice(origin, defaultOffice), true);

      const cornerDoc = new LivePosition({
        userId: dummyUserId,
        officeId: dummyOfficeId,
        location: corner
      });
      await cornerDoc.validate();
      assert.deepStrictEqual(cornerDoc.location, [1000, 600]);
    });

    it('7. should reject negative X coordinates', async () => {
      const negativeX = [-1, 300];
      assert.strictEqual(isPositionWithinOffice(negativeX, defaultOffice), false);
      assert.throws(
        () => validatePositionInOffice(negativeX, defaultOffice),
        /Coordinates must be non-negative/
      );

      const posDoc = new LivePosition({
        userId: dummyUserId,
        officeId: dummyOfficeId,
        location: negativeX
      });
      await assert.rejects(
        async () => await posDoc.validate(),
        (err) => err.errors && Boolean(err.errors.location)
      );
    });

    it('8. should reject negative Y coordinates', async () => {
      const negativeY = [500, -1];
      assert.strictEqual(isPositionWithinOffice(negativeY, defaultOffice), false);
      assert.throws(
        () => validatePositionInOffice(negativeY, defaultOffice),
        /Coordinates must be non-negative/
      );

      const posDoc = new LivePosition({
        userId: dummyUserId,
        officeId: dummyOfficeId,
        location: negativeY
      });
      await assert.rejects(
        async () => await posDoc.validate(),
        (err) => err.errors && Boolean(err.errors.location)
      );
    });

    it('9. should reject coordinates beyond office width', () => {
      const beyondWidth = [1001, 300];
      assert.strictEqual(isPositionWithinOffice(beyondWidth, defaultOffice), false);
      assert.throws(
        () => validatePositionInOffice(beyondWidth, defaultOffice),
        /X coordinate \(1001\) exceeds office width \(1000\)/
      );
    });

    it('10. should reject coordinates beyond office height', () => {
      const beyondHeight = [500, 601];
      assert.strictEqual(isPositionWithinOffice(beyondHeight, defaultOffice), false);
      assert.throws(
        () => validatePositionInOffice(beyondHeight, defaultOffice),
        /Y coordinate \(601\) exceeds office height \(600\)/
      );
    });

    it('11. should reject invalid/non-numeric coordinates', async () => {
      const invalidServiceCases = [
        ['500', 300],
        [NaN, 300],
        [500, Infinity],
        ['abc', 'def']
      ];

      for (const loc of invalidServiceCases) {
        assert.strictEqual(isPositionWithinOffice(loc, defaultOffice), false);
        assert.throws(
          () => validateCoordinates(loc),
          /Coordinates x and y must be finite numbers/
        );
        assert.throws(
          () => validatePositionInOffice(loc, defaultOffice),
          /Coordinates x and y must be finite numbers/
        );
      }

      const invalidSchemaCases = [
        ['abc', 300],
        [NaN, 300],
        [500, Infinity]
      ];
      for (const loc of invalidSchemaCases) {
        const posDoc = new LivePosition({
          userId: dummyUserId,
          officeId: dummyOfficeId,
          location: loc
        });
        await assert.rejects(
          async () => await posDoc.validate(),
          (err) => Boolean(err)
        );
      }
    });

    it('12. should reject missing coordinates', async () => {
      assert.strictEqual(isPositionWithinOffice(null), false);
      assert.strictEqual(isPositionWithinOffice(undefined), false);

      assert.throws(() => validateCoordinates(null), /Location must be a 2-element array/);
      assert.throws(() => validateCoordinates(undefined), /Location must be a 2-element array/);
      assert.throws(() => validatePositionInOffice(null), /Location must be a 2-element array/);

      const nullDoc = new LivePosition({
        userId: dummyUserId,
        officeId: dummyOfficeId,
        location: null
      });
      await assert.rejects(
        async () => await nullDoc.validate(),
        (err) => err.errors && Boolean(err.errors.location)
      );
    });

    it('13. should reject incorrect location array length', async () => {
      const incorrectLengths = [[], [500], [500, 300, 100]];

      for (const loc of incorrectLengths) {
        assert.strictEqual(isPositionWithinOffice(loc), false);
        assert.throws(
          () => validateCoordinates(loc),
          /Location must be a 2-element array/
        );
        assert.throws(
          () => validatePositionInOffice(loc),
          /Location must be a 2-element array/
        );

        const posDoc = new LivePosition({
          userId: dummyUserId,
          officeId: dummyOfficeId,
          location: loc
        });
        await assert.rejects(
          async () => await posDoc.validate(),
          (err) => err.errors && Boolean(err.errors.location)
        );
      }
    });

    it('14. should validate positions against different office dimensions', () => {
      // Large Auditorium: 1920x1080
      const largeOffice = { dimensions: { width: 1920, height: 1080 } };
      const largePos = [1500, 900];

      assert.strictEqual(isPositionWithinOffice(largePos, largeOffice), true);
      assert.deepStrictEqual(validatePositionInOffice(largePos, largeOffice), [1500, 900]);

      // Same large position exceeds default 1000x600 room
      assert.strictEqual(isPositionWithinOffice(largePos, defaultOffice), false);
      assert.throws(
        () => validatePositionInOffice(largePos, defaultOffice),
        /X coordinate \(1500\) exceeds office width \(1000\)/
      );

      // Compact Huddle Room: 400x300
      const huddleOffice = { dimensions: { width: 400, height: 300 } };
      assert.strictEqual(isPositionWithinOffice([350, 250], huddleOffice), true);
      assert.strictEqual(isPositionWithinOffice([450, 250], huddleOffice), false);
      assert.strictEqual(isPositionWithinOffice([350, 350], huddleOffice), false);
      assert.throws(
        () => validatePositionInOffice([450, 250], huddleOffice),
        /X coordinate \(450\) exceeds office width \(400\)/
      );
      assert.throws(
        () => validatePositionInOffice([350, 350], huddleOffice),
        /Y coordinate \(350\) exceeds office height \(300\)/
      );
    });
  });

  // =========================================================================
  // Office Isolation & Spatial Proximity Boundaries (15 to 20)
  // =========================================================================
  describe('Office Isolation & Proximity Boundary Queries', () => {
    const officeA = new mongoose.Types.ObjectId();
    const officeB = new mongoose.Types.ObjectId();
    const pivotUserId = new mongoose.Types.ObjectId();
    const pivotLocation = [500, 300];
    const PROXIMITY_RADIUS = 100;

    // Multi-user dataset covering multi-office positions and proximity thresholds
    const mockPositions = [
      // Office A users
      {
        _id: new mongoose.Types.ObjectId(),
        userId: { _id: pivotUserId, displayName: 'Pivot User' },
        officeId: officeA,
        location: [500, 300]
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Alice (Close)' },
        officeId: officeA,
        location: [520, 300] // dx = 20, dy = 0 => 20px
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Bob (Mid)' },
        officeId: officeA,
        location: [530, 340] // dx = 30, dy = 40 => 50px
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Carol (Boundary In)' },
        officeId: officeA,
        location: [500, 395] // dx = 0, dy = 95 => 95.0px
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: { _id: new mongoose.Types.ObjectId(), displayName: 'David (Exact Boundary)' },
        officeId: officeA,
        location: [500, 400] // dx = 0, dy = 100 => 100.0px
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Elena (Boundary Out)' },
        officeId: officeA,
        location: [500, 405] // dx = 0, dy = 105 => 105.0px
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Frank (Far Outside)' },
        officeId: officeA,
        location: [620, 390] // dx = 120, dy = 90 => 150px
      },
      // Office B users (Different office)
      {
        _id: new mongoose.Types.ObjectId(),
        userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Grace (Office B Identical Coords)' },
        officeId: officeB,
        location: [500, 300] // Identical coords to pivot, but in Office B!
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: { _id: new mongoose.Types.ObjectId(), displayName: 'Harry (Office B 10px Away)' },
        officeId: officeB,
        location: [506, 308] // 10px away from pivot, but in Office B!
      }
    ];

    function setupSpatialMock(dataset = mockPositions) {
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

    it('15. should enforce strict office isolation even when coordinates across offices are identical', async () => {
      const spatialMock = setupSpatialMock();
      try {
        const nearbyOfficeA = await getNearbyUsers({
          officeId: officeA,
          location: pivotLocation,
          radius: PROXIMITY_RADIUS,
          excludeUserId: pivotUserId
        });

        // Grace is at [500, 300] (0px from pivot), but in Office B
        const hasGrace = nearbyOfficeA.some((u) => u.displayName.includes('Grace'));
        assert.strictEqual(hasGrace, false, 'Office B user with identical coordinates must be excluded from Office A');

        // Querying Office B should return Grace
        const nearbyOfficeB = await getNearbyUsers({
          officeId: officeB,
          location: pivotLocation,
          radius: PROXIMITY_RADIUS
        });
        assert.ok(nearbyOfficeB.some((u) => u.displayName.includes('Grace')), 'Office B query should find Grace');
      } finally {
        spatialMock.mock.restore();
      }
    });

    it('16. should strictly filter out positions belonging to another office', async () => {
      const spatialMock = setupSpatialMock();
      try {
        const nearby = await getNearbyUsers({
          officeId: officeA,
          location: pivotLocation,
          radius: PROXIMITY_RADIUS,
          excludeUserId: pivotUserId
        });

        const hasOfficeBUsers = nearby.some(
          (u) => u.displayName.includes('Grace') || u.displayName.includes('Harry')
        );
        assert.strictEqual(hasOfficeBUsers, false, 'No Office B users should leak into Office A results');
      } finally {
        spatialMock.mock.restore();
      }
    });

    it('17. should return multiple users in the same office sorted by ascending distance', async () => {
      const spatialMock = setupSpatialMock();
      try {
        const nearby = await getNearbyUsers({
          officeId: officeA,
          location: pivotLocation,
          radius: PROXIMITY_RADIUS,
          excludeUserId: pivotUserId
        });

        // Should return Alice (20px), Bob (50px), Carol (95.0px), David (100.0px)
        assert.strictEqual(nearby.length, 4, 'Should find exactly 4 users within 100px in Office A');
        assert.strictEqual(nearby[0].displayName, 'Alice (Close)');
        assert.strictEqual(nearby[0].distance, 20.0);

        assert.strictEqual(nearby[1].displayName, 'Bob (Mid)');
        assert.strictEqual(nearby[1].distance, 50.0);

        assert.strictEqual(nearby[2].displayName, 'Carol (Boundary In)');
        assert.strictEqual(nearby[2].distance, 95.0);

        assert.strictEqual(nearby[3].displayName, 'David (Exact Boundary)');
        assert.strictEqual(nearby[3].distance, 100.0);
      } finally {
        spatialMock.mock.restore();
      }
    });

    it('18. should compute accurate planar Euclidean distances for all nearby users', async () => {
      const spatialMock = setupSpatialMock();
      try {
        const nearby = await getNearbyUsers({
          officeId: officeA,
          location: pivotLocation,
          radius: PROXIMITY_RADIUS,
          excludeUserId: pivotUserId
        });

        const alice = nearby.find((u) => u.displayName.includes('Alice'));
        const bob = nearby.find((u) => u.displayName.includes('Bob'));

        // Alice: [500, 300] to [520, 300] => dx=20, dy=0 => d=20
        assert.strictEqual(alice.distance, 20.0);

        // Bob: [500, 300] to [530, 340] => dx=30, dy=40 => d=50 (3-4-5 triangle)
        assert.strictEqual(bob.distance, 50.0);
      } finally {
        spatialMock.mock.restore();
      }
    });

    it('19. should exclude users located outside the configured proximity radius', async () => {
      const spatialMock = setupSpatialMock();
      try {
        const nearby = await getNearbyUsers({
          officeId: officeA,
          location: pivotLocation,
          radius: PROXIMITY_RADIUS,
          excludeUserId: pivotUserId
        });

        const hasElena = nearby.some((u) => u.displayName.includes('Elena'));
        const hasFrank = nearby.some((u) => u.displayName.includes('Frank'));

        assert.strictEqual(hasElena, false, 'Elena at 105px must be excluded from 100px radius');
        assert.strictEqual(hasFrank, false, 'Frank at 150px must be excluded from 100px radius');
      } finally {
        spatialMock.mock.restore();
      }
    });

    it('20. should test boundary cases around configured radius (exact boundary, just inside, just outside, and custom radii)', async () => {
      const spatialMock = setupSpatialMock();
      try {
        // Standard 100px radius
        const nearby100 = await getNearbyUsers({
          officeId: officeA,
          location: pivotLocation,
          radius: 100,
          excludeUserId: pivotUserId
        });

        const carol = nearby100.find((u) => u.displayName.includes('Carol'));
        const david = nearby100.find((u) => u.displayName.includes('David'));
        const elena = nearby100.find((u) => u.displayName.includes('Elena'));

        // Just inside (95.0px): included with positive volume
        assert.ok(carol, 'Carol at 95px must be included');
        assert.ok(carol.gain > 0, 'Volume at 95px should be positive');

        // Exact boundary (100.0px): included with 0.0 volume
        assert.ok(david, 'David at exact 100px boundary must be included');
        assert.strictEqual(david.volume, 0.0, 'Volume at exact boundary must attenuate to 0.0');

        // Just outside (105.0px): excluded
        assert.strictEqual(elena, undefined, 'Elena at 105px must be excluded');

        // Custom radius: 50px whisper zone
        const nearby50 = await getNearbyUsers({
          officeId: officeA,
          location: pivotLocation,
          radius: 50,
          excludeUserId: pivotUserId
        });

        // At 50px, Alice (20px) is inside, Bob (50px) is at exact boundary, Carol (95px) is outside
        assert.strictEqual(nearby50.length, 2, 'Whisper zone should return Alice and Bob only');
        assert.strictEqual(nearby50[0].displayName, 'Alice (Close)');
        assert.strictEqual(nearby50[1].displayName, 'Bob (Mid)');
        assert.strictEqual(nearby50[1].volume, 0.0, 'Bob at 50px boundary has 0.0 volume in 50px whisper zone');
      } finally {
        spatialMock.mock.restore();
      }
    });
  });
});

