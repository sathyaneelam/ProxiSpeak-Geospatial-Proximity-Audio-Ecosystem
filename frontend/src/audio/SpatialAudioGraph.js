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
  computeObstacleAttenuation,
} from './spatialAudioMath.js';

export class SpatialAudioGraph {
  constructor(options = {}) {
    this.audioContext = null;
    this.masterGainNode = null;
    this.masterVolume =
      typeof options.masterVolume === 'number' && Number.isFinite(options.masterVolume)
        ? Math.max(0.0, Math.min(1.0, options.masterVolume))
        : 1.0;
    this.peerNodes = new Map(); // peerId -> { source, gainNode, pannerNode, dummyAudio, lastGain, lastPan, lastDistance, lastObstacleAttenuation, volume }
    this.smoothingTimeConstant = options.smoothingTimeConstant || 0.05; // 50ms smooth transition to prevent clicks
    this.gainCurve = options.gainCurve || 'smooth';
    this.isMuted = Boolean(options.isMuted);
  }

  /**
   * Lazily initializes or returns the existing AudioContext and configures the master gain pipeline.
   * Pipeline: Peer PannerNodes -> Master GainNode -> AudioContext.destination
   * @returns {AudioContext}
   */
  getAudioContext() {
    if (!this.audioContext) {
      const AudioCtx =
        (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) ||
        (typeof globalThis !== 'undefined' && (globalThis.AudioContext || globalThis.webkitAudioContext));
      if (!AudioCtx) {
        throw new Error('Web Audio API is not supported in this browser environment.');
      }
      this.audioContext = new AudioCtx();

      // Configure master output gain bus
      this.masterGainNode = this.audioContext.createGain();
      const initialMasterGain = this.isMuted ? 0.0 : this.masterVolume;
      this.masterGainNode.gain.setValueAtTime(initialMasterGain, this.audioContext.currentTime);
      this.masterGainNode.connect(this.audioContext.destination);
    }
    return this.audioContext;
  }

