/**
 * ProxiSpeak WebRTC Audio Signaling Contract
 * 
 * Formal contract for real-time signaling events between frontend clients
 * and Member 2's signaling server.
 */

export const SIGNALING_EVENTS = {
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

/**
 * Validates coordinate payload.
 * Coordinates are 2D canvas pixels: { x: number, y: number }.
 */
export function isValidPosition(pos) {
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
export function isValidSdpPayload(payload) {
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
export function isValidIceCandidatePayload(payload) {
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
export function createOfferPayload({ fromUserId, toUserId, officeId, sdp }) {
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
export function createAnswerPayload({ fromUserId, toUserId, officeId, sdp }) {
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
export function createIceCandidatePayload({ fromUserId, toUserId, officeId, candidate }) {
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
