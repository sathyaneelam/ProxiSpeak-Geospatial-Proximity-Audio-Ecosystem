const { DEFAULT_EARSHOT_RADIUS } = require("../config/constants");

/**
 * Calculates Euclidean distance between two 2D points in pixel coordinates.
 * @param {{x: number, y: number}} posA
 * @param {{x: number, y: number}} posB
 * @returns {number} Distance in pixels
 */
function calculateDistance(posA, posB) {
  if (
    !posA ||
    !posB ||
    typeof posA.x !== "number" ||
    typeof posA.y !== "number" ||
    typeof posB.x !== "number" ||
    typeof posB.y !== "number"
  ) {
    return Infinity;
  }
  const dx = posA.x - posB.x;
  const dy = posA.y - posB.y;
  return Math.hypot(dx, dy);
}

/**
 * Checks whether two positions are within earshot radius.
 * @param {{x: number, y: number}} posA
 * @param {{x: number, y: number}} posB
 * @param {number} [radius]
 * @returns {boolean}
 */
function isWithinEarshot(posA, posB, radius = DEFAULT_EARSHOT_RADIUS) {
  const d = calculateDistance(posA, posB);
  return d <= radius;
}

/**
 * Determines proximity transitions (entered earshot, left earshot, maintained)
 * for a moving peer relative to other peers in the same office.
 * @param {object} mover - Current peer state with { socketId, x, y, proximityPeers }
 * @param {Array<object>} otherPeers - Array of other peer states in the same office
 * @param {number} [radius] - Earshot radius in pixels
 * @returns {{ entered: Array<object>, left: Array<object>, maintained: Array<object>, currentWithinEarshot: Array<object> }}
 */
function detectProximityTransitions(mover, otherPeers, radius = DEFAULT_EARSHOT_RADIUS) {
  const entered = [];
  const left = [];
  const maintained = [];
  const currentWithinEarshot = [];

  const previousProximitySet = mover.proximityPeers || new Set();

  for (const peer of otherPeers) {
    if (peer.socketId === mover.socketId) continue;

    const distance = calculateDistance(mover, peer);
    const inRange = distance <= radius;
    const wasInRange = previousProximitySet.has(peer.socketId);

    const peerInfo = {
      socketId: peer.socketId,
      userId: peer.userId,
      displayName: peer.displayName,
      distance: Math.round(distance * 100) / 100,
    };

    if (inRange) {
      currentWithinEarshot.push(peerInfo);
      if (!wasInRange) {
        entered.push(peerInfo);
      } else {
        maintained.push(peerInfo);
      }
    } else {
      if (wasInRange) {
        left.push(peerInfo);
      }
    }
  }

  return { entered, left, maintained, currentWithinEarshot };
}

module.exports = {
  calculateDistance,
  isWithinEarshot,
  detectProximityTransitions,
};
