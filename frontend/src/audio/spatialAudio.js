/**
 * ProxiSpeak Spatial Audio Math and Parameter Calculation
 * Member 4: WebRTC, Real-Time Audio & Spatial Audio
 */

export const DEFAULT_EARSHOT_RADIUS = 100;

/**
 * Clamps a numerical value to [min, max].
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculates 2D Euclidean distance between two coordinate points.
 * @param {{ x: number, y: number }} pos1
 * @param {{ x: number, y: number }} pos2
 * @returns {number}
 */
export function calculateDistance(pos1, pos2) {
  if (
    !pos1 ||
    !pos2 ||
    !Number.isFinite(pos1.x) ||
    !Number.isFinite(pos1.y) ||
    !Number.isFinite(pos2.x) ||
    !Number.isFinite(pos2.y)
  ) {
    return Infinity;
  }
  const dx = pos2.x - pos1.x;
  const dy = pos2.y - pos1.y;
  return Math.hypot(dx, dy);
}

/**
 * Calculates distance-based gain attenuation.
 * Uses normalized distance d / r with default curve max(0, 1 - d / r).
 * Clamped strictly to [0.0, 1.0].
 *
 * @param {number} distance - Euclidean distance in pixels
 * @param {number} [earshotRadius=DEFAULT_EARSHOT_RADIUS] - Max hearing distance in pixels
 * @param {'linear' | 'smooth'} [curve='linear'] - Attenuation curve algorithm
 * @returns {number} Gain value in [0.0, 1.0]
 */
export function calculateGain(distance, earshotRadius = DEFAULT_EARSHOT_RADIUS, curve = 'linear') {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  if (!Number.isFinite(earshotRadius) || earshotRadius <= 0) return 0;

  if (distance >= earshotRadius) {
    return 0;
  }

  const normalized = distance / earshotRadius; // in [0, 1)

  if (curve === 'smooth') {
    // Raised cosine / smoothstep attenuation: 0.5 * (1 + cos(pi * d/r))
    // Provides smoother transition at near-zero and earshot boundary
    const gain = 0.5 * (1 + Math.cos(Math.PI * normalized));
    return clamp(gain, 0, 1);
  }

  // Default initial attenuation curve: max(0, 1 - d / r)
  const gain = Math.max(0, 1 - normalized);
  return clamp(gain, 0, 1);
}

/**
 * Calculates stereo panning value based on relative horizontal position.
 * -1.0 represents full left, 0.0 represents center, +1.0 represents full right.
 *
 * @param {{ x: number, y: number }} listenerPos - Position of local listener
 * @param {{ x: number, y: number }} peerPos - Position of remote peer
 * @param {number} [earshotRadius=DEFAULT_EARSHOT_RADIUS] - Earshot radius for pan normalization
 * @returns {number} Pan value clamped to [-1.0, 1.0]
 */
export function calculatePan(listenerPos, peerPos, earshotRadius = DEFAULT_EARSHOT_RADIUS) {
  if (
    !listenerPos ||
    !peerPos ||
    !Number.isFinite(listenerPos.x) ||
    !Number.isFinite(listenerPos.y) ||
    !Number.isFinite(peerPos.x) ||
    !Number.isFinite(peerPos.y) ||
    !Number.isFinite(earshotRadius) ||
    earshotRadius <= 0
  ) {
    return 0;
  }

  const deltaX = peerPos.x - listenerPos.x;
  const rawPan = deltaX / earshotRadius;
  return clamp(rawPan, -1.0, 1.0);
}

/**
 * Determines whether a peer is within earshot radius.
 * @param {{ x: number, y: number }} pos1
 * @param {{ x: number, y: number }} pos2
 * @param {number} [radius=DEFAULT_EARSHOT_RADIUS]
 * @returns {boolean}
 */
export function isWithinEarshot(pos1, pos2, radius = DEFAULT_EARSHOT_RADIUS) {
  if (!Number.isFinite(radius) || radius < 0) {
    return false;
  }

  const dist = calculateDistance(pos1, pos2);
  return Number.isFinite(dist) && dist <= radius;
}

/**
 * Smoothly updates an AudioParam (GainNode.gain or StereoPannerNode.pan)
 * to prevent audible clicks, pops, and zipper noise.
 *
 * @param {AudioParam} audioParam - Target Web Audio API AudioParam
 * @param {number} targetValue - Destination value
 * @param {AudioContext} audioContext - Active AudioContext
 * @param {number} [timeConstant=0.05] - Exponential time constant in seconds (default 50ms)
 */
export function smoothAudioParam(audioParam, targetValue, audioContext, timeConstant = 0.05) {
  if (!audioParam) return;

  const validTarget = Number.isFinite(targetValue) ? targetValue : 0;

  if (
    audioContext &&
    typeof audioContext.currentTime === 'number' &&
    typeof audioParam.setTargetAtTime === 'function'
  ) {
    try {
      audioParam.setTargetAtTime(validTarget, audioContext.currentTime, timeConstant);
    } catch {
      // Fallback in case of invalid state or node disconnection
      audioParam.value = validTarget;
    }
  } else if (typeof audioParam.value === 'number') {
    audioParam.value = validTarget;
  }
}
