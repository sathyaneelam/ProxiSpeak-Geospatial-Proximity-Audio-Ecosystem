/**
 * ProxiSpeak MediaStream Manager
 * 
 * Manages local microphone acquisition, permission states, device errors,
 * track muting/unmuting, and resource cleanup.
 */

export class MediaStreamManager {
  constructor() {
    this.stream = null;
    this.isMuted = false;
    this.listeners = new Set();
  }

  /**
   * Registers a listener for state changes (e.g., mute toggle, stream stopped).
   * @param {Function} listener
   * @returns {Function} Unsubscribe function
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener({
          hasStream: Boolean(this.stream),
          isMuted: this.isMuted,
          tracksActive: this.getAudioTracks().filter((t) => t.readyState === 'live').length,
        });
      } catch (err) {
        console.error('[MediaStreamManager] Listener error:', err);
      }
    }
  }

  /**
   * Checks whether the current browsing context is secure for getUserMedia.
   * Browsers restrict getUserMedia to HTTPS or localhost.
   */
  static isContextSecure() {
    if (typeof window === 'undefined') return false;
    if (window.isSecureContext !== undefined) return window.isSecureContext;
    return (
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    );
  }

  /**
   * Requests local audio stream with standard echo cancellation and noise suppression.
   * @param {MediaTrackConstraints} [customConstraints]
   * @returns {Promise<MediaStream>}
   */
  async acquireAudioStream(customConstraints = {}) {
    if (!MediaStreamManager.isContextSecure()) {
      const err = new Error(
        'Insecure context: Microphone access requires HTTPS or http://localhost.'
      );
      err.name = 'SecurityError';
      throw err;
    }

    if (!navigator?.mediaDevices?.getUserMedia) {
      const err = new Error(
        'getUserMedia is not supported in this browser environment.'
      );
      err.name = 'NotSupportedError';
      throw err;
    }

    // Stop existing stream if one is already active before re-acquiring
    this.stopStream();

    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...customConstraints,
      },
      video: false,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.stream = stream;
      this.isMuted = false;

      // Handle external track ending (e.g., unplugged headset)
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          this.notify();
        };
      });

      this.notify();
      return stream;
    } catch (error) {
      const parsedError = MediaStreamManager.parseMediaError(error);
      throw parsedError;
    }
  }

  /**
   * Translates DOMExceptions into user-friendly diagnostic messages.
   * @param {Error} error
   * @returns {Error}
   */
  static parseMediaError(error) {
    let message;

    switch (error.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        message = 'Microphone permission was denied. Please allow microphone access in your browser address bar.';
        break;
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        message = 'No microphone device was detected. Please connect an audio input device.';
        break;
      case 'NotReadableError':
      case 'TrackStartError':
        message = 'Microphone is currently in use by another application or OS permissions blocked access.';
        break;
      case 'OverconstrainedError':
        message = 'Requested audio constraints could not be satisfied by available hardware.';
        break;
      case 'SecurityError':
        message = 'Microphone access is blocked in insecure non-HTTPS/non-localhost contexts.';
        break;
      default:
        message = `Microphone capture failed: ${error.message || 'Unknown error'}`;
    }

    const enhanced = new Error(message);
    enhanced.name = error.name;
    enhanced.originalError = error;
    return enhanced;
  }

  /**
   * Returns current audio tracks.
   * @returns {MediaStreamTrack[]}
   */
  getAudioTracks() {
    return this.stream ? this.stream.getAudioTracks() : [];
  }

  /**
   * Mutes all audio tracks.
   */
  mute() {
    if (!this.stream) return;
    this.stream.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    this.isMuted = true;
    this.notify();
  }

  /**
   * Unmutes all audio tracks.
   */
  unmute() {
    if (!this.stream) return;
    this.stream.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });
    this.isMuted = false;
    this.notify();
  }

  /**
   * Toggles mute state.
   * @returns {boolean} New muted state
   */
  toggleMute() {
    if (this.isMuted) {
      this.unmute();
    } else {
      this.mute();
    }
    return this.isMuted;
  }

  /**
   * Stops all tracks, releases microphone hardware, and resets internal state.
   */
  stopStream() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        track.stop();
        track.onended = null;
      });
      this.stream = null;
    }
    this.isMuted = false;
    this.notify();
  }
}
