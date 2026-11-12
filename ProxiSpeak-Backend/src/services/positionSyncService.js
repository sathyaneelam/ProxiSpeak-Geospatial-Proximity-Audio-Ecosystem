const mongoose = require("mongoose");
const Position = require("../models/Position");
const User = require("../models/User");
const { POSITION_SYNC_INTERVAL_MS } = require("../config/constants");

class PositionSyncService {
  constructor() {
    /** @type {Map<string, { userId: string, x: number, y: number }>} userId -> latest position */
    this.pendingSync = new Map();
    this.syncTimer = null;
    this.startPeriodicSync();
  }

  startPeriodicSync() {
    if (this.syncTimer) return;
    this.syncTimer = setInterval(() => {
      this.flushPositions().catch((err) => {
        // Non-blocking catch to avoid unhandled rejections
        console.warn("[PositionSync] Periodic flush error:", err.message);
      });
    }, POSITION_SYNC_INTERVAL_MS);
    if (this.syncTimer.unref) {
      this.syncTimer.unref();
    }
  }

  stopPeriodicSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Queue a position update for debounced database persistence.
   * @param {string} userId
   * @param {number} x
   * @param {number} y
   */
  queuePositionUpdate(userId, x, y) {
    if (!userId || !mongoose.isValidObjectId(userId)) return;
    this.pendingSync.set(String(userId), { userId, x, y });
  }

  /**
   * Immediately saves or updates the avatar position in MongoDB.
   * @param {string} userId
   * @param {number} x
   * @param {number} y
   */
  async savePositionImmediately(userId, x, y) {
    if (!userId || !mongoose.isValidObjectId(userId)) return null;
    if (mongoose.connection.readyState !== 1) return null;

    try {
      const position = await Position.findOneAndUpdate(
        { userId },
        { x, y },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );
      this.pendingSync.delete(String(userId));
      return position;
    } catch (error) {
      console.warn(`[PositionSync] Failed to save position for user ${userId}:`, error.message);
      return null;
    }
  }

  /**
   * Flushes all queued position updates to MongoDB.
   */
  async flushPositions() {
    if (this.pendingSync.size === 0) return;
    if (mongoose.connection.readyState !== 1) return;

    const entries = Array.from(this.pendingSync.values());
    this.pendingSync.clear();

    const updatePromises = entries.map(({ userId, x, y }) =>
      Position.findOneAndUpdate(
        { userId },
        { x, y },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      ).catch((err) => {
        console.warn(`[PositionSync] Batch update failed for user ${userId}:`, err.message);
      })
    );

    await Promise.all(updatePromises);
  }

  /**
   * Updates user's active socket ID in MongoDB.
   * @param {string} userId
   * @param {string|null} socketId
   */
  async updateUserSocketId(userId, socketId) {
    if (!userId || !mongoose.isValidObjectId(userId)) return null;
    if (mongoose.connection.readyState !== 1) return null;

    try {
      return await User.findByIdAndUpdate(userId, { socketId }, { new: true });
    } catch (error) {
      console.warn(`[PositionSync] Failed to update socketId for user ${userId}:`, error.message);
      return null;
    }
  }
}

const defaultSyncService = new PositionSyncService();
module.exports = defaultSyncService;
module.exports.PositionSyncService = PositionSyncService;
