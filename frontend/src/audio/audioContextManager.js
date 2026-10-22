/**
 * ProxiSpeak AudioContext Manager
 * Handles AudioContext lifecycle, browser autoplay policy, and Web Audio node graphs.
 * Member 4: WebRTC, Real-Time Audio & Spatial Audio
 */

class AudioContextManager {
  constructor() {
    /** @type {AudioContext | null} */
    this.context = null;
    /** @type {Set<(state: AudioContextState) => void>} */
    this.stateListeners = new Set();
  }

  /**
   * Initializes or retrieves the singleton AudioContext instance.
   * @returns {AudioContext}
   */
  getOrCreateContext() {
    if (!this.context || this.context.state === 'closed') {
      const AudioContextClass =
        window.AudioContext ||
        window.webkitAudioContext;

      if (!AudioContextClass) {
        throw new Error('Web Audio API is not supported in this browser environment.');
      }

      this.context = new AudioContextClass();

      // Listen for state transitions (e.g., suspended -> running)
      this.context.onstatechange = () => {
        if (this.context) {
          this._notifyStateChange(this.context.state);
        }
      };
    }

    return this.context;
  }

  /**
   * Current AudioContext state: 'suspended', 'running', or 'closed'.
   * @returns {AudioContextState | 'uninitialized'}
   */
  getState() {
    return this.context ? this.context.state : 'uninitialized';
  }

  /**
   * Resumes the AudioContext on user interaction to comply with browser autoplay restrictions.
   * @returns {Promise<boolean>} True if running, false if failed
   */
  async resumeAudioContext() {
    try {
      const ctx = this.getOrCreateContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      this._notifyStateChange(ctx.state);
      return ctx.state === 'running';
    } catch (err) {
      console.warn('[AudioContextManager] Failed to resume AudioContext:', err);
      return false;
    }
  }

  /**
   * Subscribes to AudioContext state changes.
   * @param {(state: AudioContextState) => void} callback
   * @returns {() => void} Unsubscribe function
   */
  onStateChange(callback) {
    this.stateListeners.add(callback);
    if (this.context) {
      callback(this.context.state);
    }
    return () => {
      this.stateListeners.delete(callback);
    };
  }

  _notifyStateChange(state) {
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('[AudioContextManager] Listener error:', err);
      }
    }
  }

  /**
   * Creates a GainNode with initial gain value.
   * @param {number} [initialGain=1.0]
   * @returns {GainNode}
   */
  createGainNode(initialGain = 1.0) {
    const ctx = this.getOrCreateContext();
    const gainNode = ctx.createGain();
    gainNode.gain.value = Math.max(0, Math.min(1, initialGain));
    return gainNode;
  }

  /**
   * Creates a StereoPannerNode, falling back gracefully if not supported.
   * @param {number} [initialPan=0.0]
   * @returns {{ node: StereoPannerNode | PannerNode | GainNode, isStereoPanner: boolean }}
   */
  createPannerNode(initialPan = 0.0) {
    const ctx = this.getOrCreateContext();
    const panValue = Math.max(-1, Math.min(1, initialPan));

    if (typeof ctx.createStereoPanner === 'function') {
      const pannerNode = ctx.createStereoPanner();
      pannerNode.pan.value = panValue;
      return { node: pannerNode, isStereoPanner: true };
    }

    // Graceful fallback for environments lacking StereoPannerNode (e.g. older Safari or test mocks)
    if (typeof ctx.createPanner === 'function') {
      const panner3D = ctx.createPanner();
      panner3D.panningModel = 'equalpower';
      panner3D.distanceModel = 'inverse';
      if (typeof panner3D.setPosition === 'function') {
        panner3D.setPosition(panValue, 0, 1 - Math.abs(panValue));
      }
      return { node: panner3D, isStereoPanner: false };
    }

    // Pass-through fallback
    const passThrough = ctx.createGain();
    return { node: passThrough, isStereoPanner: false };
  }

  /**
   * Connects a MediaStream to spatial audio processing chain.
   * Graph: MediaStreamAudioSourceNode -> GainNode -> StereoPannerNode -> AudioContext.destination
   *
   * @param {MediaStream} mediaStream
   * @param {number} [initialGain=1.0]
   * @param {number} [initialPan=0.0]
   * @returns {{
   *   sourceNode: MediaStreamAudioSourceNode,
   *   gainNode: GainNode,
   *   pannerNode: StereoPannerNode | PannerNode | GainNode,
   *   isStereoPanner: boolean,
   *   disconnect: () => void
   * }}
   */
  createSpatialPipeline(mediaStream, initialGain = 1.0, initialPan = 0.0) {
    const ctx = this.getOrCreateContext();
    const sourceNode = ctx.createMediaStreamSource(mediaStream);
    const gainNode = this.createGainNode(initialGain);
    const { node: pannerNode, isStereoPanner } = this.createPannerNode(initialPan);

    // Audio Graph Routing: Source -> Gain -> Panner -> Destination
    sourceNode.connect(gainNode);
    gainNode.connect(pannerNode);
    pannerNode.connect(ctx.destination);

    const disconnect = () => {
      try {
        sourceNode.disconnect();
      } catch (err) {
        void err;
      }
      try {
        gainNode.disconnect();
      } catch (err) {
        void err;
      }
      try {
        pannerNode.disconnect();
      } catch (err) {
        void err;
      }
    };

    return {
      sourceNode,
      gainNode,
      pannerNode,
      isStereoPanner,
      disconnect,
    };
  }

  /**
   * Disposes the AudioContext and clears listeners.
   */
  async close() {
    this.stateListeners.clear();
    if (this.context && this.context.state !== 'closed') {
      try {
        await this.context.close();
      } catch (err) {
        console.warn('[AudioContextManager] Error closing context:', err);
      }
    }
    this.context = null;
  }
}

export const audioContextManager = new AudioContextManager();
