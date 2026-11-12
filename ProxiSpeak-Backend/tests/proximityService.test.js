const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  calculateDistance,
  isWithinEarshot,
  detectProximityTransitions,
} = require("../src/services/proximityService");

describe("ProximityService - 2D Pixel Calculations", () => {
  it("should calculate exact Euclidean distance between two points", () => {
    // 0 distance
    assert.strictEqual(calculateDistance({ x: 50, y: 50 }, { x: 50, y: 50 }), 0);

    // Horizontal distance
    assert.strictEqual(calculateDistance({ x: 0, y: 0 }, { x: 100, y: 0 }), 100);

    // Vertical distance
    assert.strictEqual(calculateDistance({ x: 0, y: 0 }, { x: 0, y: 75 }), 75);

    // Diagonal (3-4-5 triangle)
    assert.strictEqual(calculateDistance({ x: 0, y: 0 }, { x: 30, y: 40 }), 50);
  });

  it("should return Infinity for invalid or missing coordinates", () => {
    assert.strictEqual(calculateDistance(null, { x: 10, y: 10 }), Infinity);
    assert.strictEqual(calculateDistance({ x: "invalid", y: 10 }, { x: 10, y: 10 }), Infinity);
    assert.strictEqual(calculateDistance({ x: 10, y: 10 }, undefined), Infinity);
  });

  it("should correctly evaluate isWithinEarshot based on configured radius", () => {
    const p1 = { x: 100, y: 100 };
    const p2Nearby = { x: 160, y: 180 }; // distance = 100
    const p3TooFar = { x: 161, y: 180 }; // distance > 100

    assert.strictEqual(isWithinEarshot(p1, p2Nearby, 100), true);
    assert.strictEqual(isWithinEarshot(p1, p3TooFar, 100), false);

    // Custom radius
    assert.strictEqual(isWithinEarshot(p1, { x: 120, y: 100 }, 50), true);
    assert.strictEqual(isWithinEarshot(p1, { x: 160, y: 100 }, 50), false);
  });

  it("should detect transitions: peer entering earshot", () => {
    const mover = {
      socketId: "mover_1",
      userId: "u1",
      x: 100,
      y: 100,
      proximityPeers: new Set(), // previously had no one in earshot
    };

    const peerA = {
      socketId: "peer_a",
      userId: "uA",
      displayName: "Alice",
      x: 150,
      y: 100, // distance = 50 (within 100)
    };

    const transitions = detectProximityTransitions(mover, [peerA], 100);

    assert.strictEqual(transitions.entered.length, 1);
    assert.strictEqual(transitions.entered[0].socketId, "peer_a");
    assert.strictEqual(transitions.entered[0].distance, 50);
    assert.strictEqual(transitions.left.length, 0);
    assert.strictEqual(transitions.maintained.length, 0);
    assert.strictEqual(transitions.currentWithinEarshot.length, 1);
  });

  it("should detect transitions: peer leaving earshot", () => {
    const mover = {
      socketId: "mover_1",
      userId: "u1",
      x: 300,
      y: 300,
      proximityPeers: new Set(["peer_a"]), // previously was in earshot
    };

    const peerA = {
      socketId: "peer_a",
      userId: "uA",
      displayName: "Alice",
      x: 100,
      y: 100, // distance ~282.84 (> 100)
    };

    const transitions = detectProximityTransitions(mover, [peerA], 100);

    assert.strictEqual(transitions.entered.length, 0);
    assert.strictEqual(transitions.left.length, 1);
    assert.strictEqual(transitions.left[0].socketId, "peer_a");
    assert.strictEqual(transitions.maintained.length, 0);
    assert.strictEqual(transitions.currentWithinEarshot.length, 0);
  });

  it("should detect transitions: peer maintaining earshot", () => {
    const mover = {
      socketId: "mover_1",
      userId: "u1",
      x: 110,
      y: 100,
      proximityPeers: new Set(["peer_a"]), // previously in earshot
    };

    const peerA = {
      socketId: "peer_a",
      userId: "uA",
      displayName: "Alice",
      x: 150,
      y: 100, // distance = 40 (still within 100)
    };

    const transitions = detectProximityTransitions(mover, [peerA], 100);

    assert.strictEqual(transitions.entered.length, 0);
    assert.strictEqual(transitions.left.length, 0);
    assert.strictEqual(transitions.maintained.length, 1);
    assert.strictEqual(transitions.maintained[0].socketId, "peer_a");
    assert.strictEqual(transitions.currentWithinEarshot.length, 1);
  });
});
