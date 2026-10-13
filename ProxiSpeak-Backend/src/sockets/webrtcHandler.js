const officeManager = require("../services/officeManager");
const { DEFAULT_EARSHOT_RADIUS } = require("../config/constants");

function registerWebRTCHandlers(io, socket) {
  /**
   * Helper to validate and verify eligibility before forwarding signaling packets.
   */
  function checkSignalingEligibility(toSocketId) {
    if (!toSocketId || typeof toSocketId !== "string" || !toSocketId.trim()) {
      return {
        eligible: false,
        code: "INVALID_TARGET",
        message: "A valid string target socket ID ('to') is required.",
      };
    }

    return officeManager.isEligibleForSignaling(
      socket.id,
      toSocketId.trim(),
      DEFAULT_EARSHOT_RADIUS
    );
  }

  /**
   * Handle WebRTC Offer.
   * Event: "webrtc:offer"
   * Payload: { to: string, offer: object }
   */
  socket.on("webrtc:offer", (data, callback) => {
    if (!data || !data.offer) {
      const err = {
        status: "error",
        code: "INVALID_PAYLOAD",
        message: "Payload must include 'to' and 'offer'.",
        targetSocketId: data?.to,
      };
      socket.emit("webrtc:error", err);
      if (typeof callback === "function") callback(err);
      return;
    }

    const eligibility = checkSignalingEligibility(data.to);
    if (!eligibility.eligible) {
      const err = {
        status: "error",
        code: eligibility.code,
        message: eligibility.message,
        targetSocketId: data.to,
        distance: eligibility.distance,
      };
      socket.emit("webrtc:error", err);
      if (typeof callback === "function") callback(err);
      return;
    }

    const senderPeer = officeManager.getPeer(socket.id);
    io.to(data.to.trim()).emit("webrtc:offer", {
      from: socket.id,
      fromUserId: senderPeer?.userId || socket.id,
      offer: data.offer,
    });

    if (typeof callback === "function") {
      callback({ status: "success", forwardedTo: data.to.trim() });
    }
  });

  /**
   * Handle WebRTC Answer.
   * Event: "webrtc:answer"
   * Payload: { to: string, answer: object }
   */
  socket.on("webrtc:answer", (data, callback) => {
    if (!data || !data.answer) {
      const err = {
        status: "error",
        code: "INVALID_PAYLOAD",
        message: "Payload must include 'to' and 'answer'.",
        targetSocketId: data?.to,
      };
      socket.emit("webrtc:error", err);
      if (typeof callback === "function") callback(err);
      return;
    }

    const eligibility = checkSignalingEligibility(data.to);
    if (!eligibility.eligible) {
      const err = {
        status: "error",
        code: eligibility.code,
        message: eligibility.message,
        targetSocketId: data.to,
        distance: eligibility.distance,
      };
      socket.emit("webrtc:error", err);
      if (typeof callback === "function") callback(err);
      return;
    }

    const senderPeer = officeManager.getPeer(socket.id);
    io.to(data.to.trim()).emit("webrtc:answer", {
      from: socket.id,
      fromUserId: senderPeer?.userId || socket.id,
      answer: data.answer,
    });

    if (typeof callback === "function") {
      callback({ status: "success", forwardedTo: data.to.trim() });
    }
  });

  /**
   * Handle WebRTC ICE Candidate.
   * Event: "webrtc:ice-candidate"
   * Payload: { to: string, candidate: object }
   */
  socket.on("webrtc:ice-candidate", (data, callback) => {
    if (!data || !data.candidate) {
      const err = {
        status: "error",
        code: "INVALID_PAYLOAD",
        message: "Payload must include 'to' and 'candidate'.",
        targetSocketId: data?.to,
      };
      socket.emit("webrtc:error", err);
      if (typeof callback === "function") callback(err);
      return;
    }

    const eligibility = checkSignalingEligibility(data.to);
    if (!eligibility.eligible) {
      const err = {
        status: "error",
        code: eligibility.code,
        message: eligibility.message,
        targetSocketId: data.to,
        distance: eligibility.distance,
      };
      socket.emit("webrtc:error", err);
      if (typeof callback === "function") callback(err);
      return;
    }

    const senderPeer = officeManager.getPeer(socket.id);
    io.to(data.to.trim()).emit("webrtc:ice-candidate", {
      from: socket.id,
      fromUserId: senderPeer?.userId || socket.id,
      candidate: data.candidate,
    });

    if (typeof callback === "function") {
      callback({ status: "success", forwardedTo: data.to.trim() });
    }
  });
}

module.exports = registerWebRTCHandlers;
