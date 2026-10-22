/**
 * ProxiSpeak WebRTC Peer Connection Manager
 * Manages RTCPeerConnection lifecycle, Perfect Negotiation, deduplication,
 * Web Audio spatial routing, and clean teardown.
 * Member 4: WebRTC, Real-Time Audio & Spatial Audio
 */

import {
  calculateDistance,
  calculateGain,
  calculatePan,
  smoothAudioParam,
  DEFAULT_EARSHOT_RADIUS,
} from './spatialAudio.js';
import { audioContextManager } from './audioContextManager.js';

export const DEFAULT_RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 2,
};

/**
 * @typedef {Object} PeerContext
 * @property {string} socketId - Remote peer's Socket ID
 * @property {string} userId - Remote peer's User ID
 * @property {string} displayName - Remote peer's display name
 * @property {RTCPeerConnection} pc - RTCPeerConnection instance
 * @property {boolean} isPolite - Whether this peer rolls back on glare
 * @property {boolean} makingOffer - Negotiation flag
 * @property {boolean} ignoreOffer - Collision flag
 * @property {RTCIceCandidateInit[]} pendingIceCandidates - Buffered candidates before remote SDP
 * @property {MediaStream | null} remoteStream - Remote audio MediaStream
 * @property {HTMLAudioElement | null} audioElement - Remote audio element
 * @property {any | null} audioPipeline - Web Audio spatial nodes
 * @property {number} distance - Current distance in pixels
 * @property {number} gain - Current gain [0.0, 1.0]
 * @property {number} pan - Current pan [-1.0, 1.0]
 * @property {string} connectionState - RTCPeerConnectionState
 */

export class PeerConnectionManager {
  /**
   * @param {Object} options
   * @param {string} options.localSocketId - Local client's socket ID
   * @param {string} options.localUserId - Local client's user ID
   * @param {RTCConfiguration} [options.rtcConfig] - ICE / WebRTC config
   * @param {number} [options.earshotRadius] - Max earshot radius in px
   * @param {(toSocketId: string, offer: RTCSessionDescriptionInit) => void} options.sendOffer
   * @param {(toSocketId: string, answer: RTCSessionDescriptionInit) => void} options.sendAnswer
   * @param {(toSocketId: string, candidate: RTCIceCandidateInit) => void} options.sendIceCandidate
   * @param {(peers: PeerContext[]) => void} [options.onPeersUpdated]
   */
  constructor(options) {
    this.localSocketId = options.localSocketId || '';
    this.localUserId = options.localUserId || '';
    this.rtcConfig = options.rtcConfig || DEFAULT_RTC_CONFIG;
    this.earshotRadius = options.earshotRadius || DEFAULT_EARSHOT_RADIUS;

    this.sendOffer = options.sendOffer;
    this.sendAnswer = options.sendAnswer;
    this.sendIceCandidate = options.sendIceCandidate;
    this.onPeersUpdated = options.onPeersUpdated || (() => {});

    /** @type {Map<string, PeerContext>} */
    this.peers = new Map();

    /** @type {MediaStream | null} */
    this.localStream = null;
  }

  /**
   * Sets the active local audio stream and attaches tracks to existing PCs.
   * @param {MediaStream | null} stream
   */
  setLocalStream(stream) {
    this.localStream = stream;
    const audioTrack = stream ? stream.getAudioTracks()[0] : null;

    for (const [, peer] of this.peers) {
      if (peer.pc && peer.pc.signalingState !== 'closed') {
        const senders = peer.pc.getSenders();
        const audioSender = senders.find((s) => s.track && s.track.kind === 'audio');

        if (audioSender && audioTrack) {
          audioSender.replaceTrack(audioTrack).catch((err) => {
            console.warn(`[PeerConnectionManager] Error replacing track for peer ${peer.socketId}:`, err);
          });
        } else if (!audioSender && audioTrack) {
          try {
            peer.pc.addTrack(audioTrack, stream);
          } catch (err) {
            console.warn(`[PeerConnectionManager] Error adding track for peer ${peer.socketId}:`, err);
          }
        }
      }
    }
  }

