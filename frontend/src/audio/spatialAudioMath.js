/**
 * ProxiSpeak Spatial Audio Math Utilities
 *
 * Provides mathematical functions for proximity calculation,
 * distance-based gain attenuation, and stereo panning in 2D space.
 */

export const DEFAULT_EARSHOT_RADIUS = 100; // Configurable default: 100 pixels

/**
 * Calculates Euclidean distance between two 2D points.
 * @param {number} x1 - X coordinate of point 1
 * @param {number} y1 - Y coordinate of point 1
 * @param {number} x2 - X coordinate of point 2
 * @param {number} y2 - Y coordinate of point 2
 * @returns {number} Distance in pixels
 */
export function computeDistance(x1, y1, x2, y2) {
  if (
    typeof x1 !== 'number' || typeof y1 !== 'number' ||
    typeof x2 !== 'number' || typeof y2 !== 'number' ||
    Number.isNaN(x1) || Number.isNaN(y1) || Number.isNaN(x2) || Number.isNaN(y2)
  ) {
    return Infinity;
  }
  return Math.hypot(x2 - x1, y2 - y1);
}

/**
 * Checks if a given distance is within the earshot radius.
 * @param {number} distance - Distance in pixels
 * @param {number} radius - Earshot radius (default: DEFAULT_EARSHOT_RADIUS)
 * @returns {boolean}
 */
export function isWithinEarshot(distance, radius = DEFAULT_EARSHOT_RADIUS) {
  if (typeof distance !== 'number' || Number.isNaN(distance) || distance < 0) return false;
  return distance <= radius;
}

/**
 * Computes proximity gain with smooth attenuation curve.
 * Clamps output strictly within [0.0, 1.0].
 *
 * Formula uses smoothstep interpolation:
 *   t = distance / radius
 *   gain = 1 - (3 * t^2 - 2 * t^3)
 * This guarantees zero first-derivative at the center (t=0) and perimeter (t=1),
 * preventing audible clicks and sharp cutoff edges.
 *
 * @param {number} distance - Distance in pixels
 * @param {number} radius - Earshot radius in pixels (must be > 0)
 * @param {'smooth' | 'linear'} curve - Attenuation curve type
 * @returns {number} Gain value clamped between 0.0 and 1.0
 */
export function computeSpatialGain(distance, radius = DEFAULT_EARSHOT_RADIUS, curve = 'smooth') {
  if (
    typeof distance !== 'number' || Number.isNaN(distance) ||
    typeof radius !== 'number' || Number.isNaN(radius) || radius <= 0
  ) {
    return 0.0;
  }

  if (distance >= radius) return 0.0;
  if (distance <= 0) return 1.0;

  const t = Math.min(1.0, Math.max(0.0, distance / radius));

  if (curve === 'linear') {
    const gain = 1.0 - t;
    return Math.max(0.0, Math.min(1.0, gain));
  }

  // Smoothstep (Hermite interpolation): 1 - (3t^2 - 2t^3)
  const smoothFactor = 1.0 - (3 * t * t - 2 * t * t * t);
  return Math.max(0.0, Math.min(1.0, Math.round(smoothFactor * 10000) / 10000));
}

/**
 * Computes stereo panning parameter for Web Audio API StereoPannerNode.
 * Output is strictly clamped within [-1.0, 1.0].
 *
 * -1.0 = full left (peer is directly to the left)
 *  0.0 = center (peer is aligned horizontally)
 * +1.0 = full right (peer is directly to the right)
 *
 * @param {number} localX - Local user's X coordinate
 * @param {number} peerX - Remote peer's X coordinate
 * @param {number} radius - Earshot radius for normalization
 * @returns {number} Pan value in range [-1.0, 1.0]
 */
export function computeStereoPan(localX, peerX, radius = DEFAULT_EARSHOT_RADIUS) {
  if (
    typeof localX !== 'number' || typeof peerX !== 'number' ||
    typeof radius !== 'number' || radius <= 0 ||
    Number.isNaN(localX) || Number.isNaN(peerX) || Number.isNaN(radius)
  ) {
    return 0.0;
  }

  const dx = peerX - localX;
  const normalized = dx / radius;

  // Clamp strictly between -1.0 and 1.0
  const clamped = Math.max(-1.0, Math.min(1.0, normalized));
  return Math.round(clamped * 10000) / 10000;
}

