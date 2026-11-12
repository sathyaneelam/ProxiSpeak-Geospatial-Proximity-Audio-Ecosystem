/**
 * Adapts the EXISTING V5 office Socket.IO connection for Sathya's WebRTC engine.
 * No second socket, duplicate office:join, or accidental office:leave.
 * Pranav's signaling server routes strictly by peer socket IDs.
 */
export class SharedOfficeSocketTransport {
  constructor(socketRef) {
    this.socketRef = socketRef;
    this.socket = null;
    this.listeners = new Map();
    this.boundEvents = [];
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) { this.listeners.get(event)?.delete(handler); }

  emitLocal(event, data) {
    for (const handler of this.listeners.get(event) || []) {
      try { handler(data); }
      catch (err) { console.error(`[Audio signaling] ${event}:`, err); }
    }
  }

  _listen(event, handler) {
    this.socket.on(event, handler);
    this.boundEvents.push([event, handler]);
  }

  async connect() {
    const socket = this.socketRef?.current;
    if (!socket?.connected) throw new Error('Join the virtual office before enabling voice.');
    this.socket = socket;

    // Always key WebRTC negotiations by from=Socket ID; fromUserId is an
    // identity value and is NOT valid as the backend's 'to' relay destination.
    for (const [event, field] of [
      ['webrtc:offer', 'offer'],
      ['webrtc:answer', 'answer'],
      ['webrtc:ice-candidate', 'candidate'],
    ]) {
      this._listen(event, (payload) => {
        if (!payload?.from || !payload[field]) return;
        this.emitLocal(event, {
          ...payload,
          fromUserId: payload.from,
          ...(field === 'candidate' ? {} : { sdp: payload[field] }),
        });
      });
    }

    this._listen('webrtc:error', (payload) => {
      console.warn('[Audio signaling] Backend rejected signaling:', payload);
      this.emitLocal('error', { error: payload });
    });
    this._listen('proximity:enter', (payload) => this.emitLocal('proximity:enter', payload));
    this._listen('proximity:leave', (payload) => this.emitLocal('proximity:leave', payload));
    this._listen('user:left', (payload) => this.emitLocal('voice:user-left', {
      ...payload,
      userId: payload?.socketId,
    }));
    this._listen('disconnect', (reason) => this.emitLocal('disconnected', { reason }));
    this.emitLocal('connected', { socketId: socket.id });
  }

  _send(event, payload) {
    if (!this.socket?.connected) return;
    this.socket.emit(event, payload, (result) => {
      if (result?.status === 'error') {
        console.warn(`[Audio signaling] ${event}:`, result);
        this.emitLocal('error', { error: result });
      }
    });
  }

  sendOffer({ toUserId, sdp }) {
    this._send('webrtc:offer', { to: toUserId, offer: sdp });
  }

  sendAnswer({ toUserId, sdp }) {
    this._send('webrtc:answer', { to: toUserId, answer: sdp });
  }

  sendIceCandidate({ toUserId, candidate }) {
    this._send('webrtc:ice-candidate', { to: toUserId, candidate });
  }

  // Avatar position is already sent by V5's shared office socket.
  updatePosition() {}
  leaveVoice() {}

  disconnect() {
    if (this.socket) {
      for (const [event, handler] of this.boundEvents) this.socket.off(event, handler);
    }
    this.boundEvents = [];
    this.socket = null;
    this.listeners.clear();
  }
}