  /**
   * Updates local identity parameters if they were assigned asynchronously by the server.
   * @param {string} socketId
   * @param {string} userId
   */
  updateLocalIdentity(socketId, userId) {
    this.localSocketId = socketId || this.localSocketId;
    this.localUserId = userId || this.localUserId;
  }

  /**
   * Checks if an active peer connection exists for the given socket ID.
   * @param {string} socketId
   * @returns {boolean}
   */
  hasPeer(socketId) {
    return this.peers.has(socketId);
  }

  /**
   * Returns a peer context by socket ID.
   * @param {string} socketId
   * @returns {PeerContext | undefined}
   */
  getPeer(socketId) {
    return this.peers.get(socketId);
  }

  /**
   * Creates or returns an existing peer connection for a remote peer.
   * Prevents duplicate connections for the same peer pair.
   *
   * @param {string} peerSocketId
   * @param {string} [peerUserId]
   * @param {string} [peerDisplayName]
   * @returns {PeerContext}
   */
  getOrCreatePeer(peerSocketId, peerUserId = '', peerDisplayName = '') {
    if (!peerSocketId || typeof peerSocketId !== 'string') {
      throw new Error('[PeerConnectionManager] Valid peerSocketId is required.');
    }

    if (this.peers.has(peerSocketId)) {
      return this.peers.get(peerSocketId);
    }

    // Deterministic tie-breaking for W3C Perfect Negotiation:
    // The polite peer rolls back offer collisions. Local is polite if its ID is lexically smaller.
    const isPolite = (this.localSocketId || '') < peerSocketId;

    const pc = new RTCPeerConnection(this.rtcConfig);

    /** @type {PeerContext} */
    const peer = {
      socketId: peerSocketId,
      userId: peerUserId || peerSocketId,
      displayName: peerDisplayName || `User ${peerSocketId.slice(0, 5)}`,
      pc,
      isPolite,
      makingOffer: false,
      ignoreOffer: false,
      pendingIceCandidates: [],
      remoteStream: null,
      audioElement: null,
      audioPipeline: null,
      distance: 0,
      gain: 1.0,
      pan: 0.0,
      connectionState: pc.connectionState,
    };

    this.peers.set(peerSocketId, peer);

    // Setup local audio track if already capturing
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        try {
          pc.addTrack(audioTrack, this.localStream);
        } catch (err) {
          console.warn(`[PeerConnectionManager] Failed to add track to peer ${peerSocketId}:`, err);
        }
      }
    }

    // ICE Candidate Exchange
    pc.onicecandidate = (event) => {
      if (event.candidate && typeof this.sendIceCandidate === 'function') {
        this.sendIceCandidate(peerSocketId, event.candidate.toJSON());
      }
    };

    // Connection State Handling
    pc.onconnectionstatechange = () => {
      peer.connectionState = pc.connectionState;
      this._emitPeersUpdated();

      if (
        pc.connectionState === 'disconnected' ||
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        console.log(`[PeerConnectionManager] Peer ${peerSocketId} state: ${pc.connectionState}`);
      }
    };

    // Remote Audio Track Received
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;

      peer.remoteStream = stream;

      try {
        // Unlock Web Audio context if necessary
        audioContextManager.resumeAudioContext().catch(() => {});

        // Build spatial audio Web Audio graph
        peer.audioPipeline = audioContextManager.createSpatialPipeline(
          stream,
          peer.gain,
          peer.pan
        );
      } catch (err) {
        console.warn(`[PeerConnectionManager] Spatial pipeline creation failed for ${peerSocketId}, falling back to Audio element:`, err);
      }

      // Hidden audio element fallback to ensure media stream decoding stays alive
      try {
        const audioEl = new Audio();
        audioEl.srcObject = stream;
        audioEl.autoplay = true;
        audioEl.muted = Boolean(peer.audioPipeline); // Mute element if Web Audio API is handling playback
        audioEl.playsInline = true;
        audioEl.play().catch((playErr) => {
          console.warn(`[PeerConnectionManager] Autoplay audio playback warning:`, playErr.message);
        });
        peer.audioElement = audioEl;
      } catch (err) {
        void err;
      }

      this._emitPeersUpdated();
    };

    // W3C Perfect Negotiation: negotiationneeded handler
    pc.onnegotiationneeded = async () => {
      if (peer.makingOffer || pc.signalingState !== 'stable') return;

      try {
        peer.makingOffer = true;
        const offer = await pc.createOffer();

        if (pc.signalingState !== 'stable') return;

        await pc.setLocalDescription(offer);

        if (typeof this.sendOffer === 'function') {
          this.sendOffer(
            peerSocketId,
            pc.localDescription.toJSON
              ? pc.localDescription.toJSON()
              : pc.localDescription
          );
        }
      } catch (err) {
        console.error(
          `[PeerConnectionManager] Negotiation error with peer ${peerSocketId}:`,
          err
        );
      } finally {
        peer.makingOffer = false;
      }
    };

    this._emitPeersUpdated();
    return peer;
  }

  /**
   * Initiates connection to a peer that just entered earshot.
   * @param {string} peerSocketId
   * @param {string} [peerUserId]
   * @param {string} [peerDisplayName]
   */
  async initiateConnection(peerSocketId, peerUserId = '', peerDisplayName = '') {
    const peer = this.getOrCreatePeer(peerSocketId, peerUserId, peerDisplayName);

    // Only create an initial offer if not already connected or negotiating
    if (peer.pc.signalingState === 'stable' && !peer.makingOffer) {
      try {
        peer.makingOffer = true;
        const offer = await peer.pc.createOffer();
        if (peer.pc.signalingState !== 'stable') return;

        await peer.pc.setLocalDescription(offer);
        if (typeof this.sendOffer === 'function') {
          this.sendOffer(peerSocketId, peer.pc.localDescription.toJSON ? peer.pc.localDescription.toJSON() : peer.pc.localDescription);
        }
      } catch (err) {
        console.error(`[PeerConnectionManager] Failed initiating offer for ${peerSocketId}:`, err);
      } finally {
        peer.makingOffer = false;
      }
    }
  }

  /**
   * Handles incoming WebRTC offer using Perfect Negotiation pattern.
   *
   * @param {string} fromSocketId
   * @param {string} fromUserId
   * @param {RTCSessionDescriptionInit} offer
   */
  async handleRemoteOffer(fromSocketId, fromUserId, offer) {
    const peer = this.getOrCreatePeer(fromSocketId, fromUserId);
    const pc = peer.pc;

    // Glare handling: check if we are also trying to make an offer
    const offerCollision =
      peer.makingOffer || pc.signalingState !== 'stable';

    peer.ignoreOffer = !peer.isPolite && offerCollision;

    if (peer.ignoreOffer) {
      console.warn(`[PeerConnectionManager] Impolite peer ignoring colliding offer from ${fromSocketId}`);
      return;
    }

    try {
      if (offerCollision && peer.isPolite) {
        console.log(`[PeerConnectionManager] Polite peer rolling back colliding offer for ${fromSocketId}`);
        await pc.setLocalDescription({ type: 'rollback' });
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Flush any ICE candidates buffered prior to remote description
      await this._drainPendingCandidates(peer);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      if (typeof this.sendAnswer === 'function') {
        this.sendAnswer(fromSocketId, pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription);
      }
    } catch (err) {
      console.error(`[PeerConnectionManager] Error handling offer from ${fromSocketId}:`, err);
    }
  }

  /**
   * Handles incoming WebRTC answer.
   *
   * @param {string} fromSocketId
   * @param {RTCSessionDescriptionInit} answer
   */
  async handleRemoteAnswer(fromSocketId, answer) {
    const peer = this.peers.get(fromSocketId);
    if (!peer) {
      console.warn(`[PeerConnectionManager] Received answer from unknown peer ${fromSocketId}`);
      return;
    }

    try {
      if (peer.pc.signalingState === 'have-local-offer') {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
        await this._drainPendingCandidates(peer);
      }
    } catch (err) {
      console.error(`[PeerConnectionManager] Error handling answer from ${fromSocketId}:`, err);
    }
  }

  /**
   * Handles incoming ICE candidate with buffering if remote description is not yet applied.
   *
   * @param {string} fromSocketId
   * @param {RTCIceCandidateInit} candidate
   */
  async handleRemoteIceCandidate(fromSocketId, candidate) {
    if (!candidate || !candidate.candidate) return;

    const peer = this.peers.get(fromSocketId);
    if (!peer) return;

    try {
      if (!peer.pc.remoteDescription || !peer.pc.remoteDescription.type) {
        // Buffer candidate until remote SDP is processed
        peer.pendingIceCandidates.push(candidate);
      } else {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (err) {
      if (!peer.ignoreOffer) {
        console.warn(`[PeerConnectionManager] Error adding ICE candidate for ${fromSocketId}:`, err);
      }
    }
  }

  /**
   * Drains buffered ICE candidates after setting remote description.
   * @private
   */
  async _drainPendingCandidates(peer) {
    while (peer.pendingIceCandidates.length > 0) {
      const candidate = peer.pendingIceCandidates.shift();
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn(`[PeerConnectionManager] Error draining ICE candidate:`, err);
      }
    }
  }

  /**
   * Updates real-time spatial audio parameters (gain and pan) based on avatar positions.
   *
   * @param {string} peerSocketId
   * @param {{ x: number, y: number }} listenerPos
   * @param {{ x: number, y: number }} peerPos
   * @param {number} [earshotRadius=DEFAULT_EARSHOT_RADIUS]
   */
  updateSpatialParameters(peerSocketId, listenerPos, peerPos, earshotRadius = this.earshotRadius) {
    const peer = this.peers.get(peerSocketId);
    if (!peer) return;

    const distance = calculateDistance(listenerPos, peerPos);
    const targetGain = calculateGain(distance, earshotRadius);
    const targetPan = calculatePan(listenerPos, peerPos, earshotRadius);

    peer.distance = distance;
    peer.gain = targetGain;
    peer.pan = targetPan;

    // Apply smooth Web Audio parameter transition
    if (peer.audioPipeline) {
      const ctx = audioContextManager.context;
      if (peer.audioPipeline.gainNode?.gain) {
        smoothAudioParam(peer.audioPipeline.gainNode.gain, targetGain, ctx, 0.05);
      }
      if (peer.audioPipeline.isStereoPanner && peer.audioPipeline.pannerNode?.pan) {
        smoothAudioParam(peer.audioPipeline.pannerNode.pan, targetPan, ctx, 0.05);
      }
    }

    this._emitPeersUpdated();
  }

  /**
   * Closes a single peer connection and releases its audio resources.
   * @param {string} peerSocketId
   */
  closePeer(peerSocketId) {
    const peer = this.peers.get(peerSocketId);
    if (!peer) return;

    // Teardown Web Audio graph
    if (peer.audioPipeline && typeof peer.audioPipeline.disconnect === 'function') {
      try {
        peer.audioPipeline.disconnect();
      } catch (err) {
        void err;
      }
      peer.audioPipeline = null;
    }

    // Teardown audio element
    if (peer.audioElement) {
      try {
        peer.audioElement.pause();
        peer.audioElement.srcObject = null;
        peer.audioElement.remove();
      } catch (err) {
        void err;
      }
      peer.audioElement = null;
    }

    // Stop remote media stream tracks
    if (peer.remoteStream) {
      try {
        peer.remoteStream.getTracks().forEach((track) => track.stop());
      } catch (err) {
        void err;
      }
      peer.remoteStream = null;
    }

    // Close RTCPeerConnection
    if (peer.pc) {
      try {
        peer.pc.ontrack = null;
        peer.pc.onicecandidate = null;
        peer.pc.onconnectionstatechange = null;
        peer.pc.onnegotiationneeded = null;
        peer.pc.close();
      } catch (err) {
        void err;
      }
    }

    this.peers.delete(peerSocketId);
    this._emitPeersUpdated();
  }

  /**
   * Closes all peer connections and clears resources.
   */
  closeAllPeers() {
    const socketIds = Array.from(this.peers.keys());
    for (const id of socketIds) {
      this.closePeer(id);
    }
    this.peers.clear();
    this._emitPeersUpdated();
  }

  /**
   * Returns list of currently active peer contexts.
   * @returns {PeerContext[]}
   */
  getPeersList() {
    return Array.from(this.peers.values());
  }

  /**
   * Internal notification of peer list changes.
   * @private
   */
  _emitPeersUpdated() {
    if (typeof this.onPeersUpdated === 'function') {
      this.onPeersUpdated(this.getPeersList());
    }
  }
}
