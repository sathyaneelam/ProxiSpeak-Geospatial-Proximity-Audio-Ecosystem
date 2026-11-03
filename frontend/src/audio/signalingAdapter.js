/**
 * ProxiSpeak Signaling Transport Adapters
 * 
 * Provides an adapter boundary decoupling audio/WebRTC logic from
 * the concrete signaling mechanism (Socket.io vs BroadcastChannel vs Mock).
 */

import { io } from 'socket.io-client';
import {
  SIGNALING_EVENTS,
  createOfferPayload,
  createAnswerPayload,
  createIceCandidatePayload,
  isValidPeerPresencePayload,
  isValidPosition,
  isValidSdpPayload,
  isValidIceCandidatePayload,
  isValidUserId,
  normalizeIceCandidatePayload,
  normalizeSdpPayload,
} from './signalingContract.js';

function isMessageForUser(payload, userId) {
  for (const recipient of [payload.toUserId, payload.to]) {
    if (recipient !== undefined && (!isValidUserId(recipient) || recipient.trim() !== userId)) {
      return false;
    }
  }
  return true;
}

export class BaseSignalingTransport {
  constructor() {
    this.listeners = new Map();
  }

  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    if (this.listeners.has(event)) {
      const handlers = this.listeners.get(event);
      handlers.delete(handler);
      if (handlers.size === 0) this.listeners.delete(event);
    }
  }

  emitLocal(event, data) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.error(`[SignalingTransport] Error in handler for event '${event}':`, err);
        }
      }
    }
  }

  _emitValidSignalingPayload(event, payload) {
    if (
      !payload ||
      payload.toUserId !== this.userId ||
      payload.fromUserId === this.userId ||
      (payload.officeId && payload.officeId !== this.officeId)
    ) {
      console.warn(`[SignalingTransport] Ignoring invalid or misrouted ${event} payload.`);
      return;
    }
    this.emitLocal(event, payload);
  }

  _emitValidPresencePayload(event, payload) {
    if (
      !isValidPeerPresencePayload(payload) ||
      payload.userId === this.userId ||
      !isMessageForUser(payload, this.userId) ||
      (payload.officeId && payload.officeId !== this.officeId)
    ) {
      console.warn(`[SignalingTransport] Ignoring invalid or misrouted ${event} payload.`);
      return;
    }
    this.emitLocal(event, payload);
  }

  // Abstract methods
  async connect() {}
  disconnect() {}
  sendOffer() {}
  sendAnswer() {}
  sendIceCandidate() {}
  updatePosition() {}
  leaveVoice() {}
}

/**
 * Socket.IO Implementation for Member 2's Signaling Server
 */
export class SocketIOSignalingTransport extends BaseSignalingTransport {
  constructor(serverUrl = 'http://localhost:3000', options = {}) {
    super();
    this.serverUrl = serverUrl;
    this.options = {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      ...options,
    };
    this.socket = null;
    this.userId = null;
    this.officeId = null;
    this.position = null;
    this.socketHandlers = [];
    this.hasJoinedVoice = false;
  }

  async connect({ userId, officeId, position }) {
    if (
      !isValidUserId(userId) ||
      !isValidUserId(officeId) ||
      (position !== undefined && !isValidPeerPresencePayload({ userId, officeId, position }))
    ) {
      throw new TypeError('A valid user ID, office ID, and optional position are required.');
    }

    const normalizedUserId = userId.trim();
    const normalizedOfficeId = officeId.trim();
    if (this.userId !== normalizedUserId || this.officeId !== normalizedOfficeId) {
      this.hasJoinedVoice = false;
    }
    this.userId = normalizedUserId;
    this.officeId = normalizedOfficeId;
    this.position = position;

    if (!this.socket) {
      this.socket = io(this.serverUrl, this.options);
      this._bindSocketEvents();
    }

    if (!this.socket.connected) {
      this.socket.connect();
    } else {
      this._joinVoiceRoom();
    }
  }

  _joinVoiceRoom() {
    if (!this.socket?.connected || this.hasJoinedVoice) return;
    this.socket.emit(SIGNALING_EVENTS.VOICE_JOIN, {
      userId: this.userId,
      officeId: this.officeId,
      position: this.position,
    });
    this.hasJoinedVoice = true;
  }

