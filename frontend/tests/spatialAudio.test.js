import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateDistance,
  calculateGain,
  calculatePan,
  clamp,
  isWithinEarshot,
  smoothAudioParam,
  DEFAULT_EARSHOT_RADIUS,
} from '../src/audio/spatialAudio.js';

describe('Spatial Audio Math & Attenuation', () => {
  describe('clamp()', () => {
    it('clamps values below minimum', () => {
      assert.strictEqual(clamp(-5, 0, 10), 0);
      assert.strictEqual(clamp(-1.5, -1.0, 1.0), -1.0);
    });

    it('clamps values above maximum', () => {
      assert.strictEqual(clamp(15, 0, 10), 10);
      assert.strictEqual(clamp(2.3, -1.0, 1.0), 1.0);
    });

    it('preserves values within range', () => {
      assert.strictEqual(clamp(0.42, 0, 1), 0.42);
      assert.strictEqual(clamp(-0.5, -1.0, 1.0), -0.5);
    });

    it('handles non-finite values safely', () => {
      assert.strictEqual(clamp(NaN, 0, 1), 0);
      assert.strictEqual(clamp(Infinity, 0, 1), 0);
    });
  });

  describe('calculateDistance()', () => {
    it('calculates 0 distance for identical coordinates', () => {
      const p = { x: 300, y: 400 };
      assert.strictEqual(calculateDistance(p, p), 0);
    });

    it('calculates pure horizontal distance', () => {
      const p1 = { x: 100, y: 200 };
      const p2 = { x: 180, y: 200 };
      assert.strictEqual(calculateDistance(p1, p2), 80);
    });

    it('calculates pure vertical distance', () => {
      const p1 = { x: 100, y: 200 };
      const p2 = { x: 100, y: 260 };
      assert.strictEqual(calculateDistance(p1, p2), 60);
    });

    it('calculates Euclidean diagonal distance (3-4-5 triangle)', () => {
      const p1 = { x: 10, y: 10 };
      const p2 = { x: 40, y: 50 }; // dx = 30, dy = 40 -> hypot = 50
      assert.strictEqual(calculateDistance(p1, p2), 50);
    });

    it('returns Infinity for invalid or missing coordinates', () => {
      assert.strictEqual(calculateDistance(null, { x: 0, y: 0 }), Infinity);
      assert.strictEqual(calculateDistance({ x: NaN, y: 0 }, { x: 0, y: 0 }), Infinity);
      assert.strictEqual(calculateDistance({ x: 0, y: 0 }, { x: 0, y: undefined }), Infinity);
    });
  });

  describe('calculateGain() distance attenuation', () => {
    const R = DEFAULT_EARSHOT_RADIUS; // 100px

    it('yields maximum gain 1.0 at distance 0 (identical position)', () => {
      assert.strictEqual(calculateGain(0, R), 1.0);
    });

    it('yields 0.5 gain at halfway distance (50px / 100px)', () => {
      assert.strictEqual(calculateGain(50, R), 0.5);
    });

    it('yields 0.25 gain at 75px distance', () => {
      assert.strictEqual(calculateGain(75, R), 0.25);
    });

    it('yields 0.0 gain exactly at earshot radius boundary (100px)', () => {
      assert.strictEqual(calculateGain(100, R), 0.0);
    });

    it('clamps gain to 0.0 beyond earshot radius (> 100px)', () => {
      assert.strictEqual(calculateGain(101, R), 0.0);
      assert.strictEqual(calculateGain(250, R), 0.0);
      assert.strictEqual(calculateGain(1000, R), 0.0);
    });

    it('decreases monotonically as distance increases', () => {
      const g0 = calculateGain(0, R);
      const g25 = calculateGain(25, R);
      const g50 = calculateGain(50, R);
      const g75 = calculateGain(75, R);
      const g100 = calculateGain(100, R);

      assert.ok(g0 > g25, 'g0 > g25');
      assert.ok(g25 > g50, 'g25 > g50');
      assert.ok(g50 > g75, 'g50 > g75');
      assert.ok(g75 > g100, 'g75 > g100');
      assert.strictEqual(g100, 0);
    });

    it('supports smooth attenuation curve (raised cosine)', () => {
      assert.strictEqual(calculateGain(0, R, 'smooth'), 1.0);
      assert.strictEqual(calculateGain(100, R, 'smooth'), 0.0);
      // At halfway, 0.5 * (1 + cos(pi/2)) = 0.5 * (1 + 0) = 0.5
      assert.ok(Math.abs(calculateGain(50, R, 'smooth') - 0.5) < 1e-6);
    });

    it('handles negative or non-finite distance safely', () => {
      assert.strictEqual(calculateGain(-10, R), 0.0);
      assert.strictEqual(calculateGain(NaN, R), 0.0);
      assert.strictEqual(calculateGain(Infinity, R), 0.0);
    });
  });

  describe('calculatePan() stereo panning', () => {
    const R = 100;
    const listener = { x: 500, y: 300 };

    it('yields center pan 0.0 when horizontally aligned', () => {
      const peer = { x: 500, y: 350 }; // dx = 0
      assert.strictEqual(calculatePan(listener, peer, R), 0.0);
    });

    it('yields -1.0 (full left) when peer is 100px to the left', () => {
      const peer = { x: 400, y: 300 }; // dx = -100
      assert.strictEqual(calculatePan(listener, peer, R), -1.0);
    });

    it('yields +1.0 (full right) when peer is 100px to the right', () => {
      const peer = { x: 600, y: 300 }; // dx = +100
      assert.strictEqual(calculatePan(listener, peer, R), 1.0);
    });

    it('yields -0.5 when peer is 50px to the left', () => {
      const peer = { x: 450, y: 300 }; // dx = -50
      assert.strictEqual(calculatePan(listener, peer, R), -0.5);
    });

    it('yields +0.5 when peer is 50px to the right', () => {
      const peer = { x: 550, y: 300 }; // dx = +50
      assert.strictEqual(calculatePan(listener, peer, R), 0.5);
    });

    it('clamps pan to -1.0 when peer is further than earshot to the left', () => {
      const peer = { x: 200, y: 300 }; // dx = -300
      assert.strictEqual(calculatePan(listener, peer, R), -1.0);
    });

    it('clamps pan to +1.0 when peer is further than earshot to the right', () => {
      const peer = { x: 800, y: 300 }; // dx = +300
      assert.strictEqual(calculatePan(listener, peer, R), 1.0);
    });

    it('handles invalid coordinates safely by defaulting to 0.0', () => {
      assert.strictEqual(calculatePan(null, { x: 100, y: 100 }), 0.0);
      assert.strictEqual(calculatePan({ x: NaN, y: 0 }, { x: 100, y: 100 }), 0.0);
    });
  });

  describe('isWithinEarshot()', () => {
    it('returns true when distance <= radius', () => {
      assert.strictEqual(isWithinEarshot({ x: 0, y: 0 }, { x: 60, y: 0 }, 100), true);
      assert.strictEqual(isWithinEarshot({ x: 0, y: 0 }, { x: 100, y: 0 }, 100), true);
    });

    it('returns false when distance > radius', () => {
      assert.strictEqual(isWithinEarshot({ x: 0, y: 0 }, { x: 100.1, y: 0 }, 100), false);
      assert.strictEqual(isWithinEarshot({ x: 0, y: 0 }, { x: 200, y: 0 }, 100), false);
    });
  });

  describe('smoothAudioParam()', () => {
    it('calls setTargetAtTime on valid AudioParam and AudioContext', () => {
      let calledTarget = null;
      let calledTime = null;
      let calledConstant = null;

      const mockParam = {
        value: 0,
        setTargetAtTime(target, time, constant) {
          calledTarget = target;
          calledTime = time;
          calledConstant = constant;
          this.value = target;
        },
      };

      const mockCtx = { currentTime: 1.25 };

      smoothAudioParam(mockParam, 0.75, mockCtx, 0.05);
      assert.strictEqual(calledTarget, 0.75);
      assert.strictEqual(calledTime, 1.25);
      assert.strictEqual(calledConstant, 0.05);
      assert.strictEqual(mockParam.value, 0.75);
    });

    it('falls back to direct value assignment if setTargetAtTime is unavailable', () => {
      const mockParam = { value: 0 };
      smoothAudioParam(mockParam, 0.8, null);
      assert.strictEqual(mockParam.value, 0.8);
    });

    it('handles non-finite target value by falling back to 0', () => {
      const mockParam = { value: 1 };
      smoothAudioParam(mockParam, NaN, null);
      assert.strictEqual(mockParam.value, 0);
    });
  });
});
