const mongoose = require('mongoose');
const LivePosition = require('../models/LivePosition');
const User = require('../models/User');

/**
 * Calculate Euclidean planar distance between two 2D points [x, y] in pixels.
 * Uses Pythagorean theorem: sqrt((x2 - x1)^2 + (y2 - y1)^2)
 *
 * @param {[number, number]} pointA - [x, y] coordinates
 * @param {[number, number]} pointB - [x, y] coordinates
 * @returns {number} Distance in pixels
 */
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function calculateDistance(pointA, pointB) {
  if (!Array.isArray(pointA) || !Array.isArray(pointB) || pointA.length !== 2 || pointB.length !== 2) {
    throw new Error('Points must be 2-element coordinate arrays [x, y]');
  }
  const dx = pointB[0] - pointA[0];
  const dy = pointB[1] - pointA[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate audio gain using the agreed smoothstep attenuation formula:
 *   t = clamp(d/100, 0, 1)
 *   gain = 1 - (3t^2 - 2t^3)
 *
 * @param {number} distance - Distance in pixels
 * @param {number} [radius=100] - Proximity threshold in pixels
 * @returns {number} Gain factor between 0.0 and 1.0
 */
function calculateAudioVolume(distance, radius = 100) {
  if (typeof distance !== 'number' || isNaN(distance) || radius <= 0) return 0;
  if (distance <= 0) return 1.0;
  if (distance >= radius) return 0.0;
  const t = clamp(distance / radius, 0, 1);
  const gain = 1 - (3 * t * t - 2 * t * t * t);
  return Number(clamp(gain, 0, 1).toFixed(4));
}

/**
 * Calculate stereo pan using the agreed formula:
 *   Pan = clamp(dx/100, -1, 1)
 *
 * @param {number} localX - Local user X coordinate
 * @param {number} peerX - Remote peer X coordinate
 * @param {number} [radius=100] - Proximity threshold in pixels
 * @returns {number} Pan factor between -1.0 and 1.0
 */
function calculateStereoPan(localX, peerX, radius = 100) {
  if (typeof localX !== 'number' || typeof peerX !== 'number' || radius <= 0) return 0.0;
  const dx = peerX - localX;
  const pan = clamp(dx / radius, -1, 1);
  return Number(pan.toFixed(4));
}

/**
 * Check if distance is within earshot radius.
 *
 * @param {number} distance
 * @param {number} [radius=100]
 * @returns {boolean}
 */
function isWithinEarshot(distance, radius = 100) {
  if (typeof distance !== 'number' || isNaN(distance) || distance < 0) return false;
  return distance <= radius;
}

/**
 * Validate 2D coordinate pair [x, y].
 *
 * @param {any} location
 * @returns {[number, number]}
 */
function validateCoordinates(location) {
  if (!Array.isArray(location) || location.length !== 2) {
    throw new Error('Location must be a 2-element array [x, y]');
  }
  const [x, y] = location;
  if (typeof x !== 'number' || isNaN(x) || !isFinite(x) ||
      typeof y !== 'number' || isNaN(y) || !isFinite(y)) {
    throw new Error('Coordinates x and y must be finite numbers');
  }
  return [x, y];
}

/**
 * Upsert or update a user's live position in a virtual office.
 * Ensures an existing user's LivePosition is updated rather than creating duplicate documents.
 * Skips redundant database writes if position, office, and socket have not changed.
 *
 * @param {object} params
 * @param {string|mongoose.Types.ObjectId} params.userId - User ObjectId
 * @param {string|mongoose.Types.ObjectId} params.officeId - Office ObjectId
 * @param {[number, number]} params.location - [x, y] screen pixel coordinates
 * @param {string} [params.socketId] - Optional client socket.io connection id
 * @returns {Promise<Document>} The updated/inserted LivePosition document
 */
async function upsertPosition({ userId, officeId, location, socketId = null }) {
  if (!userId) throw new Error('userId is required for position upsert');
  if (!officeId) throw new Error('officeId is required for position upsert');
  const validLocation = validateCoordinates(location);

  // Check if position already exists for this user to avoid redundant writes and preserve unique record
  const existing = await LivePosition.findOne({ userId });

  if (existing) {
    const isSameLocation =
      Array.isArray(existing.location) &&
      existing.location.length === 2 &&
      existing.location[0] === validLocation[0] &&
      existing.location[1] === validLocation[1];

    const isSameOffice = String(existing.officeId) === String(officeId);
    const isSameSocket =
      socketId === undefined ||
      socketId === null ||
      existing.socketId === socketId;

    if (isSameLocation && isSameOffice && isSameSocket) {
      // Avoid unnecessary MongoDB writes where the current position has not changed
      return existing;
    }

    const update = {
      $set: {
        officeId,
        location: validLocation,
        lastUpdated: new Date()
      }
    };

    if (socketId !== undefined) {
      update.$set.socketId = socketId;
    }

    return await LivePosition.findOneAndUpdate({ userId }, update, {
      new: true,
      runValidators: true
    });
  }

  // Create first LivePosition document atomically using upsert
  const filter = { userId };
  const update = {
    $set: {
      officeId,
      location: validLocation,
      socketId,
      lastUpdated: new Date()
    }
  };
  const options = {
    new: true,
    upsert: true,
    runValidators: true,
    setDefaultsOnInsert: true
  };

  return await LivePosition.findOneAndUpdate(filter, update, options);
}

/**
 * High-frequency position update for avatar movement within an office.
 * Updates the single existing LivePosition record in-place.
 * Preserves officeId and socketId associations.
 * Skips redundant writes if coordinates are unchanged.
 * Safely handles missing/non-existing records.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {[number, number]} location - [x, y] coordinates
 * @param {object|string|mongoose.Types.ObjectId} [options] - Optional officeId or options object ({ officeId, socketId })
 * @returns {Promise<Document|null>}
 */
async function updatePosition(userId, location, options = {}) {
  if (!userId) throw new Error('userId is required');
  const validLocation = validateCoordinates(location);

  let targetOfficeId = null;
  let targetSocketId = undefined;

  if (options) {
    if (typeof options === 'string' || options instanceof mongoose.Types.ObjectId) {
      targetOfficeId = options;
    } else if (typeof options === 'object') {
      targetOfficeId = options.officeId || null;
      targetSocketId = options.socketId;
    }
  }

  const existing = await LivePosition.findOne({ userId });

  if (!existing) {
    // Handle the case where a user has no existing LivePosition
    if (targetOfficeId) {
      return await upsertPosition({
        userId,
        officeId: targetOfficeId,
        location: validLocation,
        socketId: targetSocketId || null
      });
    }

    // Attempt to resolve user default/currentOfficeId
    const user = await User.findById(userId).lean().catch(() => null);
    if (user && user.currentOfficeId) {
      return await upsertPosition({
        userId,
        officeId: user.currentOfficeId,
        location: validLocation,
        socketId: targetSocketId || null
      });
    }

    // Safely return null when position cannot be created without office association
    return null;
  }

  const isSameLocation =
    Array.isArray(existing.location) &&
    existing.location.length === 2 &&
    existing.location[0] === validLocation[0] &&
    existing.location[1] === validLocation[1];

  const isSameOffice =
    !targetOfficeId || String(existing.officeId) === String(targetOfficeId);

  const isSameSocket =
    targetSocketId === undefined || existing.socketId === targetSocketId;

  if (isSameLocation && isSameOffice && isSameSocket) {
    // Avoid unnecessary MongoDB writes where current position has not changed
    return existing;
  }

  const updateFields = {
    location: validLocation,
    lastUpdated: new Date()
  };

  if (targetOfficeId && String(existing.officeId) !== String(targetOfficeId)) {
    updateFields.officeId = targetOfficeId;
  }

  if (targetSocketId !== undefined && existing.socketId !== targetSocketId) {
    updateFields.socketId = targetSocketId;
  }

  return await LivePosition.findOneAndUpdate(
    { userId },
    { $set: updateFields },
    { new: true, runValidators: true }
  );
}

/**
 * Retrieve the current LivePosition document for a user.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<Document|null>}
 */
async function getUserPosition(userId) {
  if (!userId) return null;
  return await LivePosition.findOne({ userId });
}

/**
 * Find all users in the same office within a configurable planar radius (default 100 pixels).
 * Excludes the querying user and returns populated profiles, pixel distances, and audio volume factors.
 *
 * Uses MongoDB planar 2D query ($geoWithin with $center: [[x, y], radius]).
 *
 * @param {object} params
 * @param {string|mongoose.Types.ObjectId} params.officeId - Target office ID
 * @param {[number, number]} params.location - [x, y] pivot coordinate
 * @param {number} [params.radius=100] - Proximity radius in pixels (default: 100)
 * @param {string|mongoose.Types.ObjectId} [params.excludeUserId] - Optional user ID to exclude from results
 * @returns {Promise<Array<object>>} Proximity user objects with distance and volume factors
 */
async function getNearbyUsers({
  officeId,
  location,
  radius = 100,
  excludeUserId = null
}) {
  if (!officeId) throw new Error('officeId is required');
  const [x, y] = validateCoordinates(location);
  const proximityRadius = Number(radius) > 0 ? Number(radius) : 100;

  // MongoDB 2D planar spatial query within circular radius
  const query = {
    officeId,
    location: {
      $geoWithin: {
        $center: [[x, y], proximityRadius]
      }
    }
  };

  if (excludeUserId) {
    query.userId = { $ne: excludeUserId };
  }

  const positions = await LivePosition.find(query)
    .populate({
      path: 'userId',
      select: 'displayName email avatarColor avatarUrl isOnline'
    })
    .lean();

  // Enrich with Euclidean distance, smoothstep gain, and stereo pan
  return positions
    .map((pos) => {
      const distance = Number(calculateDistance([x, y], pos.location).toFixed(2));
      const gain = calculateAudioVolume(distance, proximityRadius);
      const pan = calculateStereoPan(x, pos.location[0], proximityRadius);
      const user = pos.userId || {};

      return {
        id: pos._id,
        userId: user._id || pos.userId,
        socketId: pos.socketId,
        displayName: user.displayName || 'Unknown',
        email: user.email,
        avatarColor: user.avatarColor || '#3b82f6',
        avatarUrl: user.avatarUrl || '',
        isOnline: Boolean(user.isOnline),
        location: pos.location,
        distance,
        gain,
        volume: gain, // for backward compatibility
        pan,
        lastUpdated: pos.lastUpdated
      };
    })
    .sort((a, b) => a.distance - b.distance); // Nearest users first
}

/**
 * Retrieve all live avatar positions in a specific office (used for initial office-state sync).
 *
 * @param {string|mongoose.Types.ObjectId} officeId
 * @returns {Promise<Array<object>>}
 */
async function getOfficePositions(officeId) {
  if (!officeId) throw new Error('officeId is required');

  const positions = await LivePosition.find({ officeId })
    .populate({
      path: 'userId',
      select: 'displayName avatarColor avatarUrl isOnline'
    })
    .lean();

  return positions.map((pos) => {
    const user = pos.userId || {};
    return {
      id: pos._id,
      userId: user._id || pos.userId,
      socketId: pos.socketId,
      displayName: user.displayName || 'Unknown',
      avatarColor: user.avatarColor || '#3b82f6',
      avatarUrl: user.avatarUrl || '',
      isOnline: Boolean(user.isOnline),
      location: pos.location,
      lastUpdated: pos.lastUpdated
    };
  });
}

/**
 * Remove a live position record when a user disconnects or leaves the office.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<Document|null>}
 */
async function removeUserPosition(userId) {
  if (!userId) return null;
  return await LivePosition.findOneAndDelete({ userId });
}

/**
 * Remove a live position record by Socket.io client ID.
 *
 * @param {string} socketId
 * @returns {Promise<Document|null>}
 */
async function removeBySocketId(socketId) {
  if (!socketId) return null;
  return await LivePosition.findOneAndDelete({ socketId });
}

module.exports = {
  clamp,
  calculateDistance,
  calculateAudioVolume,
  calculateAudioGain: calculateAudioVolume,
  calculateStereoPan,
  isWithinEarshot,
  validateCoordinates,
  upsertPosition,
  updatePosition,
  getUserPosition,
  getNearbyUsers,
  getOfficePositions,
  removeUserPosition,
  removeBySocketId
};