  _bindSocketEvents() {
    if (!this.socket) return;
    if (this.boundSocket === this.socket) return;

    const socket = this.socket;
    this.boundSocket = socket;
    const bind = (event, handler) => {
      socket.on(event, handler);
      this.socketHandlers.push({ socket, event, handler });
    };

    bind('connect', () => {
      if (this.socket !== socket) return;
      this._joinVoiceRoom();
      this.emitLocal('connected', { socketId: socket.id });
    });

    bind('disconnect', (reason) => {
      if (this.socket !== socket) return;
      this.hasJoinedVoice = false;
      this.emitLocal('disconnected', { reason });
    });

    bind('connect_error', (err) => {
      if (this.socket !== socket) return;
      this.emitLocal('error', { error: err });
    });

    // WebRTC Signaling Events
    bind(SIGNALING_EVENTS.WEBRTC_OFFER, (data) => {
      this._emitValidSignalingPayload(
        SIGNALING_EVENTS.WEBRTC_OFFER,
        normalizeSdpPayload(data, 'offer')
      );
    });

    bind(SIGNALING_EVENTS.WEBRTC_ANSWER, (data) => {
      this._emitValidSignalingPayload(
        SIGNALING_EVENTS.WEBRTC_ANSWER,
        normalizeSdpPayload(data, 'answer')
      );
    });

    bind(SIGNALING_EVENTS.WEBRTC_ICE_CANDIDATE, (data) => {
      this._emitValidSignalingPayload(
        SIGNALING_EVENTS.WEBRTC_ICE_CANDIDATE,
        normalizeIceCandidatePayload(data)
      );
    });

    bind(SIGNALING_EVENTS.WEBRTC_ERROR, (data) => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        console.warn('[SignalingTransport] Ignoring invalid WebRTC error payload.');
        return;
      }
      this.emitLocal(SIGNALING_EVENTS.WEBRTC_ERROR, data);
    });

    // Voice room presence
    bind(SIGNALING_EVENTS.VOICE_USER_JOINED, (data) => {
      this._emitValidPresencePayload(SIGNALING_EVENTS.VOICE_USER_JOINED, data);
    });

    bind(SIGNALING_EVENTS.VOICE_USER_LEFT, (data) => {
      this._emitValidPresencePayload(SIGNALING_EVENTS.VOICE_USER_LEFT, data);
    });

    bind(SIGNALING_EVENTS.PROXIMITY_UPDATE, (data) => {
      this._emitValidPresencePayload(SIGNALING_EVENTS.PROXIMITY_UPDATE, data);
    });
  }

  sendOffer({ toUserId, sdp }) {
    if (!this.socket?.connected) return;
    const payload = createOfferPayload({
      fromUserId: this.userId,
      toUserId,
      officeId: this.officeId,
      sdp,
    });
    if (!isValidSdpPayload(payload, 'offer')) {
      console.warn('[SignalingTransport] Ignoring invalid outgoing WebRTC offer.');
      return;
    }
    this.socket.emit(SIGNALING_EVENTS.WEBRTC_OFFER, payload);
  }

  sendAnswer({ toUserId, sdp }) {
    if (!this.socket?.connected) return;
    const payload = createAnswerPayload({
      fromUserId: this.userId,
      toUserId,
      officeId: this.officeId,
      sdp,
    });
    if (!isValidSdpPayload(payload, 'answer')) {
      console.warn('[SignalingTransport] Ignoring invalid outgoing WebRTC answer.');
      return;
    }
    this.socket.emit(SIGNALING_EVENTS.WEBRTC_ANSWER, payload);
  }

  sendIceCandidate({ toUserId, candidate }) {
    if (!this.socket?.connected) return;
    const payload = createIceCandidatePayload({
      fromUserId: this.userId,
      toUserId,
      officeId: this.officeId,
      candidate,
    });
    if (!isValidIceCandidatePayload(payload)) {
      console.warn('[SignalingTransport] Ignoring invalid outgoing ICE candidate.');
      return;
    }
    this.socket.emit(SIGNALING_EVENTS.WEBRTC_ICE_CANDIDATE, payload);
  }

  updatePosition(position) {
    if (!isValidPosition(position)) {
      console.warn('[SignalingTransport] Ignoring invalid position update.');
      return;
    }
    this.position = position;
    if (!this.socket?.connected) return;
    this.socket.emit(SIGNALING_EVENTS.PROXIMITY_UPDATE, {
      userId: this.userId,
      officeId: this.officeId,
      position,
    });
  }

  leaveVoice() {
    if (this.socket?.connected) {
      this.socket.emit(SIGNALING_EVENTS.VOICE_LEAVE, {
        userId: this.userId,
        officeId: this.officeId,
      });
    }
  }

  disconnect() {
    this.leaveVoice();
    const socket = this.socket;
    if (socket) {
      this.emitLocal('disconnected', { reason: 'io client disconnect' });
    }
    this.socket = null;
    this.boundSocket = null;
    this.hasJoinedVoice = false;
    for (const { socket: boundSocket, event, handler } of this.socketHandlers) {
      boundSocket.off?.(event, handler);
    }
    this.socketHandlers = [];
    if (socket) {
      socket.disconnect();
    }
  }
}

/**
 * Local BroadcastChannel Transport
 * Enables 2-tab local testing on the same browser origin without requiring a backend server.
 */
export class BroadcastSignalingTransport extends BaseSignalingTransport {
  constructor(channelName = 'proxispeak_signaling_room') {
    super();
    this.channelName = channelName;
    this.channel = null;
    this.userId = null;
    this.officeId = null;
    this.position = null;
    this.knownUsers = new Set();
  }

