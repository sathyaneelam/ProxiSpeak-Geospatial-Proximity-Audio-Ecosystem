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
function calculateDistance(pointA, pointB) {
  if (!Array.isArray(pointA) || !Array.isArray(pointB) || pointA.length !== 2 || pointB.length !== 2) {
    throw new Error('Points must be 2-element coordinate arrays [x, y]');
  }
  const dx = pointA[0] - pointB[0];
  const dy = pointA[1] - pointB[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate linear audio volume factor based on distance within proximity radius.
 * When distance = 0, volume = 1.0 (100%).
 * When distance >= radius, volume = 0.0 (silent).
 *
 * @param {number} distance - Distance in pixels
 * @param {number} [radius=100] - Proximity threshold in pixels
 * @returns {number} Attenuation factor between 0.0 and 1.0
 */
function calculateAudioVolume(distance, radius = 100) {
  if (radius <= 0) return 0;
  if (distance >= radius) return 0;
  if (distance <= 0) return 1;
  const factor = 1 - (distance / radius);
  return Number(Math.max(0, Math.min(1, factor)).toFixed(3));
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
 * Uses atomic MongoDB findOneAndUpdate with upsert: true.
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
 * High-frequency position update for avatar movement within the current office.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {[number, number]} location - [x, y] coordinates
 * @returns {Promise<Document|null>}
 */
async function updatePosition(userId, location) {
  if (!userId) throw new Error('userId is required');
  const validLocation = validateCoordinates(location);

  return await LivePosition.findOneAndUpdate(
    { userId },
    {
      $set: {
        location: validLocation,
        lastUpdated: new Date()
      }
    },
    { new: true, runValidators: true }
  );
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

  // Enrich with Euclidean distance and audio volume attenuation factor
  return positions
    .map((pos) => {
      const distance = Number(calculateDistance([x, y], pos.location).toFixed(2));
      const volume = calculateAudioVolume(distance, proximityRadius);
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
        volume,
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
  calculateDistance,
  calculateAudioVolume,
  validateCoordinates,
  upsertPosition,
  updatePosition,
  getNearbyUsers,
  getOfficePositions,
  removeUserPosition,
  removeBySocketId
};
