const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  calculateDistance,
  calculateAudioVolume
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
    const { calculateStereoPan, isWithinEarshot } = require('../../src/services/positionService');
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
});