  async connect({ userId, officeId, position }) {
    if (
      !isValidUserId(userId) ||
      !isValidUserId(officeId) ||
      (position !== undefined && !isValidPeerPresencePayload({ userId, officeId, position }))
    ) {
      throw new TypeError('A valid user ID, office ID, and optional position are required.');
    }

    this.userId = userId.trim();
    this.officeId = officeId.trim();
    this.position = position;
    this.knownUsers.clear();
    this.knownUsers.add(this.userId);

    if (typeof BroadcastChannel !== 'undefined') {
      if (this.channel) {
        this.channel.onmessage = null;
        this.channel.close();
      }
      this.channel = new BroadcastChannel(`${this.channelName}_${this.officeId}`);
      this.channel.onmessage = (event) => this._handleBroadcastMessage(event.data);
    }

    this.emitLocal('connected', { transport: 'broadcast' });

    // Broadcast join to peers
    this._broadcast(SIGNALING_EVENTS.VOICE_USER_JOINED, {
      userId: this.userId,
      officeId: this.officeId,
      position,
    });
  }

  _handleBroadcastMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    const { type, payload } = message;
    if (typeof type !== 'string' || !payload || typeof payload !== 'object') return;

    if (type === SIGNALING_EVENTS.WEBRTC_OFFER || type === SIGNALING_EVENTS.WEBRTC_ANSWER) {
      const expectedType = type === SIGNALING_EVENTS.WEBRTC_OFFER ? 'offer' : 'answer';
      this._emitValidSignalingPayload(type, normalizeSdpPayload(payload, expectedType));
      return;
    }

    if (type === SIGNALING_EVENTS.WEBRTC_ICE_CANDIDATE) {
      this._emitValidSignalingPayload(type, normalizeIceCandidatePayload(payload));
      return;
    }

    if (
      type !== SIGNALING_EVENTS.VOICE_USER_JOINED &&
      type !== SIGNALING_EVENTS.VOICE_USER_LEFT &&
      type !== SIGNALING_EVENTS.PROXIMITY_UPDATE
    ) {
      return;
    }

    if (
      !isValidPeerPresencePayload(payload) ||
      payload.userId === this.userId ||
      (payload.officeId && payload.officeId !== this.officeId) ||
      !isMessageForUser(payload, this.userId)
    ) {
      console.warn(`[BroadcastSignalingTransport] Ignoring invalid or misrouted ${type} payload.`);
      return;
    }

    if (type === SIGNALING_EVENTS.VOICE_USER_JOINED) {
      if (this.knownUsers.has(payload.userId)) return;
      this.knownUsers.add(payload.userId);
      this._broadcast(SIGNALING_EVENTS.VOICE_USER_JOINED, {
        userId: this.userId,
        officeId: this.officeId,
        position: this.position,
      });
    } else if (type === SIGNALING_EVENTS.VOICE_USER_LEFT) {
      this.knownUsers.delete(payload.userId);
    }

    this.emitLocal(type, payload);
  }

  _broadcast(type, payload) {
    if (this.channel) {
      this.channel.postMessage({ type, payload });
    }
  }

  sendOffer({ toUserId, sdp }) {
    const payload = createOfferPayload({
      fromUserId: this.userId,
      toUserId,
      officeId: this.officeId,
      sdp,
    });
    if (!isValidSdpPayload(payload, 'offer')) {
      console.warn('[BroadcastSignalingTransport] Ignoring invalid outgoing WebRTC offer.');
      return;
    }
    this._broadcast(SIGNALING_EVENTS.WEBRTC_OFFER, payload);
  }

  sendAnswer({ toUserId, sdp }) {
    const payload = createAnswerPayload({
      fromUserId: this.userId,
      toUserId,
      officeId: this.officeId,
      sdp,
    });
    if (!isValidSdpPayload(payload, 'answer')) {
      console.warn('[BroadcastSignalingTransport] Ignoring invalid outgoing WebRTC answer.');
      return;
    }
    this._broadcast(SIGNALING_EVENTS.WEBRTC_ANSWER, payload);
  }

  sendIceCandidate({ toUserId, candidate }) {
    const payload = createIceCandidatePayload({
      fromUserId: this.userId,
      toUserId,
      officeId: this.officeId,
      candidate,
    });
    if (!isValidIceCandidatePayload(payload)) {
      console.warn('[BroadcastSignalingTransport] Ignoring invalid outgoing ICE candidate.');
      return;
    }
    this._broadcast(SIGNALING_EVENTS.WEBRTC_ICE_CANDIDATE, payload);
  }

  updatePosition(position) {
    if (!isValidPosition(position)) {
      console.warn('[BroadcastSignalingTransport] Ignoring invalid position update.');
      return;
    }
    this.position = position;
    this._broadcast(SIGNALING_EVENTS.PROXIMITY_UPDATE, {
      userId: this.userId,
      officeId: this.officeId,
      position,
    });
  }

  leaveVoice() {
    this._broadcast(SIGNALING_EVENTS.VOICE_USER_LEFT, {
      userId: this.userId,
      officeId: this.officeId,
    });
  }

  disconnect() {
    this.leaveVoice();
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
      this.channel = null;
    }
    this.knownUsers.clear();
  }
}