/**
 * Obstacle Sound Transmission coefficients based on Member 1's Obstacle model
 * Enum: ['desk', 'table', 'sofa', 'coffee', 'counter', 'wall', 'custom']
 * Values in range [0.0, 1.0]: lower = higher acoustic absorption / blocking
 */
export const OBSTACLE_TRANSMISSION = {
  wall: 0.1,      // Heavy structural wall: 90% sound blocked
  counter: 0.4,   // Solid high counter: 60% sound blocked
  sofa: 0.5,      // Soft upholstered furniture: 50% sound absorbed
  desk: 0.65,     // Office desk: 35% sound blocked
  table: 0.7,     // Conference / dining table: 30% sound blocked
  coffee: 0.85,   // Low coffee table: 15% sound blocked
  custom: 0.5,    // Default custom obstacle damping: 50%
};

/**
 * Checks if a 2D point is inside an axis-aligned bounding box.
 */
export function isPointInsideRect(px, py, rx, ry, rw, rh) {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

/**
 * Determines whether two 2D line segments intersect.
 */
export function lineSegmentsIntersect(p1, p2, p3, p4) {
  const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  return (
    ccw(p1, p3, p4) !== ccw(p2, p3, p4) &&
    ccw(p1, p2, p3) !== ccw(p1, p2, p4)
  );
}

/**
 * Checks if a line-of-sight between two points is obstructed by a rectangular obstacle.
 * Compatible with Member 1's Obstacle schema: { x, y, w, h, type?, isCollidable? }
 */
export function lineIntersectsObstacle(p1, p2, obstacle) {
  if (!p1 || !p2 || !obstacle) return false;
  const { x, y, w, h } = obstacle;
  if (
    typeof x !== 'number' || typeof y !== 'number' ||
    typeof w !== 'number' || typeof h !== 'number' ||
    w <= 0 || h <= 0
  ) {
    return false;
  }

  // If either listener or speaker is strictly inside obstacle bounds
  if (isPointInsideRect(p1.x, p1.y, x, y, w, h) || isPointInsideRect(p2.x, p2.y, x, y, w, h)) {
    return true;
  }

  const tl = { x, y };
  const tr = { x: x + w, y };
  const bl = { x, y: y + h };
  const br = { x: x + w, y: y + h };

  return (
    lineSegmentsIntersect(p1, p2, tl, tr) ||
    lineSegmentsIntersect(p1, p2, tr, br) ||
    lineSegmentsIntersect(p1, p2, br, bl) ||
    lineSegmentsIntersect(p1, p2, bl, tl)
  );
}

/**
 * Computes acoustic attenuation multiplier from obstacles intersecting the line of sight.
 * Combines transmission coefficients of all intersecting obstacles.
 * Output is strictly clamped within [0.0, 1.0].
 *
 * @param {{ x: number, y: number }} p1 - Position 1 (listener)
 * @param {{ x: number, y: number }} p2 - Position 2 (sound source / peer)
 * @param {Array<Object>} [obstacles] - Array of obstacles from Member 1 schema
 * @returns {number} Attenuation factor in range [0.0, 1.0]
 */
export function computeObstacleAttenuation(p1, p2, obstacles = []) {
  if (!p1 || !p2 || !Array.isArray(obstacles) || obstacles.length === 0) {
    return 1.0;
  }

  let factor = 1.0;

  for (const obs of obstacles) {
    if (!obs) continue;
    if (lineIntersectsObstacle(p1, p2, obs)) {
      const type = (obs.type || 'desk').toLowerCase();
      const transmission = OBSTACLE_TRANSMISSION[type] ?? 0.5;
      factor *= transmission;
    }
  }

  return Math.max(0.0, Math.min(1.0, Math.round(factor * 10000) / 10000));
}
