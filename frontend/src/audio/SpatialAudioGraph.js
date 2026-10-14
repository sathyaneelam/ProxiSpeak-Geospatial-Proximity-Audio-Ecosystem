/**
 * ProxiSpeak Spatial Audio Graph
 * 
 * Manages the Web Audio API audio graph for spatial proximity attenuation
 * and stereo panning across connected remote WebRTC peers.
 */

import {
  DEFAULT_EARSHOT_RADIUS,
  computeDistance,
  computeSpatialGain,
  computeStereoPan,
} from './spatialAudioMath.js';

export class SpatialAudioGraph {
  constructor(options = {}) {
    this.audioContext = null;
    this.peerNodes = new Map(); // peerId -> { source, gainNode, pannerNode, dummyAudio, lastGain, lastPan, lastDistance }
    this.smoothingTimeConstant = options.smoothingTimeConstant || 0.05; // 50ms smooth transition to prevent clicks
    this.gainCurve = options.gainCurve || 'smooth';
    this.isMuted = false;
  }

  /**
   * Lazily initializes or returns the existing AudioContext.
   * @returns {AudioContext}
   */
  getAudioContext() {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        throw new Error('Web Audio API is not supported in this browser environment.');
      }
      this.audioContext = new AudioCtx();
    }
    return this.audioContext;
  }

  /**
   * Resumes the AudioContext on user interaction to satisfy browser autoplay policies.
   * @returns {Promise<string>} Current context state
   */
  async resumeContext() {
    const ctx = this.getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    return ctx.state;
  }

  /**
   * Adds a remote peer's MediaStream into the spatial audio graph.
   * 
   * Pipeline:
   *   MediaStreamSourceNode -> GainNode (distance attenuation) -> StereoPannerNode (left/right pan) -> destination
   * 
   * @param {string} peerId
   * @param {MediaStream} stream
   * @param {{ x: number, y: number }} [peerPos]
   * @param {{ x: number, y: number }} [localPos]
   * @param {number} [radius]
   */
  addPeerStream(peerId, stream, peerPos = { x: 0, y: 0 }, localPos = { x: 0, y: 0 }, radius = DEFAULT_EARSHOT_RADIUS) {
    if (!stream || !stream.getAudioTracks().length) {
      console.warn(`[SpatialAudioGraph] No audio tracks found for peer ${peerId}`);
      return;
    }

    // Clean up existing peer nodes if already present to prevent duplicate pipelines
    this.removePeer(peerId);

    const ctx = this.getAudioContext();

    // Workaround for Chromium WebRTC audio pipeline bug (Chromium #687574):
    // In Chromium, creating a MediaStreamAudioSourceNode from a remote WebRTC stream
    // requires a companion HTMLAudioElement or the WebRTC decoder may stall or produce silence.
    let dummyAudio = null;
    try {
      dummyAudio = new Audio();
      dummyAudio.srcObject = stream;
      dummyAudio.muted = true; // Muted so it does not bypass the spatial graph
      dummyAudio.play().catch(() => {
        // Autoplay policy might delay playback until user gesture
      });
    } catch {
      // Ignore if HTMLAudioElement is unavailable (e.g. non-browser testing)
    }

    const source = ctx.createMediaStreamSource(stream);
    const gainNode = ctx.createGain();

    // Check for StereoPannerNode support with graceful fallback
    let pannerNode = null;
    if (typeof ctx.createStereoPanner === 'function') {
      pannerNode = ctx.createStereoPanner();
      pannerNode.pan.value = 0;
    }

    // Connect nodes
    if (pannerNode) {
      source.connect(gainNode);
      gainNode.connect(pannerNode);
      pannerNode.connect(ctx.destination);
    } else {
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
    }

    // Initialize initial spatial attenuation and panning
    const distance = computeDistance(localPos.x, localPos.y, peerPos.x, peerPos.y);
    const initialGain = computeSpatialGain(distance, radius, this.gainCurve);
    const initialPan = computeStereoPan(localPos.x, peerPos.x, radius);

    const now = ctx.currentTime;
    gainNode.gain.setValueAtTime(initialGain, now);
    if (pannerNode) {
      pannerNode.pan.setValueAtTime(initialPan, now);
    }

    this.peerNodes.set(peerId, {
      source,
      gainNode,
      pannerNode,
      dummyAudio,
      lastGain: initialGain,
      lastPan: initialPan,
      lastDistance: distance,
    });

    return { gain: initialGain, pan: initialPan, distance };
  }

  /**
   * Updates distance-based gain attenuation and stereo panning for a peer.
   * Smoothly ramps AudioParams to prevent audible pops/clicks.
   * 
   * @param {string} peerId
   * @param {{ x: number, y: number }} peerPos
   * @param {{ x: number, y: number }} localPos
   * @param {number} [radius]
   * @returns {{ gain: number, pan: number, distance: number } | null}
   */
  updatePeerSpatial(peerId, peerPos, localPos, radius = DEFAULT_EARSHOT_RADIUS) {
    const peerData = this.peerNodes.get(peerId);
    if (!peerData) return null;

    const ctx = this.getAudioContext();
    const distance = computeDistance(localPos.x, localPos.y, peerPos.x, peerPos.y);
    const targetGain = this.isMuted ? 0.0 : computeSpatialGain(distance, radius, this.gainCurve);
    const targetPan = computeStereoPan(localPos.x, peerPos.x, radius);

    const now = ctx.currentTime;

    // Use setTargetAtTime for smooth exponential transition without clicks
    try {
      peerData.gainNode.gain.setTargetAtTime(targetGain, now, this.smoothingTimeConstant);
      if (peerData.pannerNode) {
        peerData.pannerNode.pan.setTargetAtTime(targetPan, now, this.smoothingTimeConstant);
      }
    } catch {
      // Fallback for mock environments
      peerData.gainNode.gain.value = targetGain;
      if (peerData.pannerNode) {
        peerData.pannerNode.pan.value = targetPan;
      }
    }

    peerData.lastGain = targetGain;
    peerData.lastPan = targetPan;
    peerData.lastDistance = distance;

    return { gain: targetGain, pan: targetPan, distance };
  }

  /**
   * Retrieves current spatial audio metrics for a peer.
   * @param {string} peerId
   */
  getPeerSpatialMetrics(peerId) {
    const peerData = this.peerNodes.get(peerId);
    if (!peerData) return null;
    return {
      gain: peerData.lastGain,
      pan: peerData.lastPan,
      distance: peerData.lastDistance,
    };
  }

  /**
   * Removes and disconnects a peer from the audio graph.
   * @param {string} peerId
   */
  removePeer(peerId) {
    const peerData = this.peerNodes.get(peerId);
    if (!peerData) return;

    try {
      peerData.source.disconnect();
      peerData.gainNode.disconnect();
      if (peerData.pannerNode) {
        peerData.pannerNode.disconnect();
      }
      if (peerData.dummyAudio) {
        peerData.dummyAudio.pause();
        peerData.dummyAudio.srcObject = null;
      }
    } catch (err) {
      console.warn(`[SpatialAudioGraph] Cleanup warning for peer ${peerId}:`, err);
    }

    this.peerNodes.delete(peerId);
  }

  /**
   * Completely tears down all nodes and closes the AudioContext.
   */
  destroy() {
    for (const peerId of this.peerNodes.keys()) {
      this.removePeer(peerId);
    }
    this.peerNodes.clear();

    if (this.audioContext) {
      try {
        if (this.audioContext.state !== 'closed') {
          this.audioContext.close();
        }
      } catch (err) {
        console.warn('[SpatialAudioGraph] Context close warning:', err);
      }
      this.audioContext = null;
    }
  }
}
