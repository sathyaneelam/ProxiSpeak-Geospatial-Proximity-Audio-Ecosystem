import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EARSHOT_RADIUS,
  computeDistance,
  isWithinEarshot,
  computeSpatialGain,
  computeStereoPan,
  isPointInsideRect,
  lineSegmentsIntersect,
  lineIntersectsObstacle,
  computeObstacleAttenuation,
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

  test('isPointInsideRect correctly checks point boundary', () => {
    assert.equal(isPointInsideRect(150, 150, 100, 100, 100, 100), true);
    assert.equal(isPointInsideRect(50, 150, 100, 100, 100, 100), false);
    assert.equal(isPointInsideRect(100, 100, 100, 100, 100, 100), true);
  });

  test('lineSegmentsIntersect detects crossing segments', () => {
    // Cross: (0, 0)->(10, 10) and (0, 10)->(10, 0)
    assert.equal(
      lineSegmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }),
      true
    );
    // Parallel: (0, 0)->(10, 0) and (0, 5)->(10, 5)
    assert.equal(
      lineSegmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }),
      false
    );
  });

  test('lineIntersectsObstacle detects obstacle intersection', () => {
    const wall = { x: 100, y: 100, w: 20, h: 200, type: 'wall' };
    // Ray crossing the wall from x=50 to x=150 at y=150
    assert.equal(lineIntersectsObstacle({ x: 50, y: 150 }, { x: 150, y: 150 }, wall), true);
    // Ray to the side of the wall
    assert.equal(lineIntersectsObstacle({ x: 50, y: 50 }, { x: 150, y: 50 }, wall), false);
    // Ray ending inside the wall
    assert.equal(lineIntersectsObstacle({ x: 50, y: 150 }, { x: 110, y: 150 }, wall), true);
  });

  test('computeObstacleAttenuation dampens sound according to obstacle type', () => {
    const wall = { x: 100, y: 100, w: 20, h: 200, type: 'wall' };
    const desk = { x: 200, y: 100, w: 50, h: 50, type: 'desk' };

    // Unobstructed path
    assert.equal(computeObstacleAttenuation({ x: 50, y: 50 }, { x: 80, y: 50 }, [wall, desk]), 1.0);

    // Wall obstructed path (0.1 transmission)
    assert.equal(computeObstacleAttenuation({ x: 50, y: 150 }, { x: 150, y: 150 }, [wall]), 0.1);

    // Desk obstructed path (0.65 transmission)
    assert.equal(computeObstacleAttenuation({ x: 180, y: 125 }, { x: 260, y: 125 }, [desk]), 0.65);

    // Double obstruction: crosses wall and desk (0.1 * 0.65 = 0.065)
    assert.equal(computeObstacleAttenuation({ x: 50, y: 125 }, { x: 260, y: 125 }, [wall, desk]), 0.065);
  });
});
