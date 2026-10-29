/**
 * ProxiSpeak Audio Signaling Adapter
 * Bridges Socket.io transport with PeerConnectionManager.
 * Validates payloads, handles proximity lifecycle events, and routes WebRTC packets.
 * Member 4: WebRTC, Real-Time Audio & Spatial Audio
 */

export class AudioSignalingAdapter {
  /**
   * @param {Object} options
   * @param {import('socket.io-client').Socket} options.socket - Socket.io client instance
   * @param {import('./peerConnectionManager.js').PeerConnectionManager} options.peerConnectionManager
   * @param {(error: { code: string, message: string, target?: string }) => void} [options.onError]
   */
  constructor({ socket, peerConnectionManager, onError = () => {} }) {
    this.socket = socket;
    this.peerConnectionManager = peerConnectionManager;
    this.onError = onError;
    this.boundHandlers = {};
  }

  /**
   * Attaches Socket.io event listeners for proximity transitions and WebRTC signaling.
   */
  attachListeners() {
    if (!this.socket) return;

    this.boundHandlers = {
      'proximity:enter': this._handleProximityEnter.bind(this),
      'proximity:leave': this._handleProximityLeave.bind(this),
      'webrtc:offer': this._handleWebRTCOffer.bind(this),
      'webrtc:answer': this._handleWebRTCAnswer.bind(this),
      'webrtc:ice-candidate': this._handleWebRTCIceCandidate.bind(this),
      'webrtc:peer-disconnect': this._handlePeerDisconnect.bind(this),
      'webrtc:error': this._handleWebRTCError.bind(this),
      'user:left': this._handleUserLeft.bind(this),
    };

    for (const [event, handler] of Object.entries(this.boundHandlers)) {
      this.socket.on(event, handler);
    }
  }

  /**
   * Detaches all audio signaling listeners.
   */
  detachListeners() {
    if (!this.socket) return;

    for (const [event, handler] of Object.entries(this.boundHandlers)) {
      this.socket.off(event, handler);
    }
    this.boundHandlers = {};
  }

  /**
   * Sends a WebRTC offer through Socket.io.
   * Payload format: { to: string, offer: object }
   * @param {string} toSocketId
   * @param {RTCSessionDescriptionInit} offer
   */
  sendOffer(toSocketId, offer) {
    if (!this.socket?.connected || !toSocketId || !offer) return;
    this.socket.emit('webrtc:offer', { to: toSocketId, offer });
  }

  /**
   * Sends a WebRTC answer through Socket.io.
   * Payload format: { to: string, answer: object }
   * @param {string} toSocketId
   * @param {RTCSessionDescriptionInit} answer
   */
  sendAnswer(toSocketId, answer) {
    if (!this.socket?.connected || !toSocketId || !answer) return;
    this.socket.emit('webrtc:answer', { to: toSocketId, answer });
  }

  /**
   * Sends an ICE candidate through Socket.io.
   * Payload format: { to: string, candidate: object }
   * @param {string} toSocketId
   * @param {RTCIceCandidateInit} candidate
   */
  sendIceCandidate(toSocketId, candidate) {
    if (!this.socket?.connected || !toSocketId || !candidate) return;
    this.socket.emit('webrtc:ice-candidate', { to: toSocketId, candidate });
  }

  /**
   * Triggered when two peers enter 100px earshot radius in the same office.
   * Payload: { peerSocketId: string, peerUserId: string, peerDisplayName?: string, distance: number, earshotRadius: 100 }
   * @private
   */
  _handleProximityEnter(data) {
    if (!data || !data.peerSocketId) return;

    // Do not initiate connection to oneself
    if (data.peerSocketId === this.socket.id) return;

    this.peerConnectionManager.initiateConnection(
      data.peerSocketId,
      data.peerUserId,
      data.peerDisplayName
    );
  }

  /**
   * Triggered when a peer leaves earshot radius or disconnects.
   * Payload: { peerSocketId: string, peerUserId: string, distance?: number, reason?: string }
   * @private
   */
  _handleProximityLeave(data) {
    if (!data) return;
    const target = data.peerSocketId || data.peerUserId || data.userId;
    if (target) {
      this.peerConnectionManager.closePeer(target);
    }
  }

  /**
   * Triggered on incoming forwarded offer from signaling server.
   * Payload: { from: string, fromUserId: string, offer: object }
   * @private
   */
  _handleWebRTCOffer(data) {
    if (!data || !data.from || !data.offer) {
      console.warn('[AudioSignalingAdapter] Discarding invalid webrtc:offer payload:', data);
      return;
    }

    if (data.from === this.socket.id) return;

    this.peerConnectionManager.handleRemoteOffer(
      data.from,
      data.fromUserId,
      data.offer
    );
  }

  /**
   * Triggered on incoming forwarded answer from signaling server.
   * Payload: { from: string, fromUserId: string, answer: object }
   * @private
   */
  _handleWebRTCAnswer(data) {
    if (!data || !data.from || !data.answer) {
      console.warn('[AudioSignalingAdapter] Discarding invalid webrtc:answer payload:', data);
      return;
    }

    if (data.from === this.socket.id) return;

    this.peerConnectionManager.handleRemoteAnswer(data.from, data.answer);
  }

  /**
   * Triggered on incoming forwarded ICE candidate from signaling server.
   * Payload: { from: string, fromUserId: string, candidate: object }
   * @private
   */
  _handleWebRTCIceCandidate(data) {
    if (!data || !data.from || !data.candidate) return;
    if (data.from === this.socket.id) return;

    this.peerConnectionManager.handleRemoteIceCandidate(data.from, data.candidate);
  }

  /**
   * Triggered when signaling server rejects WebRTC packet (e.g. peer out of earshot).
   * Payload: { status: "error", code: string, message: string, targetSocketId?: string, distance?: number }
   * @private
   */
  _handleWebRTCError(data) {
    console.warn('[AudioSignalingAdapter] Signaling server rejected packet:', data);

    if (data?.code === 'PEER_OUT_OF_RANGE' && data?.targetSocketId) {
      // Peer moved out of range during in-flight negotiation; tear down gracefully
      this.peerConnectionManager.closePeer(data.targetSocketId);
    }

    if (typeof this.onError === 'function') {
      this.onError({
        code: data?.code || 'SIGNALING_ERROR',
        message: data?.message || 'WebRTC signaling failed',
        target: data?.targetSocketId,
      });
    }
  }

  /**
   * Triggered when a peer disconnects explicitly via WebRTC disconnect message.
   * @private
   */
  _handlePeerDisconnect(data) {
    if (!data) return;
    const target = data.peerId || data.peerUserId || data.socketId || data.userId || data.from;
    if (target) {
      this.peerConnectionManager.closePeer(target);
    }
  }

  /**
   * Triggered when a peer disconnects from the office room.
   * Payload: { socketId: string, userId: string }
   * @private
   */
  _handleUserLeft(data) {
    if (!data) return;
    const target = data.socketId || data.userId || data.peerUserId;
    if (target) {
      this.peerConnectionManager.closePeer(target);
    }
  }
}
