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

export function isValidUserId(userId) {
  return typeof userId === 'string' && userId.trim().length > 0;
}

function getAliasedId(payload, primaryKey, aliasKey) {
  const primary = payload[primaryKey];
  const alias = payload[aliasKey];

  if (
    (primary !== undefined && !isValidUserId(primary)) ||
    (alias !== undefined && !isValidUserId(alias))
  ) {
    return null;
  }

  if (
    primary !== undefined &&
    alias !== undefined &&
    primary.trim() !== alias.trim()
  ) {
    return null;
  }

  const value = primary ?? alias;
  return isValidUserId(value) ? value.trim() : null;
}

function isPayloadObject(payload) {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload);
}

/**
 * Validates coordinate payload.
 * Coordinates are 2D canvas pixels: { x: number, y: number }.
 */
export function isValidPosition(pos) {
  return (
    isPayloadObject(pos) &&
    Number.isFinite(pos.x) &&
    Number.isFinite(pos.y)
  );
}

export function isValidSdpDescription(sdp, expectedType) {
  return Boolean(
    isPayloadObject(sdp) &&
    (sdp.type === 'offer' || sdp.type === 'answer') &&
    (!expectedType || sdp.type === expectedType) &&
    typeof sdp.sdp === 'string' &&
    sdp.sdp.trim().length > 0
  );
}

/**
 * Validates a WebRTC SDP offer/answer payload.
 * Supports both canonical Member 4 contract and Member 2 backend relay shapes.
 */
export function isValidSdpPayload(payload, expectedType) {
  if (!isPayloadObject(payload)) return false;
  const fromUserId = getAliasedId(payload, 'fromUserId', 'from');
  const toUserId = getAliasedId(payload, 'toUserId', 'to');
  const sdpObj = payload.sdp ?? payload.offer ?? payload.answer;
  return Boolean(
    fromUserId &&
    toUserId &&
    (payload.officeId === undefined || isValidUserId(payload.officeId)) &&
    isValidSdpDescription(sdpObj, expectedType)
  );
}

export function normalizeSdpPayload(payload, expectedType) {
  if (!isValidSdpPayload(payload, expectedType)) return null;

  return {
    ...payload,
    fromUserId: getAliasedId(payload, 'fromUserId', 'from'),
    toUserId: getAliasedId(payload, 'toUserId', 'to'),
    sdp: payload.sdp ?? payload.offer ?? payload.answer,
  };
}

/**
 * Validates a WebRTC ICE candidate payload.
 * Supports both canonical Member 4 contract and Member 2 backend relay shapes.
 */
export function isValidIceCandidatePayload(payload) {
  if (!isPayloadObject(payload)) return false;

  const fromUserId = getAliasedId(payload, 'fromUserId', 'from');
  const toUserId = getAliasedId(payload, 'toUserId', 'to');
  const candidate = payload.candidate;

  return Boolean(
    fromUserId &&
    toUserId &&
    (payload.officeId === undefined || isValidUserId(payload.officeId)) &&
    isPayloadObject(candidate) &&
    typeof candidate.candidate === 'string' &&
    (candidate.sdpMid === undefined || candidate.sdpMid === null || typeof candidate.sdpMid === 'string') &&
    (candidate.sdpMLineIndex === undefined || candidate.sdpMLineIndex === null ||
      (Number.isInteger(candidate.sdpMLineIndex) && candidate.sdpMLineIndex >= 0)) &&
    (candidate.usernameFragment === undefined || candidate.usernameFragment === null ||
      typeof candidate.usernameFragment === 'string')
  );
}

export function normalizeIceCandidatePayload(payload) {
  if (!isValidIceCandidatePayload(payload)) return null;

  return {
    ...payload,
    fromUserId: getAliasedId(payload, 'fromUserId', 'from'),
    toUserId: getAliasedId(payload, 'toUserId', 'to'),
  };
}

export function isValidPeerPresencePayload(payload) {
  return Boolean(
    isPayloadObject(payload) &&
    isValidUserId(payload.userId) &&
    (payload.officeId === undefined || isValidUserId(payload.officeId)) &&
    (payload.position === undefined || payload.position === null || isValidPosition(payload.position))
  );
}

/**
 * Creates a normalized WebRTC Offer envelope.
 * Provides both `to` + `offer` (Member 2 backend requirement) and `toUserId` + `sdp` (Member 4 canonical contract).
 */
export function createOfferPayload({ fromUserId, toUserId, officeId, sdp, to, offer }) {
  const targetId = toUserId || to;
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
  const targetId = toUserId || to;
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