  /**
   * Returns the master GainNode instance, initializing AudioContext if necessary.
   * @returns {GainNode}
   */
  getMasterGainNode() {
    this.getAudioContext();
    return this.masterGainNode;
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
   *   MediaStreamSourceNode -> GainNode (distance & obstacle attenuation) -> StereoPannerNode (left/right pan) -> MasterGainNode -> destination
   * 
   * @param {string} peerId
   * @param {MediaStream} stream
   * @param {{ x: number, y: number }} [peerPos]
   * @param {{ x: number, y: number }} [localPos]
   * @param {number} [radius]
   * @param {Array<Object>} [obstacles]
   * @returns {{ gain: number, pan: number, distance: number, obstacleAttenuation: number, volume: number } | undefined}
   */
  addPeerStream(peerId, stream, peerPos = { x: 0, y: 0 }, localPos = { x: 0, y: 0 }, radius = DEFAULT_EARSHOT_RADIUS, obstacles = []) {
    if (!stream || !stream.getAudioTracks().length) {
      console.warn(`[SpatialAudioGraph] No audio tracks found for peer ${peerId}`);
      return;
    }

    // Clean up existing peer nodes if already present to prevent duplicate pipelines
    this.removePeer(peerId);

    const ctx = this.getAudioContext();
    const master = this.getMasterGainNode();

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

    // Connect nodes into master output bus
    if (pannerNode) {
      source.connect(gainNode);
      gainNode.connect(pannerNode);
      pannerNode.connect(master);
    } else {
      source.connect(gainNode);
      gainNode.connect(master);
    }

    // Initialize spatial attenuation, obstacle sound blocking, peer volume, and panning
    const distance = computeDistance(localPos.x, localPos.y, peerPos.x, peerPos.y);
    const distanceGain = computeSpatialGain(distance, radius, this.gainCurve);
    const obstacleFactor = computeObstacleAttenuation(localPos, peerPos, obstacles);
    const spatialGain = Math.max(0.0, Math.min(1.0, distanceGain * obstacleFactor));
    const peerVolume = 1.0;
    const effectiveGain = Math.max(0.0, Math.min(1.0, spatialGain * peerVolume));
    const initialPan = computeStereoPan(localPos.x, peerPos.x, radius);

    const now = ctx.currentTime;
    gainNode.gain.setValueAtTime(effectiveGain, now);
    if (pannerNode) {
      pannerNode.pan.setValueAtTime(initialPan, now);
    }

    this.peerNodes.set(peerId, {
      stream,
      source,
      gainNode,
      pannerNode,
      dummyAudio,
      spatialGain,
      lastGain: effectiveGain,
      lastPan: initialPan,
      lastDistance: distance,
      lastObstacleAttenuation: obstacleFactor,
      volume: peerVolume,
    });

    return { gain: effectiveGain, spatialGain, pan: initialPan, distance, obstacleAttenuation: obstacleFactor, volume: peerVolume };
  }

  /**
   * Updates distance-based gain attenuation, obstacle sound blocking, and stereo panning for a peer.
   * Smoothly ramps AudioParams to prevent audible pops/clicks.
   * 
   * @param {string} peerId
   * @param {{ x: number, y: number }} peerPos
   * @param {{ x: number, y: number }} localPos
   * @param {number} [radius]
   * @param {Array<Object>} [obstacles]
   * @returns {{ gain: number, pan: number, distance: number, obstacleAttenuation: number, volume: number } | null}
   */
  updatePeerSpatial(peerId, peerPos, localPos, radius = DEFAULT_EARSHOT_RADIUS, obstacles = []) {
    const peerData = this.peerNodes.get(peerId);
    if (!peerData) return null;

    const ctx = this.getAudioContext();
    const distance = computeDistance(localPos.x, localPos.y, peerPos.x, peerPos.y);
    const distanceGain = computeSpatialGain(distance, radius, this.gainCurve);
    const obstacleFactor = computeObstacleAttenuation(localPos, peerPos, obstacles);
    const spatialGain = Math.max(0.0, Math.min(1.0, distanceGain * obstacleFactor));
    const peerVol = peerData.volume ?? 1.0;
    const effectiveGain = Math.max(0.0, Math.min(1.0, spatialGain * peerVol));
    const targetPan = computeStereoPan(localPos.x, peerPos.x, radius);

    const now = ctx.currentTime;

    // Use setTargetAtTime for smooth exponential transition without clicks
    try {
      peerData.gainNode.gain.setTargetAtTime(effectiveGain, now, this.smoothingTimeConstant);
      if (peerData.pannerNode) {
        peerData.pannerNode.pan.setTargetAtTime(targetPan, now, this.smoothingTimeConstant);
      }
    } catch {
      // Fallback for mock environments
      peerData.gainNode.gain.value = effectiveGain;
      if (peerData.pannerNode) {
        peerData.pannerNode.pan.value = targetPan;
      }
    }

    peerData.spatialGain = spatialGain;
    peerData.lastGain = effectiveGain;
    peerData.lastPan = targetPan;
    peerData.lastDistance = distance;
    peerData.lastObstacleAttenuation = obstacleFactor;

    return { gain: effectiveGain, spatialGain, pan: targetPan, distance, obstacleAttenuation: obstacleFactor, volume: peerVol };
  }

  /**
   * Mutes or unmutes master incoming audio (deafen).
   * Ramps the masterGainNode smoothly without losing individual peer spatial states.
   * @param {boolean} muted
   */
  setMuted(muted) {
    this.isMuted = Boolean(muted);
    const ctx = this.getAudioContext();
    const targetGain = this.isMuted ? 0.0 : this.masterVolume;
    const now = ctx.currentTime;

    if (this.masterGainNode) {
      try {
        this.masterGainNode.gain.setTargetAtTime(targetGain, now, this.smoothingTimeConstant);
      } catch {
        this.masterGainNode.gain.value = targetGain;
      }
    }
  }

  /**
   * Sets master output volume level.
   * @param {number} volume - Volume clamped between 0.0 and 1.0
   * @returns {number} The updated master volume
   */
  setMasterVolume(volume) {
    if (typeof volume !== 'number' || Number.isNaN(volume)) {
      return this.masterVolume;
    }
    this.masterVolume = Math.max(0.0, Math.min(1.0, volume));
    if (!this.isMuted && this.masterGainNode) {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      try {
        this.masterGainNode.gain.setTargetAtTime(this.masterVolume, now, this.smoothingTimeConstant);
      } catch {
        this.masterGainNode.gain.value = this.masterVolume;
      }
    }
    return this.masterVolume;
  }

  /**
   * Returns the current master output volume.
   * @returns {number}
   */
  getMasterVolume() {
    return this.masterVolume;
  }

  /**
   * Returns whether master audio is currently muted (deafened).
   * @returns {boolean}
   */
  isMasterMuted() {
    return this.isMuted;
  }

  /**
   * Adjusts the volume multiplier for an individual peer.
   * Calculates effective gain strictly as spatialGain × peer.volume to prevent compounding.
   * @param {string} peerId
   * @param {number} volume - Multiplier clamped between 0.0 and 2.0
   * @returns {number | null}
   */
  setPeerVolume(peerId, volume) {
    const peerData = this.peerNodes.get(peerId);
    if (!peerData) return null;

    if (typeof volume !== 'number' || Number.isNaN(volume)) {
      return peerData.volume;
    }

    peerData.volume = Math.max(0.0, Math.min(2.0, volume));
    const ctx = this.getAudioContext();
    const spatialGain = peerData.spatialGain ?? 1.0;
    const effectiveGain = Math.max(0.0, Math.min(1.0, spatialGain * peerData.volume));

    try {
      peerData.gainNode.gain.setTargetAtTime(effectiveGain, ctx.currentTime, this.smoothingTimeConstant);
    } catch {
      peerData.gainNode.gain.value = effectiveGain;
    }
    peerData.lastGain = effectiveGain;
    return peerData.volume;
  }

  /**
   * Gets an individual peer's volume multiplier.
   * @param {string} peerId
   * @returns {number | null}
   */
  getPeerVolume(peerId) {
    const peerData = this.peerNodes.get(peerId);
    return peerData ? peerData.volume : null;
  }

  /**
   * Retrieves current spatial audio metrics for a peer.
   * @param {string} peerId
   * @returns {{ gain: number, spatialGain?: number, pan: number, distance: number, obstacleAttenuation?: number, volume?: number } | null}
   */
  getPeerSpatialMetrics(peerId) {
    const peerData = this.peerNodes.get(peerId);
    if (!peerData) return null;
    return {
      gain: peerData.lastGain,
      spatialGain: peerData.spatialGain,
      pan: peerData.lastPan,
      distance: peerData.lastDistance,
      obstacleAttenuation: peerData.lastObstacleAttenuation,
      volume: peerData.volume,
    };
  }

  /**
   * Removes and disconnects a peer from the audio graph.
   * Safe to call multiple times and does not affect other peers.
   * @param {string} peerId
   */
  removePeer(peerId) {
    const peerData = this.peerNodes.get(peerId);
    if (!peerData) return;

    try {
      // Immediately silence gain node to prevent clicks or stale audio buffers
      if (peerData.gainNode && peerData.gainNode.gain) {
        try {
          if (this.audioContext && typeof this.audioContext.currentTime === 'number') {
            peerData.gainNode.gain.cancelScheduledValues?.(this.audioContext.currentTime);
            peerData.gainNode.gain.setValueAtTime?.(0.0, this.audioContext.currentTime);
          } else {
            peerData.gainNode.gain.value = 0.0;
          }
        } catch {
          peerData.gainNode.gain.value = 0.0;
        }
      }

      // Stop all tracks associated with this peer stream to prevent stale audio
      if (peerData.stream) {
        try {
          peerData.stream.getTracks().forEach((track) => track.stop());
        } catch {
          // Ignore
        }
      }
      if (peerData.source && peerData.source.mediaStream) {
        try {
          peerData.source.mediaStream.getTracks().forEach((track) => track.stop());
        } catch {
          // Ignore
        }
      }

      // Disconnect audio nodes
      peerData.source?.disconnect();
      peerData.gainNode?.disconnect();
      peerData.pannerNode?.disconnect();

      // Pause and clear dummy companion audio element to release WebRTC decoders
      if (peerData.dummyAudio) {
        peerData.dummyAudio.pause();
        peerData.dummyAudio.srcObject = null;
        if (typeof peerData.dummyAudio.load === 'function') {
          peerData.dummyAudio.load();
        }
      }
    } catch (err) {
      console.warn(`[SpatialAudioGraph] Cleanup warning for peer ${peerId}:`, err);
    }

    this.peerNodes.delete(peerId);
  }

  /**
   * Completely tears down all nodes, disconnects master gain, and closes the AudioContext.
   */
  destroy() {
    for (const peerId of Array.from(this.peerNodes.keys())) {
      this.removePeer(peerId);
    }
    this.peerNodes.clear();

    if (this.masterGainNode) {
      try {
        this.masterGainNode.disconnect();
      } catch (err) {
        console.warn('[SpatialAudioGraph] Master gain disconnect warning:', err);
      }
      this.masterGainNode = null;
    }

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
