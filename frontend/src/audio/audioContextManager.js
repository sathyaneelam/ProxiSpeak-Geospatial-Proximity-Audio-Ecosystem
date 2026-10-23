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
        throw new Error(
          'Web Audio API is not supported in this browser environment.'
        );
      }

      this.context = new AudioContextClass();

      // Listen for state transitions.
      this.context.onstatechange = () => {
        if (this.context) {
          this._notifyStateChange(this.context.state);
        }
      };
    }

    return this.context;
  }

  /**
   * Returns the current AudioContext state.
   * @returns {AudioContextState | 'uninitialized'}
   */
  getState() {
    return this.context ? this.context.state : 'uninitialized';
  }

  /**
   * Resumes AudioContext to comply with browser autoplay restrictions.
   * Call this in response to a user interaction when required.
   * @returns {Promise<boolean>}
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
      console.warn(
        '[AudioContextManager] Failed to resume AudioContext:',
        err
      );
      return false;
    }
  }

  /**
   * Subscribes to AudioContext state changes.
   * @param {(state: AudioContextState) => void} callback
   * @returns {() => void}
   */
  onStateChange(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('A state change callback must be a function.');
    }

    this.stateListeners.add(callback);

    if (this.context) {
      callback(this.context.state);
    }

    return () => {
      this.stateListeners.delete(callback);
    };
  }

  /**
   * Notifies listeners of AudioContext state changes.
   * @param {AudioContextState | 'uninitialized'} state
   */
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
   * Creates a GainNode with an initial gain value.
   * @param {number} [initialGain=1.0]
   * @returns {GainNode}
   */
  createGainNode(initialGain = 1.0) {
    if (!Number.isFinite(initialGain)) {
      throw new TypeError('Initial gain must be a finite number.');
    }

    const ctx = this.getOrCreateContext();
    const gainNode = ctx.createGain();

    gainNode.gain.value = Math.max(0, Math.min(1, initialGain));

    return gainNode;
  }

  /**
   * Creates a StereoPannerNode with a compatible fallback.
   * @param {number} [initialPan=0.0]
   * @returns {{
   *   node: StereoPannerNode | PannerNode | GainNode,
   *   isStereoPanner: boolean
   * }}
   */
  createPannerNode(initialPan = 0.0) {
    if (!Number.isFinite(initialPan)) {
      throw new TypeError('Initial pan must be a finite number.');
    }

    const ctx = this.getOrCreateContext();
    const panValue = Math.max(-1, Math.min(1, initialPan));

    if (typeof ctx.createStereoPanner === 'function') {
      const pannerNode = ctx.createStereoPanner();
      pannerNode.pan.value = panValue;

      return {
        node: pannerNode,
        isStereoPanner: true,
      };
    }

    // Fallback for browsers without StereoPannerNode.
    if (typeof ctx.createPanner === 'function') {
      const panner3D = ctx.createPanner();

      panner3D.panningModel = 'equalpower';
      panner3D.distanceModel = 'inverse';

      if (typeof panner3D.setPosition === 'function') {
        panner3D.setPosition(
          panValue,
          0,
          1 - Math.abs(panValue)
        );
      }

      return {
        node: panner3D,
        isStereoPanner: false,
      };
    }

    // Pass-through fallback.
    return {
      node: ctx.createGain(),
      isStereoPanner: false,
    };
  }

  /**
   * Creates a spatial audio pipeline.
   * Graph: MediaStream source -> GainNode -> PannerNode -> destination
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
    if (!mediaStream) {
      throw new TypeError('A MediaStream is required.');
    }

    const ctx = this.getOrCreateContext();
    const sourceNode = ctx.createMediaStreamSource(mediaStream);
    const gainNode = this.createGainNode(initialGain);
    const { node: pannerNode, isStereoPanner } =
      this.createPannerNode(initialPan);

    sourceNode.connect(gainNode);
    gainNode.connect(pannerNode);
    pannerNode.connect(ctx.destination);

    let disconnected = false;

    const disconnect = () => {
      if (disconnected) {
        return;
      }

      disconnected = true;

      for (const node of [sourceNode, gainNode, pannerNode]) {
        try {
          node.disconnect();
        } catch {
          // Ignore nodes that are already disconnected.
        }
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
   * Smoothly updates a GainNode's volume.
   * Useful for proximity-based audio volume changes.
   *
   * @param {GainNode} gainNode
   * @param {number} targetGain Volume between 0 and 1
   * @param {number} [duration=0.05] Transition duration in seconds
   */
  setGainSmoothly(gainNode, targetGain, duration = 0.05) {
    if (!gainNode || !gainNode.gain || !gainNode.context) {
      throw new TypeError('A valid GainNode is required.');
    }

    const volume = Number(targetGain);
    const transition = Number(duration);

    if (!Number.isFinite(volume) || !Number.isFinite(transition)) {
      throw new TypeError('Volume and duration must be finite numbers.');
    }

    const safeVolume = Math.max(0, Math.min(1, volume));
    const safeDuration = Math.max(0, transition);
    const parameter = gainNode.gain;
    const now = gainNode.context.currentTime;

    parameter.cancelScheduledValues(now);

    if (safeDuration === 0) {
      parameter.setValueAtTime(safeVolume, now);
      return;
    }

    parameter.setTargetAtTime(
      safeVolume,
      now,
      Math.max(0.001, safeDuration / 3)
    );
  }

  /**
   * Disposes the AudioContext and clears listeners.
   */
  async close() {
    this.stateListeners.clear();

    const ctx = this.context;
    this.context = null;

    if (ctx && ctx.state !== 'closed') {
      ctx.onstatechange = null;

      try {
        await ctx.close();
      } catch (err) {
        console.warn(
          '[AudioContextManager] Error closing context:',
          err
        );
      }
    }
  }
}

export const audioContextManager = new AudioContextManager();