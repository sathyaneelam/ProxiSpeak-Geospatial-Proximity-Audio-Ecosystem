const officeManager = require("../services/officeManager");
const positionSyncService = require("../services/positionSyncService");
const { DEFAULT_EARSHOT_RADIUS } = require("../config/constants");

function registerOfficeHandlers(io, socket) {
  /**
   * Handle joining an office.
   * Event: "office:join"
   * Payload: { officeId: string, userId?: string, displayName?: string, x?: number, y?: number, earshotRadius?: number }
   */
  socket.on("office:join", async (data, callback) => {
    try {
      if (!data || typeof data.officeId !== "string" || !data.officeId.trim()) {
        const errPayload = {
          status: "error",
          code: "INVALID_OFFICE_ID",
          message: "A valid string officeId is required.",
        };
        socket.emit("error", errPayload);
        if (typeof callback === "function") callback(errPayload);
        return;
      }

      const officeId = data.officeId.trim();
      const userId = typeof data.userId === "string" ? data.userId.trim() : socket.id;
      const displayName = typeof data.displayName === "string" ? data.displayName.trim() : "Guest";
      const x = typeof data.x === "number" && Number.isFinite(data.x) ? data.x : 0;
      const y = typeof data.y === "number" && Number.isFinite(data.y) ? data.y : 0;
      const earshotRadius =
        typeof data.earshotRadius === "number" && Number.isFinite(data.earshotRadius)
          ? data.earshotRadius
          : DEFAULT_EARSHOT_RADIUS;

      // Leave previous room if any (such as default-office)
      const existingPeer = officeManager.getPeer(socket.id);
      if (existingPeer && existingPeer.officeId !== officeId) {
        socket.leave(`office:${existingPeer.officeId}`);
      }

      // Join the Socket.io room for this office
      socket.join(`office:${officeId}`);

      // Register in in-memory office presence
      const { peer, allPeersInOffice, enteredProximity } = officeManager.joinOffice(
        socket.id,
        {
          officeId,
          userId,
          displayName,
          x,
          y,
          earshotRadius,
        }
      );

      // Async DB sync (non-blocking)
      positionSyncService.updateUserSocketId(userId, socket.id);
      positionSyncService.queuePositionUpdate(userId, x, y);

      // Respond to joining client
      const joinResponse = {
        status: "success",
        officeId,
        socketId: socket.id,
        userId,
        displayName,
        x,
        y,
        earshotRadius,
        peers: allPeersInOffice,
      };

      socket.emit("office:joined", joinResponse);
      if (typeof callback === "function") callback(joinResponse);

      // Broadcast new user presence to existing peers in the same office
      socket.to(`office:${officeId}`).emit("user:joined", {
        socketId: socket.id,
        userId,
        displayName,
        x,
        y,
      });

      // Notify nearby peers who are already in earshot of this new user
      for (const nearby of enteredProximity) {
        // To the existing peer
        io.to(nearby.socketId).emit("proximity:enter", {
          peerSocketId: socket.id,
          peerUserId: userId,
          peerDisplayName: displayName,
          distance: nearby.distance,
          earshotRadius,
        });

        // To the joining peer
        socket.emit("proximity:enter", {
          peerSocketId: nearby.socketId,
          peerUserId: nearby.userId,
          peerDisplayName: nearby.displayName,
          distance: nearby.distance,
          earshotRadius,
        });
      }
    } catch (error) {
      console.error("[office:join] Unexpected error:", error);
      const errPayload = {
        status: "error",
        code: "SERVER_ERROR",
        message: "Failed to join office.",
      };
      socket.emit("error", errPayload);
      if (typeof callback === "function") callback(errPayload);
    }
  });

  /**
   * Handle leaving an office explicitly.
   * Event: "office:leave"
   */
  socket.on("office:leave", async (callback) => {
    try {
      const currentPeer = officeManager.getPeer(socket.id);
      if (!currentPeer) {
        if (typeof callback === "function") {
          callback({ status: "success", message: "Not in any office." });
        }
        return;
      }

      const { peer, affectedProximityPeers } = officeManager.leaveOffice(socket.id);
      socket.leave(`office:${peer.officeId}`);

      // Notify other office peers
      socket.to(`office:${peer.officeId}`).emit("user:left", {
        socketId: socket.id,
        userId: peer.userId,
      });

      // Teardown proximity with peers that were within earshot
      for (const affected of affectedProximityPeers) {
        io.to(affected.socketId).emit("proximity:leave", {
          peerSocketId: socket.id,
          peerUserId: peer.userId,
          reason: "office_leave",
        });
      }

      // Persist final position & clear socketId
      await positionSyncService.savePositionImmediately(peer.userId, peer.x, peer.y);
      await positionSyncService.updateUserSocketId(peer.userId, null);

      if (typeof callback === "function") {
        callback({ status: "success", message: "Left office successfully." });
      }
    } catch (error) {
      console.error("[office:leave] Error:", error);
      if (typeof callback === "function") {
        callback({ status: "error", message: error.message });
      }
    }
  });
}

module.exports = registerOfficeHandlers;
