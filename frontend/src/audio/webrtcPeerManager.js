/**
 * ProxiSpeak WebRTC Peer Manager
 *
 * Implements the W3C WebRTC "Perfect Negotiation" pattern to guarantee:
 * 1. Zero duplicate RTCPeerConnection instances for any peer pair.
 * 2. Glare-safe negotiation with deterministic polite/impolite arbitration.
 * 3. Early ICE candidate buffering before remote description is ready.
 * 4. Robust track addition, ICE exchange, state tracking, and teardown.
 */

/**
 * Resolves WebRTC ICE configuration with standard Google STUN servers
 * and dynamic TURN server credentials configurable via environment variables
 * (e.g., VITE_STUN_URL, VITE_TURN_URL, VITE_TURN_USERNAME, VITE_TURN_CREDENTIAL).
 *
 * @param {RTCConfiguration} [customConfig]
 * @returns {RTCConfiguration}
 */
export function getRTCConfiguration(customConfig = {}) {
  const env =
    (typeof process !== 'undefined' && process.env) ||
    (typeof import.meta !== 'undefined' && import.meta.env) ||
    {};

  const stunUrls = env.VITE_STUN_URL || env.STUN_URL;
  const stunList = stunUrls
    ? stunUrls.split(',').map((u) => ({ urls: u.trim() }))
    : [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ];

  const iceServers = [...stunList];

  const turnUrl = env.VITE_TURN_URL || env.TURN_URL;
  if (turnUrl) {
    const turnUrls = turnUrl.includes(',') ? turnUrl.split(',').map((u) => u.trim()) : turnUrl;
    const turnServer = { urls: turnUrls };
    const username = env.VITE_TURN_USERNAME || env.TURN_USERNAME;
    const credential =
      env.VITE_TURN_CREDENTIAL ||
      env.TURN_CREDENTIAL ||
      env.VITE_TURN_PASSWORD ||
      env.TURN_PASSWORD;

    if (username) turnServer.username = username;
    if (credential) turnServer.credential = credential;

    iceServers.push(turnServer);
  }

  return {
    iceServers: customConfig.iceServers || iceServers,
    iceCandidatePoolSize: customConfig.iceCandidatePoolSize ?? 2,
    ...customConfig,
  };
}

export const DEFAULT_RTC_CONFIG = getRTCConfiguration();

export class WebRTCPeerManager {
  /**
   * @param {Object} options
   * @param {string} options.localUserId
   * @param {string} options.officeId
   * @param {Object} options.signalingTransport
   * @param {RTCConfiguration} [options.rtcConfig]
   * @param {Function} [options.onRemoteStream] - (peerId, MediaStream) => void
   * @param {Function} [options.onPeerConnectionState] - (peerId, state) => void
   * @param {Function} [options.onPeerRemoved] - (peerId) => void
   */
  constructor(options = {}) {
    this.localUserId = options.localUserId || `user_${Math.random().toString(36).slice(2, 8)}`;
    this.officeId = options.officeId || 'default-office';
    this.signalingTransport = options.signalingTransport;
    this.rtcConfig = options.rtcConfig ? getRTCConfiguration(options.rtcConfig) : getRTCConfiguration();

    this.onRemoteStream = options.onRemoteStream || (() => {});
    this.onPeerConnectionState = options.onPeerConnectionState || (() => {});
    this.onPeerRemoved = options.onPeerRemoved || (() => {});

    this.peers = new Map(); // peerId -> Session
    this.localStream = null;
    this.unsubSignaling = [];

    if (this.signalingTransport) {
      this._bindSignaling();
    }
  }

  setLocalStream(stream) {
    this.localStream = stream;

    // Update existing peer connections with the new track
    for (const [peerId, session] of this.peers.entries()) {
      const pc = session.pc;
      if (!pc || pc.connectionState === 'closed') continue;

      const audioTrack = stream?.getAudioTracks()[0] || null;
      const senders = pc.getSenders ? pc.getSenders() : [];
      const audioSender = senders.find((s) => s.track && s.track.kind === 'audio');

      if (audioSender && audioTrack) {
        audioSender.replaceTrack(audioTrack).catch((err) => {
          console.warn(`[WebRTCPeerManager] replaceTrack error for peer ${peerId}:`, err);
        });
      } else if (audioTrack) {
        try {
          pc.addTrack(audioTrack, stream);
        } catch (err) {
          console.warn(`[WebRTCPeerManager] addTrack error for peer ${peerId}:`, err);
        }
      }
    }
  }

