const { DEFAULT_EARSHOT_RADIUS, STALE_POSITION_TIMEOUT_MS } = require("../config/constants");
const {
  calculateDistance,
  detectProximityTransitions,
} = require("./proximityService");

class OfficeManager {
  constructor() {
    /** @type {Map<string, Map<string, object>>} officeId -> (socketId -> peerState) */
    this.offices = new Map();
    /** @type {Map<string, string>} socketId -> officeId */
    this.socketToOffice = new Map();
  }

  /**
   * Resets all in-memory state. Used primarily for testing.
   */
  reset() {
    this.offices.clear();
    this.socketToOffice.clear();
  }

  /**
   * Retrieves or initializes an office's peer map.
   * @param {string} officeId
   * @returns {Map<string, object>}
   */
  _getOrCreateOffice(officeId) {
    if (!this.offices.has(officeId)) {
      this.offices.set(officeId, new Map());
    }
    return this.offices.get(officeId);
  }

  /**
   * Joins a user to an office.
   * @param {string} socketId
   * @param {object} params
   * @param {string} params.officeId
   * @param {string} params.userId
   * @param {string} params.displayName
   * @param {number} [params.x=0]
   * @param {number} [params.y=0]
   * @param {number} [params.earshotRadius]
   * @returns {{ peer: object, allPeersInOffice: Array<object>, enteredProximity: Array<object> }}
   */
  joinOffice(socketId, { officeId, userId, displayName, x = 0, y = 0, earshotRadius = DEFAULT_EARSHOT_RADIUS }) {
    if (this.socketToOffice.has(socketId)) {
      this.leaveOffice(socketId);
    }

    const officePeers = this._getOrCreateOffice(officeId);
    const peer = {
      socketId,
      userId: userId || socketId,
      displayName: displayName || "Anonymous",
      officeId,
      x: Number(x) || 0,
      y: Number(y) || 0,
      lastActive: Date.now(),
      proximityPeers: new Set(),
    };

    const enteredProximity = [];
    const allPeersInOffice = [];

    for (const [otherSocketId, otherPeer] of officePeers.entries()) {
      const distance = calculateDistance(peer, otherPeer);
      const isNearby = distance <= earshotRadius;

      if (isNearby) {
        peer.proximityPeers.add(otherSocketId);
        otherPeer.proximityPeers.add(socketId);
        enteredProximity.push({
          socketId: otherSocketId,
          userId: otherPeer.userId,
          displayName: otherPeer.displayName,
          distance: Math.round(distance * 100) / 100,
        });
      }

      allPeersInOffice.push({
        socketId: otherPeer.socketId,
        userId: otherPeer.userId,
        displayName: otherPeer.displayName,
        x: otherPeer.x,
        y: otherPeer.y,
        distance: Math.round(distance * 100) / 100,
        isWithinEarshot: isNearby,
      });
    }

    officePeers.set(socketId, peer);
    this.socketToOffice.set(socketId, officeId);

    return {
      peer,
      allPeersInOffice,
      enteredProximity,
    };
  }

  /**
   * Removes a peer from their current office.
   * @param {string} socketId
   * @returns {{ peer: object|null, affectedProximityPeers: Array<object> }}
   */
  leaveOffice(socketId) {
    const officeId = this.socketToOffice.get(socketId);
    if (!officeId) {
      return { peer: null, affectedProximityPeers: [] };
    }

    const officePeers = this.offices.get(officeId);
    if (!officePeers || !officePeers.has(socketId)) {
      this.socketToOffice.delete(socketId);
      return { peer: null, affectedProximityPeers: [] };
    }

    const peer = officePeers.get(socketId);
    const affectedProximityPeers = [];

    // Notify/cleanup peers that had active proximity with this peer
    for (const proxSocketId of peer.proximityPeers) {
      const otherPeer = officePeers.get(proxSocketId);
      if (otherPeer) {
        otherPeer.proximityPeers.delete(socketId);
        affectedProximityPeers.push({
          socketId: otherPeer.socketId,
          userId: otherPeer.userId,
        });
      }
    }

    officePeers.delete(socketId);
    this.socketToOffice.delete(socketId);

    if (officePeers.size === 0) {
      this.offices.delete(officeId);
    }

    return { peer, affectedProximityPeers };
  }

