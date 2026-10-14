/**
 * ProxiSpeak WebRTC Audio Signaling Contract
 * 
 * Formal contract for real-time signaling events between frontend clients
 * and the ProxiSpeak backend server.
 * Source of truth: frontend/src/audio/signalingContract.js on origin/Sathya-Audio
 */

const SIGNALING_EVENTS = {
  // Voice Space Lifecycle
  VOICE_JOIN: 'voice:join',
  VOICE_USER_JOINED: 'voice:user-joined',
  VOICE_LEAVE: 'voice:leave',
  VOICE_USER_LEFT: 'voice:user-left',

  // Proximity & Coordinates
  PROXIMITY_UPDATE: 'proximity:position-update',

  // WebRTC Peer Negotiation
  WEBRTC_OFFER: 'webrtc:offer',
  WEBRTC_ANSWER: 'webrtc:answer',
  WEBRTC_ICE_CANDIDATE: 'webrtc:ice-candidate',
  WEBRTC_DISCONNECT: 'webrtc:peer-disconnect',
};

// Spatial Environment Constraints
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 600;
const EARSHOT_RADIUS = 100;

/**
 * Validates coordinate payload.
 * Coordinates are 2D canvas pixels: { x: number, y: number }.
 */
function isValidPosition(pos) {
  return (
    pos !== null &&
    typeof pos === 'object' &&
    typeof pos.x === 'number' &&
    !Number.isNaN(pos.x) &&
    typeof pos.y === 'number' &&
    !Number.isNaN(pos.y)
  );
}

/**
 * Validates a WebRTC SDP offer/answer payload.
 */
function isValidSdpPayload(payload) {
  return Boolean(
    payload &&
    typeof payload.fromUserId === 'string' &&
    payload.fromUserId.length > 0 &&
    typeof payload.toUserId === 'string' &&
    payload.toUserId.length > 0 &&
    typeof payload.officeId === 'string' &&
    payload.sdp &&
    typeof payload.sdp.type === 'string' &&
    typeof payload.sdp.sdp === 'string'
  );
}

/**
 * Validates a WebRTC ICE candidate payload.
 */
function isValidIceCandidatePayload(payload) {
  return Boolean(
    payload &&
    typeof payload.fromUserId === 'string' &&
    typeof payload.toUserId === 'string' &&
    typeof payload.officeId === 'string' &&
    payload.candidate &&
    typeof payload.candidate.candidate === 'string'
  );
}

/**
 * Creates a normalized WebRTC Offer envelope.
 */
function createOfferPayload({ fromUserId, toUserId, officeId, sdp }) {
  return {
    fromUserId,
    toUserId,
    officeId: officeId || 'default-office',
    sdp: {
      type: sdp.type,
      sdp: sdp.sdp,
    },
    timestamp: Date.now(),
  };
}

/**
 * Creates a normalized WebRTC Answer envelope.
 */
function createAnswerPayload({ fromUserId, toUserId, officeId, sdp }) {
  return {
    fromUserId,
    toUserId,
    officeId: officeId || 'default-office',
    sdp: {
      type: sdp.type,
      sdp: sdp.sdp,
    },
    timestamp: Date.now(),
  };
}

/**
 * Creates a normalized ICE Candidate envelope.
 */
function createIceCandidatePayload({ fromUserId, toUserId, officeId, candidate }) {
  return {
    fromUserId,
    toUserId,
    officeId: officeId || 'default-office',
    candidate: {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
      usernameFragment: candidate.usernameFragment,
    },
    timestamp: Date.now(),
  };
}

module.exports = {
  SIGNALING_EVENTS,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  EARSHOT_RADIUS,
  isValidPosition,
  isValidSdpPayload,
  isValidIceCandidatePayload,
  createOfferPayload,
  createAnswerPayload,
  createIceCandidatePayload,
};
