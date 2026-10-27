/**
 * ProxiSpeak Real-Time Signaling Server
 * 
 * Manages WebRTC signaling, 2D avatar spatial registry,
 * proximity evaluation within 100px earshot radius, and selective peer relay.
 */

const {
  SIGNALING_EVENTS,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  EARSHOT_RADIUS,
  isValidPosition,
  isValidSdpPayload,
  isValidIceCandidatePayload,
} = require('./signalingContract');

const positionService = require('../services/positionService');

/**
 * Clamps numeric value within [min, max].
 */
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Attenuation formula (the only one):
 *   t = clamp(d/100, 0, 1)
 *   gain = 1 - (3t^2 - 2t^3)
 *   Pan = clamp(dx/100, -1, 1)
 */
function calculateSpatialGain(distance, radius = EARSHOT_RADIUS) {
  if (typeof distance !== 'number' || isNaN(distance) || radius <= 0) return 0;
  if (distance <= 0) return 1.0;
  if (distance >= radius) return 0.0;
  const t = clamp(distance / radius, 0, 1);
  const gain = 1 - (3 * t * t - 2 * t * t * t);
  return Number(clamp(gain, 0, 1).toFixed(4));
}

function calculateStereoPan(localX, peerX, radius = EARSHOT_RADIUS) {
  if (typeof localX !== 'number' || typeof peerX !== 'number' || radius <= 0) return 0;
  const dx = peerX - localX;
  const pan = clamp(dx / radius, -1, 1);
  return Number(pan.toFixed(4));
}

/**
 * Sets up proximity-aware WebRTC signaling handlers on Socket.IO instance.
 *
 * @param {import('socket.io').Server} io
 * @returns {object} Controller registry and helper methods for testing
 */