  /**
   * Updates avatar coordinates and recalculates proximity transitions.
   * @param {string} socketId
   * @param {number} x
   * @param {number} y
   * @param {number} [earshotRadius]
   * @returns {{ peer: object|null, entered: Array<object>, left: Array<object>, maintained: Array<object>, currentWithinEarshot: Array<object> }|null}
   */
  updatePosition(socketId, x, y, earshotRadius = DEFAULT_EARSHOT_RADIUS) {
    const peer = this.getPeer(socketId);
    if (!peer) {
      return null;
    }

    peer.x = Number(x);
    peer.y = Number(y);
    peer.lastActive = Date.now();

    const officePeers = this.offices.get(peer.officeId);
    const otherPeers = Array.from(officePeers.values()).filter((p) => p.socketId !== socketId);

    const transitions = detectProximityTransitions(peer, otherPeers, earshotRadius);

    // Apply bidirectional proximity set updates
    for (const enteredPeer of transitions.entered) {
      peer.proximityPeers.add(enteredPeer.socketId);
      const other = officePeers.get(enteredPeer.socketId);
      if (other) {
        other.proximityPeers.add(socketId);
      }
    }

    for (const leftPeer of transitions.left) {
      peer.proximityPeers.delete(leftPeer.socketId);
      const other = officePeers.get(leftPeer.socketId);
      if (other) {
        other.proximityPeers.delete(socketId);
      }
    }

    return {
      peer,
      entered: transitions.entered,
      left: transitions.left,
      maintained: transitions.maintained,
      currentWithinEarshot: transitions.currentWithinEarshot,
    };
  }

  /**
   * Updates lastActive timestamp (heartbeat).
   * @param {string} socketId
   */
  touch(socketId) {
    const peer = this.getPeer(socketId);
    if (peer) {
      peer.lastActive = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Gets a peer by socket ID.
   * @param {string} socketId
   * @returns {object|null}
   */
  getPeer(socketId) {
    const officeId = this.socketToOffice.get(socketId);
    if (!officeId) return null;
    const office = this.offices.get(officeId);
    return office ? office.get(socketId) || null : null;
  }

  /**
   * Gets all peers currently in the specified office.
   * @param {string} officeId
   * @returns {Array<object>}
   */
  getPeersInOffice(officeId) {
    const office = this.offices.get(officeId);
    if (!office) return [];
    return Array.from(office.values());
  }

  /**
   * Checks whether two peers are eligible for WebRTC signaling:
   * 1. Both peers must be connected and registered.
   * 2. Both peers must be in the exact same office.
   * 3. The 2D Euclidean distance between them must be within earshot radius.
   *
   * @param {string} fromSocketId
   * @param {string} toSocketId
   * @param {number} [earshotRadius]
   * @returns {{ eligible: boolean, code?: string, message?: string, distance?: number }}
   */
  isEligibleForSignaling(fromSocketId, toSocketId, earshotRadius = DEFAULT_EARSHOT_RADIUS) {
    const fromPeer = this.getPeer(fromSocketId);
    if (!fromPeer) {
      return {
        eligible: false,
        code: "SENDER_NOT_IN_OFFICE",
        message: "Sender is not registered in an office.",
      };
    }

    const toPeer = this.getPeer(toSocketId);
    if (!toPeer) {
      return {
        eligible: false,
        code: "TARGET_NOT_FOUND",
        message: "Target peer is not connected or not in an office.",
      };
    }

    if (fromPeer.officeId !== toPeer.officeId) {
      return {
        eligible: false,
        code: "DIFFERENT_OFFICE",
        message: "Peers are in different offices.",
      };
    }

    const distance = calculateDistance(fromPeer, toPeer);
    if (distance > earshotRadius) {
      return {
        eligible: false,
        code: "PEER_OUT_OF_RANGE",
        message: `Peer is outside earshot radius (${Math.round(distance)}px > ${earshotRadius}px).`,
        distance: Math.round(distance * 100) / 100,
      };
    }

    return {
      eligible: true,
      distance: Math.round(distance * 100) / 100,
    };
  }

  /**
   * Finds and returns peers that have been inactive longer than the stale timeout.
   * @param {number} [timeoutMs]
   * @returns {Array<object>} List of stale peers
   */
  getStalePeers(timeoutMs = STALE_POSITION_TIMEOUT_MS) {
    const now = Date.now();
    const stalePeers = [];

    for (const [officeId, peers] of this.offices.entries()) {
      for (const [socketId, peer] of peers.entries()) {
        if (now - peer.lastActive > timeoutMs) {
          stalePeers.push({ ...peer });
        }
      }
    }

    return stalePeers;
  }
}

// Export singleton instance as well as class for testing
const defaultManager = new OfficeManager();
module.exports = defaultManager;
module.exports.OfficeManager = OfficeManager;
