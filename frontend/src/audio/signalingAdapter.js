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
  isValidSdpPayload,
  isValidIceCandidatePayload,
} from './signalingContract.js';

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
      this.listeners.get(event).delete(handler);
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
  }

  async connect({ userId, officeId, position }) {
    this.userId = userId;
    this.officeId = officeId;

    if (!this.socket) {
      this.socket = io(this.serverUrl, this.options);
      this._bindSocketEvents();
    }

    if (!this.socket.connected) {
      this.socket.connect();
    }

    this.socket.emit(SIGNALING_EVENTS.VOICE_JOIN, {
      userId,
      officeId,
      position,
    });

    // Also emit office:join for Member 2 backend presence registration
    this.socket.emit('office:join', {
      officeId: officeId || 'default-office',
      userId,
      displayName: userId,
      x: position?.x ?? 0,
      y: position?.y ?? 0,
    });
  }

  _bindSocketEvents() {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      this.emitLocal('connected', { socketId: this.socket.id });
    });

    this.socket.on('disconnect', (reason) => {
      this.emitLocal('disconnected', { reason });
    });

    this.socket.on('connect_error', (err) => {
      this.emitLocal('error', { error: err });
    });

    // WebRTC Signaling Events (handles both Member 4 sdp and Member 2 offer/answer/relay)
    this.socket.on(SIGNALING_EVENTS.WEBRTC_OFFER, (data) => {
      if (isValidSdpPayload(data)) {
        const isTarget =
          !data.toUserId ||
          data.toUserId === this.userId ||
          data.to === this.userId ||
          data.to === this.socket?.id;

        if (isTarget) {
          const sdp = data.offer || data.sdp;
          const fromUserId = data.fromUserId || data.from;
          this.emitLocal(SIGNALING_EVENTS.WEBRTC_OFFER, {
            ...data,
            fromUserId,
            sdp,
          });
        }
      }
    });

    this.socket.on(SIGNALING_EVENTS.WEBRTC_ANSWER, (data) => {
      if (isValidSdpPayload(data)) {
        const isTarget =
          !data.toUserId ||
          data.toUserId === this.userId ||
          data.to === this.userId ||
          data.to === this.socket?.id;

        if (isTarget) {
          const sdp = data.answer || data.sdp;
          const fromUserId = data.fromUserId || data.from;
          this.emitLocal(SIGNALING_EVENTS.WEBRTC_ANSWER, {
            ...data,
            fromUserId,
            sdp,
          });
        }
      }
    });

    this.socket.on(SIGNALING_EVENTS.WEBRTC_ICE_CANDIDATE, (data) => {
      if (isValidIceCandidatePayload(data)) {
        const isTarget =
          !data.toUserId ||
          data.toUserId === this.userId ||
          data.to === this.userId ||
          data.to === this.socket?.id;

        if (isTarget) {
          const fromUserId = data.fromUserId || data.from;
          this.emitLocal(SIGNALING_EVENTS.WEBRTC_ICE_CANDIDATE, {
            ...data,
            fromUserId,
          });
        }
      }
    });

    // Member 2 Server error event
    this.socket.on(SIGNALING_EVENTS.WEBRTC_ERROR, (err) => {
      this.emitLocal(SIGNALING_EVENTS.WEBRTC_ERROR, err);
      this.emitLocal('error', { error: err });
    });

    // Voice room presence (supports Member 4 voice:* and Member 2 user:* & proximity:*)
    this.socket.on(SIGNALING_EVENTS.VOICE_USER_JOINED, (data) => {
      this.emitLocal(SIGNALING_EVENTS.VOICE_USER_JOINED, data);
    });

    this.socket.on(SIGNALING_EVENTS.VOICE_USER_LEFT, (data) => {
      this.emitLocal(SIGNALING_EVENTS.VOICE_USER_LEFT, data);
    });

    this.socket.on('user:joined', (data) => {
      this.emitLocal(SIGNALING_EVENTS.VOICE_USER_JOINED, {
        userId: data.userId || data.socketId,
        socketId: data.socketId,
        position: { x: data.x, y: data.y },
      });
    });

    this.socket.on('user:left', (data) => {
      this.emitLocal(SIGNALING_EVENTS.VOICE_USER_LEFT, {
        userId: data.userId || data.socketId,
        socketId: data.socketId,
      });
    });

    this.socket.on('proximity:enter', (data) => {
      this.emitLocal('proximity:enter', data);
    });

    this.socket.on('proximity:leave', (data) => {
      this.emitLocal('proximity:leave', data);
    });

    this.socket.on(SIGNALING_EVENTS.PROXIMITY_UPDATE, (data) => {
      this.emitLocal(SIGNALING_EVENTS.PROXIMITY_UPDATE, data);
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
    this.socket.emit(SIGNALING_EVENTS.WEBRTC_ICE_CANDIDATE, payload);
  }

  updatePosition(position) {
    if (!this.socket?.connected) return;
    this.socket.emit(SIGNALING_EVENTS.PROXIMITY_UPDATE, {
      userId: this.userId,
      officeId: this.officeId,
      position,
    });

    // Also emit avatar:move for Member 2 proximity evaluations
    this.socket.emit('avatar:move', {
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      officeId: this.officeId,
      userId: this.userId,
    });
  }

  leaveVoice() {
    if (this.socket?.connected) {
      this.socket.emit(SIGNALING_EVENTS.VOICE_LEAVE, {
        userId: this.userId,
        officeId: this.officeId,
      });
      this.socket.emit('office:leave');
    }
  }

  disconnect() {
    this.leaveVoice();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
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
  }

  async connect({ userId, officeId, position }) {
    this.userId = userId;
    this.officeId = officeId;

    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`${this.channelName}_${officeId}`);
      this.channel.onmessage = (event) => {
        const { type, payload } = event.data || {};
        if (!type || !payload) return;

        // Skip messages sent by self
        if (payload.fromUserId === this.userId || payload.userId === this.userId) return;

        // Route if message is targeted to this user or broadcast to room
        if (!payload.toUserId || payload.toUserId === this.userId) {
          this.emitLocal(type, payload);
        }
      };
    }

    this.emitLocal('connected', { transport: 'broadcast' });

    // Broadcast join to peers
    this._broadcast(SIGNALING_EVENTS.VOICE_USER_JOINED, {
      userId: this.userId,
      officeId: this.officeId,
      position,
    });
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
    this._broadcast(SIGNALING_EVENTS.WEBRTC_OFFER, payload);
  }

  sendAnswer({ toUserId, sdp }) {
    const payload = createAnswerPayload({
      fromUserId: this.userId,
      toUserId,
      officeId: this.officeId,
      sdp,
    });
    this._broadcast(SIGNALING_EVENTS.WEBRTC_ANSWER, payload);
  }

  sendIceCandidate({ toUserId, candidate }) {
    const payload = createIceCandidatePayload({
      fromUserId: this.userId,
      toUserId,
      officeId: this.officeId,
      candidate,
    });
    this._broadcast(SIGNALING_EVENTS.WEBRTC_ICE_CANDIDATE, payload);
  }

  updatePosition(position) {
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
      this.channel.close();
      this.channel = null;
    }
  }
}
