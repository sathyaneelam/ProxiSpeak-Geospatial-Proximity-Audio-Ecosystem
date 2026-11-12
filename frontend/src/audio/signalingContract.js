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

  // Member 2 Server Extensions & Errors
  WEBRTC_ERROR: 'webrtc:error',
  OFFICE_JOIN: 'office:join',
  OFFICE_JOINED: 'office:joined',
  USER_JOINED: 'user:joined',
  USER_LEFT: 'user:left',
  PROXIMITY_ENTER: 'proximity:enter',
  PROXIMITY_LEAVE: 'proximity:leave',
  AVATAR_MOVE: 'avatar:move',
  AVATAR_MOVED: 'avatar:moved',
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
 * Supports both canonical Member 4 contract and Member 2 backend relay shapes.
 */
export function isValidSdpPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;

  const from = payload.fromUserId ?? payload.from;
  const to = payload.toUserId ?? payload.to;

  // Must have at least one valid identifier (either from or to)
  const hasValidFrom = typeof from === 'string' && from.length > 0;
  const hasValidTo = typeof to === 'string' && to.length > 0;
  if (!hasValidFrom && !hasValidTo) {
    return false;
  }
  // If fromUserId was explicitly supplied as empty string, reject
  if (payload.fromUserId !== undefined && (typeof payload.fromUserId !== 'string' || payload.fromUserId.length === 0)) {
    return false;
  }

  const sdpObj = payload.sdp ?? payload.offer ?? payload.answer;
  return Boolean(
    sdpObj &&
    typeof sdpObj.type === 'string' &&
    typeof sdpObj.sdp === 'string'
  );
}

/**
 * Validates a WebRTC ICE candidate payload.
 * Supports both canonical Member 4 contract and Member 2 backend relay shapes.
 */
export function isValidIceCandidatePayload(payload) {
  if (!payload || typeof payload !== 'object') return false;

  const from = payload.fromUserId ?? payload.from;
  const to = payload.toUserId ?? payload.to;

  const hasValidFrom = typeof from === 'string' && from.length > 0;
  const hasValidTo = typeof to === 'string' && to.length > 0;
  if (!hasValidFrom && !hasValidTo) {
    return false;
  }
  if (payload.fromUserId !== undefined && (typeof payload.fromUserId !== 'string' || payload.fromUserId.length === 0)) {
    return false;
  }

  return Boolean(
    payload.candidate &&
    typeof payload.candidate.candidate === 'string'
  );
}

/**
 * Creates a normalized WebRTC Offer envelope.
 * Provides both `to` + `offer` (Member 2 backend requirement) and `toUserId` + `sdp` (Member 4 canonical contract).
 */
export function createOfferPayload({ fromUserId, toUserId, officeId, sdp, to, offer }) {
  const targetId = to || toUserId;
  const sdpObj = offer || sdp;
  const normalizedSdp = sdpObj?.type ? { type: sdpObj.type, sdp: sdpObj.sdp } : sdpObj;

  return {
    to: targetId,
    toUserId: targetId,
    fromUserId: fromUserId || '',
    officeId: officeId || 'default-office',
    offer: normalizedSdp,
    sdp: normalizedSdp,
    timestamp: Date.now(),
  };
}

/**
 * Creates a normalized WebRTC Answer envelope.
 * Provides both `to` + `answer` (Member 2 backend requirement) and `toUserId` + `sdp` (Member 4 canonical contract).
 */
export function createAnswerPayload({ fromUserId, toUserId, officeId, sdp, to, answer }) {
  const targetId = to || toUserId;
  const sdpObj = answer || sdp;
  const normalizedSdp = sdpObj?.type ? { type: sdpObj.type, sdp: sdpObj.sdp } : sdpObj;

  return {
    to: targetId,
    toUserId: targetId,
    fromUserId: fromUserId || '',
    officeId: officeId || 'default-office',
    answer: normalizedSdp,
    sdp: normalizedSdp,
    timestamp: Date.now(),
  };
}

/**
 * Creates a normalized ICE Candidate envelope.
 * Provides both `to` (Member 2 backend requirement) and `toUserId` (Member 4 canonical contract).
 */
export function createIceCandidatePayload({ fromUserId, toUserId, officeId, candidate, to }) {
  const targetId = to || toUserId;
  const normalizedCandidate = candidate?.candidate !== undefined ? {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment,
  } : candidate;

  return {
    to: targetId,
    toUserId: targetId,
    fromUserId: fromUserId || '',
    officeId: officeId || 'default-office',
    candidate: normalizedCandidate,
    timestamp: Date.now(),
  };
}
