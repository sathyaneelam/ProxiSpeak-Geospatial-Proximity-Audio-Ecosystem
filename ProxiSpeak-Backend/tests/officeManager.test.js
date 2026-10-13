const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const { OfficeManager } = require("../src/services/officeManager");

describe("OfficeManager - In-Memory State & Signaling Eligibility", () => {
  let manager;

  beforeEach(() => {
    manager = new OfficeManager();
  });

  it("should allow a user to join an office and store state", () => {
    const { peer, allPeersInOffice, enteredProximity } = manager.joinOffice("sock_1", {
      officeId: "office_alpha",
      userId: "u1",
      displayName: "Alice",
      x: 100,
      y: 100,
      earshotRadius: 100,
    });

    assert.strictEqual(peer.socketId, "sock_1");
    assert.strictEqual(peer.officeId, "office_alpha");
    assert.strictEqual(peer.x, 100);
    assert.strictEqual(peer.y, 100);
    assert.strictEqual(allPeersInOffice.length, 0);
    assert.strictEqual(enteredProximity.length, 0);

    const stored = manager.getPeer("sock_1");
    assert.ok(stored);
    assert.strictEqual(stored.displayName, "Alice");
  });

  it("should detect nearby peers on join and update bidirectional proximity sets", () => {
    // Alice joins
    manager.joinOffice("sock_1", {
      officeId: "office_alpha",
      userId: "u1",
      displayName: "Alice",
      x: 100,
      y: 100,
      earshotRadius: 100,
    });

    // Bob joins nearby at (150, 100) -> distance 50px
    const bobResult = manager.joinOffice("sock_2", {
      officeId: "office_alpha",
      userId: "u2",
      displayName: "Bob",
      x: 150,
      y: 100,
      earshotRadius: 100,
    });

    assert.strictEqual(bobResult.enteredProximity.length, 1);
    assert.strictEqual(bobResult.enteredProximity[0].socketId, "sock_1");
    assert.strictEqual(bobResult.enteredProximity[0].distance, 50);

    const alice = manager.getPeer("sock_1");
    const bob = manager.getPeer("sock_2");
    assert.ok(alice.proximityPeers.has("sock_2"));
    assert.ok(bob.proximityPeers.has("sock_1"));
  });

  it("should keep peers in different offices completely isolated", () => {
    manager.joinOffice("sock_1", {
      officeId: "office_A",
      userId: "u1",
      displayName: "Alice",
      x: 100,
      y: 100,
    });

    // Bob is at the exact same coordinates, but in office_B
    const bobResult = manager.joinOffice("sock_2", {
      officeId: "office_B",
      userId: "u2",
      displayName: "Bob",
      x: 100,
      y: 100,
    });

    assert.strictEqual(bobResult.allPeersInOffice.length, 0);
    assert.strictEqual(bobResult.enteredProximity.length, 0);

    // Cross-office signaling check
    const eligibility = manager.isEligibleForSignaling("sock_1", "sock_2", 100);
    assert.strictEqual(eligibility.eligible, false);
    assert.strictEqual(eligibility.code, "DIFFERENT_OFFICE");
  });

  it("should evaluate WebRTC signaling eligibility based on earshot radius", () => {
    manager.joinOffice("sock_1", {
      officeId: "office_alpha",
      userId: "u1",
      x: 0,
      y: 0,
    });

    manager.joinOffice("sock_2", {
      officeId: "office_alpha",
      userId: "u2",
      x: 80,
      y: 0, // distance 80 <= 100
    });

    manager.joinOffice("sock_3", {
      officeId: "office_alpha",
      userId: "u3",
      x: 250,
      y: 0, // distance 250 > 100
    });

    // 1 -> 2 (eligible)
    const check1to2 = manager.isEligibleForSignaling("sock_1", "sock_2", 100);
    assert.strictEqual(check1to2.eligible, true);
    assert.strictEqual(check1to2.distance, 80);

    // 1 -> 3 (out of range)
    const check1to3 = manager.isEligibleForSignaling("sock_1", "sock_3", 100);
    assert.strictEqual(check1to3.eligible, false);
    assert.strictEqual(check1to3.code, "PEER_OUT_OF_RANGE");

    // 1 -> unknown (target not found)
    const checkUnknown = manager.isEligibleForSignaling("sock_1", "sock_999", 100);
    assert.strictEqual(checkUnknown.eligible, false);
    assert.strictEqual(checkUnknown.code, "TARGET_NOT_FOUND");
  });

  it("should clean up proximity and state when a peer leaves", () => {
    manager.joinOffice("sock_1", { officeId: "room_1", userId: "u1", x: 0, y: 0 });
    manager.joinOffice("sock_2", { officeId: "room_1", userId: "u2", x: 50, y: 0 });

    const bob = manager.getPeer("sock_2");
    assert.ok(bob.proximityPeers.has("sock_1"));

    const { peer, affectedProximityPeers } = manager.leaveOffice("sock_1");
    assert.strictEqual(peer.socketId, "sock_1");
    assert.strictEqual(affectedProximityPeers.length, 1);
    assert.strictEqual(affectedProximityPeers[0].socketId, "sock_2");

    // Bob's proximity set should now be empty
    assert.strictEqual(bob.proximityPeers.has("sock_1"), false);
    assert.strictEqual(manager.getPeer("sock_1"), null);
  });

  it("should identify stale peers based on timeout", () => {
    manager.joinOffice("sock_active", { officeId: "room_1", userId: "u1", x: 0, y: 0 });
    manager.joinOffice("sock_stale", { officeId: "room_1", userId: "u2", x: 0, y: 0 });

    // Manually age the stale peer's timestamp
    const stalePeer = manager.getPeer("sock_stale");
    stalePeer.lastActive = Date.now() - 70000;

    const stalePeers = manager.getStalePeers(60000);
    assert.strictEqual(stalePeers.length, 1);
    assert.strictEqual(stalePeers[0].socketId, "sock_stale");
  });
});
