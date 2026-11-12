const officeManager = require("../services/officeManager");
const positionSyncService = require("../services/positionSyncService");
const { STALE_POSITION_TIMEOUT_MS } = require("../config/constants");
let staleInterval = null;
function registerDisconnectHandler(io, socket) {
  socket.on("disconnect", async (reason) => {
    console.log(`User disconnected: ${socket.id} (${reason})`);
    try {
      const { peer, affectedProximityPeers } = officeManager.leaveOffice(socket.id);
      if (!peer) return;
      // Notify remaining peers in the office
      socket.to(`office:${peer.officeId}`).emit("user:left", {
        socketId: socket.id,
        userId: peer.userId,
      });
      // Tear down active proximity connections for peers in earshot
      for (const affected of affectedProximityPeers) {
        io.to(affected.socketId).emit("proximity:leave", {
          peerSocketId: socket.id,
          peerUserId: peer.userId,
          reason: "disconnected",
        });
      }
      // Sync final position and clear socketId in MongoDB
      await positionSyncService.savePositionImmediately(peer.userId, peer.x, peer.y);
      await positionSyncService.updateUserSocketId(peer.userId, null);
    } catch (error) {
      console.warn(`[disconnectHandler] Error during disconnect cleanup for ${socket.id}:`, error.message);
    }
  });
}
/**
 * Starts a background timer that sweeps for stale/inactive peers.
 * @param {object} io - Socket.io server instance
 * @param {number} [intervalMs=30000] - Sweep interval
 * @param {number} [staleTimeoutMs] - Stale threshold
 */
function startStalePeerCleaner(io, intervalMs = 30000, staleTimeoutMs = STALE_POSITION_TIMEOUT_MS) {
  if (staleInterval) return;

  staleInterval = setInterval(() => {
    try {
      const stalePeers = officeManager.getStalePeers(staleTimeoutMs);
      for (const stale of stalePeers) {
        // Emit stale notification to office
        io.to(`office:${stale.officeId}`).emit("user:stale", {
          socketId: stale.socketId,
          userId: stale.userId,
          lastActive: stale.lastActive,
        });
      }
    } catch (err) {
      console.warn("[StaleCleaner] Error during sweep:", err.message);
    }
  }, intervalMs);

  if (staleInterval.unref) {
    staleInterval.unref();
  }
}

function stopStalePeerCleaner() {
  if (staleInterval) {
    clearInterval(staleInterval);
    staleInterval = null;
  }
}

module.exports = {
  registerDisconnectHandler,
  startStalePeerCleaner,
  stopStalePeerCleaner,
};