function setupSignalingServer(io) {
  // Map<socketId, { userId: string, officeId: string, position: { x: number, y: number } }>
  const peersBySocketId = new Map();
  // Map<userId, socketId>
  const socketsByUserId = new Map();
  // Map<officeId, Set<socketId>>
  const officePeers = new Map();

  function getPeer(userId) {
    const socketId = socketsByUserId.get(userId);
    if (!socketId) return null;
    return peersBySocketId.get(socketId) || null;
  }

  function calculateDistance(posA, posB) {
    if (!posA || !posB) return Infinity;
    const dx = posB.x - posA.x;
    const dy = posB.y - posA.y;
    return Math.hypot(dx, dy);
  }

  function isWithinEarshot(posA, posB, radius = EARSHOT_RADIUS) {
    return calculateDistance(posA, posB) <= radius;
  }

  io.on('connection', (socket) => {
    // -------------------------------------------------------------
    // 1. VOICE_JOIN ('voice:join')
    // -------------------------------------------------------------
    socket.on(SIGNALING_EVENTS.VOICE_JOIN, async (data) => {
      const { userId, officeId = 'office-01', position = { x: 500, y: 300 } } = data || {};
      if (!userId || typeof userId !== 'string') {
        return;
      }

      const safePos = {
        x: clamp(Number(position?.x ?? 500), 0, CANVAS_WIDTH),
        y: clamp(Number(position?.y ?? 300), 0, CANVAS_HEIGHT),
      };

      // Register session
      peersBySocketId.set(socket.id, { userId, officeId, position: safePos });
      socketsByUserId.set(userId, socket.id);

      if (!officePeers.has(officeId)) {
        officePeers.set(officeId, new Set());
      }
      officePeers.get(officeId).add(socket.id);

      socket.join(officeId);

      // Notify other clients in the office
      socket.to(officeId).emit(SIGNALING_EVENTS.VOICE_USER_JOINED, {
        userId,
        officeId,
        position: safePos,
      });

      // Optionally persist to DB if configured
      try {
        await positionService.upsertPosition({
          userId,
          officeId,
          location: [safePos.x, safePos.y],
          socketId: socket.id,
        });
      } catch (err) {
        // DB update non-blocking for real-time signaling
      }
    });

    // -------------------------------------------------------------
    // 2. PROXIMITY_UPDATE ('proximity:position-update')
    // -------------------------------------------------------------
    socket.on(SIGNALING_EVENTS.PROXIMITY_UPDATE, async (data) => {
      const { userId, officeId, position } = data || {};
      const current = peersBySocketId.get(socket.id);
      const uid = userId || current?.userId;
      const oid = officeId || current?.officeId || 'office-01';

      if (!uid || !isValidPosition(position)) {
        return;
      }

      const safePos = {
        x: clamp(Number(position.x), 0, CANVAS_WIDTH),
        y: clamp(Number(position.y), 0, CANVAS_HEIGHT),
      };

      peersBySocketId.set(socket.id, { userId: uid, officeId: oid, position: safePos });
      socketsByUserId.set(uid, socket.id);

      // Broadcast position update to peers in the office
      socket.to(oid).emit(SIGNALING_EVENTS.PROXIMITY_UPDATE, {
        userId: uid,
        officeId: oid,
        position: safePos,
      });

      try {
        await positionService.updatePosition(uid, [safePos.x, safePos.y]);
      } catch (err) {
        // Non-blocking
      }
    });

    // -------------------------------------------------------------
    // 3. WEBRTC_OFFER ('webrtc:offer')
    // Rule: Server decides who is within 100px and relays only between those peers
    // -------------------------------------------------------------
    socket.on(SIGNALING_EVENTS.WEBRTC_OFFER, (payload) => {
      if (!isValidSdpPayload(payload)) {
        return;
      }

      const { fromUserId, toUserId, officeId } = payload;
      const sender = peersBySocketId.get(socket.id);
      if (sender && sender.userId !== fromUserId) {
        return;
      }

      const targetSocketId = socketsByUserId.get(toUserId);
      if (!targetSocketId) {
        return;
      }

      const targetPeer = peersBySocketId.get(targetSocketId);
      const senderPos = sender?.position;
      const targetPos = targetPeer?.position;

      if (!senderPos || !targetPos) {
        return;
      }

      const distance = calculateDistance(senderPos, targetPos);

      // Server enforces 100px earshot cutoff
      if (distance <= EARSHOT_RADIUS) {
        io.to(targetSocketId).emit(SIGNALING_EVENTS.WEBRTC_OFFER, payload);
      }
    });

    // -------------------------------------------------------------
    // 4. WEBRTC_ANSWER ('webrtc:answer')
    // Rule: Server decides who is within 100px and relays only between those peers
    // -------------------------------------------------------------
    socket.on(SIGNALING_EVENTS.WEBRTC_ANSWER, (payload) => {
      if (!isValidSdpPayload(payload)) {
        return;
      }

      const { fromUserId, toUserId } = payload;
      const sender = peersBySocketId.get(socket.id);
      if (sender && sender.userId !== fromUserId) {
        return;
      }

      const targetSocketId = socketsByUserId.get(toUserId);
      if (!targetSocketId) {
        return;
      }

      const targetPeer = peersBySocketId.get(targetSocketId);
      const senderPos = sender?.position;
      const targetPos = targetPeer?.position;

      if (!senderPos || !targetPos) {
        return;
      }

      const distance = calculateDistance(senderPos, targetPos);

      // Server enforces 100px earshot cutoff
      if (distance <= EARSHOT_RADIUS) {
        io.to(targetSocketId).emit(SIGNALING_EVENTS.WEBRTC_ANSWER, payload);
      }
    });

    // -------------------------------------------------------------
    // 5. WEBRTC_ICE_CANDIDATE ('webrtc:ice-candidate')
    // Rule: Server decides who is within 100px and relays only between those peers
    // -------------------------------------------------------------
    socket.on(SIGNALING_EVENTS.WEBRTC_ICE_CANDIDATE, (payload) => {
      if (!isValidIceCandidatePayload(payload)) {
        return;
      }

      const { fromUserId, toUserId } = payload;
      const sender = peersBySocketId.get(socket.id);
      if (sender && sender.userId !== fromUserId) {
        return;
      }

      const targetSocketId = socketsByUserId.get(toUserId);
      if (!targetSocketId) {
        return;
      }

      const targetPeer = peersBySocketId.get(targetSocketId);
      const senderPos = sender?.position;
      const targetPos = targetPeer?.position;

      if (!senderPos || !targetPos) {
        return;
      }

      const distance = calculateDistance(senderPos, targetPos);

      // Server enforces 100px earshot cutoff
      if (distance <= EARSHOT_RADIUS) {
        io.to(targetSocketId).emit(SIGNALING_EVENTS.WEBRTC_ICE_CANDIDATE, payload);
      }
    });

    // -------------------------------------------------------------
    // 6. VOICE_LEAVE ('voice:leave')
    // -------------------------------------------------------------
    socket.on(SIGNALING_EVENTS.VOICE_LEAVE, async (data) => {
      const peer = peersBySocketId.get(socket.id);
      const userId = data?.userId || peer?.userId;
      const officeId = data?.officeId || peer?.officeId;

      if (userId && officeId) {
        socket.to(officeId).emit(SIGNALING_EVENTS.VOICE_USER_LEFT, { userId, officeId });
      }

      if (peer) {
        socketsByUserId.delete(peer.userId);
        peersBySocketId.delete(socket.id);
        if (officePeers.has(peer.officeId)) {
          officePeers.get(peer.officeId).delete(socket.id);
        }
      }

      try {
        if (userId) await positionService.removeUserPosition(userId);
      } catch (err) {}
    });

    // -------------------------------------------------------------
    // 7. DISCONNECT
    // -------------------------------------------------------------
    socket.on('disconnect', async () => {
      const peer = peersBySocketId.get(socket.id);
      if (peer) {
        const { userId, officeId } = peer;
        socket.to(officeId).emit(SIGNALING_EVENTS.VOICE_USER_LEFT, { userId, officeId });
        socketsByUserId.delete(userId);
        peersBySocketId.delete(socket.id);
        if (officePeers.has(officeId)) {
          officePeers.get(officeId).delete(socket.id);
        }
        try {
          await positionService.removeBySocketId(socket.id);
        } catch (err) {}
      }
    });

    // -------------------------------------------------------------
    // 8. Cross-branch compatibility (join-office, move-avatar)
    // -------------------------------------------------------------
    socket.on('join-office', async ({ officeId = 'office-01', userEmail, userName, position }) => {
      const defaultPos = position || { x: 500, y: 300 };
      const userId = socket.id;
      peersBySocketId.set(socket.id, { userId, officeId, position: defaultPos });
      socketsByUserId.set(userId, socket.id);
      if (!officePeers.has(officeId)) {
        officePeers.set(officeId, new Set());
      }
      officePeers.get(officeId).add(socket.id);
      socket.join(officeId);
      socket.to(officeId).emit('user-joined', { socketId: socket.id, position: defaultPos, userName, userEmail });
    });

    socket.on('move-avatar', async ({ officeId, x, y, userId }) => {
      const peer = peersBySocketId.get(socket.id);
      const uid = userId || peer?.userId || socket.id;
      const oid = officeId || peer?.officeId || 'office-01';
      const safePos = {
        x: clamp(Number(x), 0, CANVAS_WIDTH),
        y: clamp(Number(y), 0, CANVAS_HEIGHT),
      };
      peersBySocketId.set(socket.id, { userId: uid, officeId: oid, position: safePos });
      socket.to(oid).emit('avatar-moved', { socketId: socket.id, x: safePos.x, y: safePos.y, userId: uid });
    });
  });

  return {
    peersBySocketId,
    socketsByUserId,
    officePeers,
    getPeer,
    calculateDistance,
    isWithinEarshot,
    calculateSpatialGain,
    calculateStereoPan,
  };
}

module.exports = {
  setupSignalingServer,
  clamp,
  calculateSpatialGain,
  calculateStereoPan,
};
