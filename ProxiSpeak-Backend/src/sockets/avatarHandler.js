const officeManager = require("../services/officeManager");
const positionSyncService = require("../services/positionSyncService");
const { DEFAULT_EARSHOT_RADIUS } = require("../config/constants");

function registerAvatarHandlers(io, socket) {
  /**
   * Handle avatar movement and proximity evaluation.
   * Event: "avatar:move"
   * Payload: { x: number, y: number, officeId?: string }
   */
  socket.on("avatar:move", (data) => {
    if (
      !data ||
      typeof data.x !== "number" ||
      typeof data.y !== "number" ||
      !Number.isFinite(data.x) ||
      !Number.isFinite(data.y)
    ) {
      socket.emit("error", {
        status: "error",
        code: "INVALID_COORDINATES",
        message: "x and y coordinates must be finite numbers.",
      });
      return;
    }

    let peer = officeManager.getPeer(socket.id);

    // If client hasn't called office:join yet, fall back to "default-office"
    // to preserve backward compatibility with legacy scripts
    if (!peer) {
      const officeId = (data.officeId && typeof data.officeId === "string" && data.officeId.trim())
        ? data.officeId.trim()
        : "default-office";

      socket.join(`office:${officeId}`);
      const joined = officeManager.joinOffice(socket.id, {
        officeId,
        userId: socket.id,
        displayName: "Guest",
        x: data.x,
        y: data.y,
      });
      peer = joined.peer;
    }

    const earshotRadius = DEFAULT_EARSHOT_RADIUS;
    const updateResult = officeManager.updatePosition(socket.id, data.x, data.y, earshotRadius);

    if (!updateResult) {
      return;
    }

    // Queue for debounced database persistence
    positionSyncService.queuePositionUpdate(peer.userId, data.x, data.y);

    // Broadcast movement to all other peers in the same office
    socket.to(`office:${peer.officeId}`).emit("avatar:moved", {
      socketId: socket.id,
      userId: peer.userId,
      x: data.x,
      y: data.y,
    });

    // Notify peers that entered earshot
    for (const enteredPeer of updateResult.entered) {
      // To the other peer
      io.to(enteredPeer.socketId).emit("proximity:enter", {
        peerSocketId: socket.id,
        peerUserId: peer.userId,
        peerDisplayName: peer.displayName,
        distance: enteredPeer.distance,
        earshotRadius,
      });

      // To the moving peer
      socket.emit("proximity:enter", {
        peerSocketId: enteredPeer.socketId,
        peerUserId: enteredPeer.userId,
        peerDisplayName: enteredPeer.displayName,
        distance: enteredPeer.distance,
        earshotRadius,
      });
    }

    // Notify peers that left earshot
    for (const leftPeer of updateResult.left) {
      // To the other peer
      io.to(leftPeer.socketId).emit("proximity:leave", {
        peerSocketId: socket.id,
        peerUserId: peer.userId,
        distance: leftPeer.distance,
        earshotRadius,
      });

      // To the moving peer
      socket.emit("proximity:leave", {
        peerSocketId: leftPeer.socketId,
        peerUserId: leftPeer.userId,
        distance: leftPeer.distance,
        earshotRadius,
      });
    }
  });

  /**
   * Handle heartbeat to prevent stale position detection.
   * Event: "avatar:heartbeat"
   */
  socket.on("avatar:heartbeat", (callback) => {
    const updated = officeManager.touch(socket.id);
    if (typeof callback === "function") {
      callback({ status: updated ? "ok" : "not_in_office" });
    }
  });
}

module.exports = registerAvatarHandlers;