  _bindSignaling() {
    this.unsubSignaling.push(
      this.signalingTransport.on('webrtc:offer', (payload) => {
        const fromPeerId = payload.fromUserId || payload.from;
        const sdp = payload.sdp || payload.offer;
        if (fromPeerId && sdp) {
          this.handleRemoteOffer(fromPeerId, sdp);
        }
      })
    );

    this.unsubSignaling.push(
      this.signalingTransport.on('webrtc:answer', (payload) => {
        const fromPeerId = payload.fromUserId || payload.from;
        const sdp = payload.sdp || payload.answer;
        if (fromPeerId && sdp) {
          this.handleRemoteAnswer(fromPeerId, sdp);
        }
      })
    );

    this.unsubSignaling.push(
      this.signalingTransport.on('webrtc:ice-candidate', (payload) => {
        const fromPeerId = payload.fromUserId || payload.from;
        if (fromPeerId && payload.candidate) {
          this.handleRemoteIceCandidate(fromPeerId, payload.candidate);
        }
      })
    );

    this.unsubSignaling.push(
      this.signalingTransport.on('voice:user-left', (payload) => {
        const peerId = payload.socketId || payload.userId || payload.peerUserId;
        if (peerId) this.closePeer(peerId);
      })
    );

    this.unsubSignaling.push(
      this.signalingTransport.on('proximity:leave', (payload) => {
        const peerId = payload.peerSocketId || payload.peerUserId || payload.userId;
        if (peerId) this.closePeer(peerId);
      })
    );
  }

  /**
   * Deterministic Polite Peer condition.
   * If localUserId > peerId, local user is polite (will rollback on glare collision).
   * If localUserId < peerId, local user is impolite (will ignore colliding offer).
   * This guarantees one polite and one impolite peer per pair.
   */
  isPolite(peerId) {
    return this.localUserId > peerId;
  }

