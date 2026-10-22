/**
 * ProxiSpeak Local Media Stream & Microphone Manager
 * Handles getUserMedia capture, permissions, hardware errors, muting, and teardown.
 * Member 4: WebRTC, Real-Time Audio & Spatial Audio
 */

/**
 * Standardized audio error representation.
 */
export class AudioDeviceError extends Error {
  /**
   * @param {string} code - Machine-readable error code
   * @param {string} message - Human-readable explanation
   * @param {string} resolution - Actionable fix instructions
   * @param {any} [originalError] - Raw underlying error
   */
  constructor(code, message, resolution, originalError = null) {
    super(message);
    this.name = 'AudioDeviceError';
    this.code = code;
    this.resolution = resolution;
    this.originalError = originalError;
  }
}

class MediaStreamManager {
  constructor() {
    /** @type {MediaStream | null} */
    this.localStream = null;
    /** @type {boolean} */
    this.isMuted = false;
  }

  /**
   * Checks whether the current runtime environment is a secure context
   * required by modern browsers for getUserMedia access.
   * @returns {{ isSecure: boolean, reason?: string }}
   */
  checkEnvironmentSecurity() {
    if (typeof window === 'undefined') {
      return { isSecure: false, reason: 'SSR / non-browser environment' };
    }

    if (window.isSecureContext === false) {
      return {
        isSecure: false,
        reason: 'Microphone access requires HTTPS or localhost (Secure Context). Current origin is not secure.',
      };
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      return {
        isSecure: false,
        reason: 'navigator.mediaDevices.getUserMedia is unavailable. Verify HTTPS or localhost.',
      };
    }

    return { isSecure: true };
  }

  /**
   * Requests microphone access and captures local audio stream.
   *
   * @param {MediaStreamConstraints} [constraints]
   * @returns {Promise<MediaStream>}
   * @throws {AudioDeviceError}
   */
  async startCapture(constraints = {}) {
    // If already active, return existing stream
    if (this.localStream && this.localStream.active) {
      const activeTrack = this.localStream.getAudioTracks().find((t) => t.readyState === 'live');
      if (activeTrack) {
        return this.localStream;
      }
    }

    const security = this.checkEnvironmentSecurity();
    if (!security.isSecure) {
      throw new AudioDeviceError(
        'INSECURE_CONTEXT',
        security.reason || 'Secure context required for microphone access.',
        'Run the application on http://localhost, http://127.0.0.1, or over HTTPS with valid certificates.'
      );
    }

    const defaultAudioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
    };

    const finalConstraints = {
      audio: typeof constraints.audio === 'object'
        ? { ...defaultAudioConstraints, ...constraints.audio }
        : (constraints.audio ?? defaultAudioConstraints),
      video: false,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(finalConstraints);
      this.localStream = stream;

      // Ensure initial mute state is applied
      if (this.isMuted) {
        this.setMuted(true);
      }

      // Handle track ending externally (e.g. user unplugs headset)
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.onended = () => {
          console.warn('[MediaStreamManager] Local audio track ended unexpectedly.');
          this.localStream = null;
        };
      }

      return stream;
    } catch (err) {
      const errorName = err?.name || '';
      const errorMessage = err?.message || 'Unknown device error';

      switch (errorName) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
          throw new AudioDeviceError(
            'PERMISSION_DENIED',
            'Microphone access was denied by the user or browser permissions policy.',
            'Click the microphone icon in your browser address bar and choose "Allow", then retry.',
            err
          );

        case 'NotFoundError':
        case 'DevicesNotFoundError':
          throw new AudioDeviceError(
            'NO_MICROPHONE_FOUND',
            'No audio input device (microphone) was detected on this system.',
            'Ensure a microphone is plugged in, recognized by the OS, and enabled in sound settings.',
            err
          );

        case 'NotReadableError':
        case 'TrackStartError':
          throw new AudioDeviceError(
            'DEVICE_IN_USE',
            'The microphone is already in use by another application or the operating system.',
            'Close other conferencing apps (Zoom, Teams, Meet) or tabs accessing the microphone, then retry.',
            err
          );

        case 'OverconstrainedError':
          throw new AudioDeviceError(
            'OVERCONSTRAINED',
            'The requested audio constraints cannot be satisfied by the available hardware.',
            'Relax specific sample rate or channel count constraints.',
            err
          );

        case 'SecurityError':
          throw new AudioDeviceError(
            'SECURITY_RESTRICTION',
            'Browser security restrictions prevented media access.',
            'Verify that microphone access is permitted by Permissions-Policy / Feature-Policy headers.',
            err
          );

        default:
          throw new AudioDeviceError(
            'DEVICE_ERROR',
            `Failed to access microphone: ${errorMessage}`,
            'Verify microphone hardware permissions and reload the page.',
            err
          );
      }
    }
  }

  /**
   * Toggles mute state of the local microphone track.
   * @param {boolean} muted
   */
  setMuted(muted) {
    this.isMuted = Boolean(muted);
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !this.isMuted;
      });
    }
  }

  /**
   * Toggles mute on/off.
   * @returns {boolean} New mute state
   */
  toggleMute() {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  /**
   * Returns the primary audio track if active.
   * @returns {MediaStreamTrack | null}
   */
  getAudioTrack() {
    if (!this.localStream) return null;
    return this.localStream.getAudioTracks()[0] || null;
  }

  /**
   * Returns the active local MediaStream.
   * @returns {MediaStream | null}
   */
  getStream() {
    return this.localStream;
  }

  /**
   * Stops all tracks and releases microphone hardware.
   */
  stopCapture() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (err) {
          void err;
        }
      });
      this.localStream = null;
    }
  }
}

export const mediaStreamManager = new MediaStreamManager();
