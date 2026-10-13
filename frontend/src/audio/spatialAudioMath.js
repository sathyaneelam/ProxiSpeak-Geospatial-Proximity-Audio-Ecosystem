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