  /**
   * Gets or creates a single RTCPeerConnection for a peer, preventing duplicates.
   * @param {string} peerId
   * @returns {Object} Peer Session
   */
  getOrCreatePeer(peerId) {
    if (!peerId || peerId === this.localUserId) return null;

    if (this.peers.has(peerId)) {
      const existing = this.peers.get(peerId);
      if (existing.pc && existing.pc.connectionState !== 'closed') {
        return existing;
      }
      this.closePeer(peerId);
    }

    const PeerConnectionClass = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (!PeerConnectionClass) {
      throw new Error('RTCPeerConnection is not supported in this browser environment.');
    }

    const pc = new PeerConnectionClass(this.rtcConfig);
    const polite = this.isPolite(peerId);

    const session = {
      peerId,
      pc,
      isPolite: polite,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      iceCandidateBuffer: [],
      remoteStream: new MediaStream(),
    };

    this.peers.set(peerId, session);

    // Attach local audio track if available
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        try {
          pc.addTrack(audioTrack, this.localStream);
        } catch (err) {
          console.warn(`[WebRTCPeerManager] Failed to add local track to peer ${peerId}:`, err);
        }
      }
    }

    // Perfect Negotiation: onnegotiationneeded
    pc.onnegotiationneeded = async () => {
      try {
        session.makingOffer = true;
        await pc.setLocalDescription();
        if (this.signalingTransport && pc.localDescription) {
          this.signalingTransport.sendOffer({
            toUserId: peerId,
            sdp: pc.localDescription,
          });
        }
      } catch (err) {
        console.error(`[WebRTCPeerManager] Error on negotiationneeded for ${peerId}:`, err);
      } finally {
        session.makingOffer = false;
      }
    };

    // ICE Candidate generation
    pc.onicecandidate = (event) => {
      if (event.candidate && this.signalingTransport) {
        this.signalingTransport.sendIceCandidate({
          toUserId: peerId,
          candidate: event.candidate,
        });
      }
    };

    // Handle remote media tracks
    pc.ontrack = (event) => {
      if (event.track) {
        session.remoteStream.addTrack(event.track);
        this.onRemoteStream(peerId, session.remoteStream);
      }
    };

    // Connection state changes
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      this.onPeerConnectionState(peerId, state);

      if (state === 'failed' || state === 'closed') {
        this.closePeer(peerId);
      }
    };

    return session;
  }

  /**
   * Initiates an offer to a peer (e.g. when entering earshot).
   */
  async initiateConnection(peerId) {
    const session = this.getOrCreatePeer(peerId);
    if (!session) return;

    // Trigger offer generation if state is stable
    if (session.pc.signalingState === 'stable' && !session.makingOffer) {
      try {
        session.makingOffer = true;
        const offer = await session.pc.createOffer();
        await session.pc.setLocalDescription(offer);
        if (this.signalingTransport && session.pc.localDescription) {
          this.signalingTransport.sendOffer({
            toUserId: peerId,
            sdp: session.pc.localDescription,
          });
        }
      } catch (err) {
        console.error(`[WebRTCPeerManager] initiateConnection error for ${peerId}:`, err);
      } finally {
        session.makingOffer = false;
      }
    }
  }

  /**
   * Handles incoming WebRTC SDP Offer with Perfect Negotiation glare handling.
   */
  async handleRemoteOffer(fromPeerId, sdp) {
    if (!sdp || sdp.type !== 'offer') return;

    const session = this.getOrCreatePeer(fromPeerId);
    if (!session) return;

    const pc = session.pc;
    const readyForOffer = !session.makingOffer && (pc.signalingState === 'stable' || session.isSettingRemoteAnswerPending);
    const offerCollision = !readyForOffer;

    session.ignoreOffer = !session.isPolite && offerCollision;
    if (session.ignoreOffer) {
      console.warn(`[WebRTCPeerManager] Glare collision: Impolite peer ignoring offer from ${fromPeerId}`);
      return;
    }

    try {
      if (offerCollision && session.isPolite) {
        console.info(`[WebRTCPeerManager] Glare collision: Polite peer rolling back for ${fromPeerId}`);
        await pc.setLocalDescription({ type: 'rollback' });
      }

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await this._drainIceCandidateBuffer(session);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      if (this.signalingTransport && pc.localDescription) {
        this.signalingTransport.sendAnswer({
          toUserId: fromPeerId,
          sdp: pc.localDescription,
        });
      }
    } catch (err) {
      console.error(`[WebRTCPeerManager] Error handling offer from ${fromPeerId}:`, err);
    }
  }

  /**
   * Handles incoming WebRTC SDP Answer.
   */
  async handleRemoteAnswer(fromPeerId, sdp) {
    if (!sdp || sdp.type !== 'answer') return;

    const session = this.peers.get(fromPeerId);
    if (!session) return;

    const pc = session.pc;
    if (pc.signalingState !== 'have-local-offer') {
      console.warn(`[WebRTCPeerManager] Unexpected answer in state ${pc.signalingState} from ${fromPeerId}`);
      return;
    }

    try {
      session.isSettingRemoteAnswerPending = true;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await this._drainIceCandidateBuffer(session);
    } catch (err) {
      console.error(`[WebRTCPeerManager] Error setting remote answer from ${fromPeerId}:`, err);
    } finally {
      session.isSettingRemoteAnswerPending = false;
    }
  }

  /**
   * Handles incoming ICE candidate with early candidate queueing.
   */
  async handleRemoteIceCandidate(fromPeerId, candidateInit) {
    if (!candidateInit) return;

    const session = this.peers.get(fromPeerId);
    if (!session) return;

    const pc = session.pc;
    if (!pc.remoteDescription || !pc.remoteDescription.type) {
      // Buffer until remote description has been applied
      session.iceCandidateBuffer.push(candidateInit);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
    } catch (err) {
      if (!session.ignoreOffer) {
        console.warn(`[WebRTCPeerManager] Error adding ICE candidate from ${fromPeerId}:`, err);
      }
    }
  }

  async _drainIceCandidateBuffer(session) {
    while (session.iceCandidateBuffer.length > 0) {
      const candidateInit = session.iceCandidateBuffer.shift();
      try {
        await session.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
      } catch (err) {
        if (!session.ignoreOffer) {
          console.warn(`[WebRTCPeerManager] Failed to drain ICE candidate:`, err);
        }
      }
    }
  }

  /**
   * Safely closes a single peer connection and releases resources.
   * @param {string} peerId
   */
  closePeer(peerId) {
    const session = this.peers.get(peerId);
    if (!session) return;

    try {
      if (session.pc) {
        session.pc.ontrack = null;
        session.pc.onicecandidate = null;
        session.pc.onnegotiationneeded = null;
        session.pc.onconnectionstatechange = null;
        if (session.pc.connectionState !== 'closed') {
          session.pc.close();
        }
      }

      if (session.remoteStream) {
        session.remoteStream.getTracks().forEach((t) => t.stop());
      }
    } catch (err) {
      console.warn(`[WebRTCPeerManager] Error closing peer ${peerId}:`, err);
    }

    this.peers.delete(peerId);
    this.onPeerRemoved(peerId);
  }

  /**
   * Closes all peer connections and removes all signaling listeners.
   */
  destroy() {
    for (const unsub of this.unsubSignaling) {
      unsub();
    }
    this.unsubSignaling = [];

    for (const peerId of Array.from(this.peers.keys())) {
      this.closePeer(peerId);
    }
    this.peers.clear();
    this.localStream = null;
  }
}
