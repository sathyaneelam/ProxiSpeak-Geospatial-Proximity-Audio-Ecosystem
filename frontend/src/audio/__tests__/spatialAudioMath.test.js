import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EARSHOT_RADIUS,
  computeDistance,
  isWithinEarshot,
  computeSpatialGain,
  computeStereoPan,
} from '../spatialAudioMath.js';

describe('Spatial Audio Math - Proximity and Attenuation', () => {
  test('DEFAULT_EARSHOT_RADIUS is 100 pixels', () => {
    assert.equal(DEFAULT_EARSHOT_RADIUS, 100);
  });

  test('computeDistance computes exact Euclidean distance', () => {
    assert.equal(computeDistance(0, 0, 3, 4), 5);
    assert.equal(computeDistance(100, 100, 100, 100), 0);
    assert.equal(computeDistance(50, 50, 150, 50), 100);
  });

  test('computeDistance handles invalid or missing inputs safely', () => {
    assert.equal(computeDistance(NaN, 0, 0, 0), Infinity);
    assert.equal(computeDistance(undefined, 0, 0, 0), Infinity);
    assert.equal(computeDistance(0, 'invalid', 0, 0), Infinity);
  });

  test('isWithinEarshot respects configurable radius', () => {
    assert.equal(isWithinEarshot(50, 100), true);
    assert.equal(isWithinEarshot(100, 100), true);
    assert.equal(isWithinEarshot(100.1, 100), false);
    assert.equal(isWithinEarshot(200, 100), false);
    assert.equal(isWithinEarshot(-5, 100), false);
  });

  test('computeSpatialGain clamps to 1.0 at distance 0 and 0.0 at/beyond earshot radius', () => {
    assert.equal(computeSpatialGain(0, 100), 1.0);
    assert.equal(computeSpatialGain(100, 100), 0.0);
    assert.equal(computeSpatialGain(150, 100), 0.0);
    assert.equal(computeSpatialGain(999, 100), 0.0);
  });

  test('computeSpatialGain smoothstep curve produces smooth, monotonically decreasing gain', () => {
    const gain25 = computeSpatialGain(25, 100);
    const gain50 = computeSpatialGain(50, 100);
    const gain75 = computeSpatialGain(75, 100);

    assert.ok(gain25 < 1.0 && gain25 > gain50);
    assert.ok(gain50 > gain75);
    assert.ok(gain75 > 0.0);
    // Smoothstep at t=0.5: 1 - (3*0.25 - 2*0.125) = 1 - (0.75 - 0.25) = 0.5
    assert.equal(gain50, 0.5);
  });

  test('computeSpatialGain linear curve works correctly', () => {
    assert.equal(computeSpatialGain(0, 100, 'linear'), 1.0);
    assert.equal(computeSpatialGain(50, 100, 'linear'), 0.5);
    assert.equal(computeSpatialGain(100, 100, 'linear'), 0.0);
  });

  test('computeStereoPan correctly computes left, center, and right panning', () => {
    // Local at x=500
    // Peer to the left at x=400 (dx = -100, radius = 100) -> -1.0
    assert.equal(computeStereoPan(500, 400, 100), -1.0);

    // Peer directly in line (dx = 0) -> 0.0
    assert.equal(computeStereoPan(500, 500, 100), 0.0);

    // Peer to the right at x=600 (dx = +100, radius = 100) -> +1.0
    assert.equal(computeStereoPan(500, 600, 100), 1.0);

    // Peer partially to the left (dx = -50, radius = 100) -> -0.5
    assert.equal(computeStereoPan(500, 450, 100), -0.5);

    // Clamping beyond radius
    assert.equal(computeStereoPan(500, 200, 100), -1.0);
    assert.equal(computeStereoPan(500, 800, 100), 1.0);
  });

  test('computeStereoPan handles invalid coordinates safely', () => {
    assert.equal(computeStereoPan(NaN, 500, 100), 0.0);
    assert.equal(computeStereoPan(500, undefined, 100), 0.0);
  });
});
