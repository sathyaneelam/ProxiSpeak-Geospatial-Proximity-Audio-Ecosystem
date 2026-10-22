import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mediaStreamManager, AudioDeviceError } from '../src/audio/mediaStreamManager.js';

describe('MediaStreamManager & AudioDeviceError', () => {
  it('creates AudioDeviceError with code, message, and actionable resolution', () => {
    const err = new AudioDeviceError(
      'PERMISSION_DENIED',
      'Microphone access denied.',
      'Allow microphone access in browser settings.'
    );

    assert.strictEqual(err.name, 'AudioDeviceError');
    assert.strictEqual(err.code, 'PERMISSION_DENIED');
    assert.strictEqual(err.message, 'Microphone access denied.');
    assert.strictEqual(err.resolution, 'Allow microphone access in browser settings.');
  });

  it('detects insecure context when window is not secure', () => {
    const originalWindow = globalThis.window;
    globalThis.window = { isSecureContext: false };

    const check = mediaStreamManager.checkEnvironmentSecurity();
    assert.strictEqual(check.isSecure, false);
    assert.ok(check.reason.includes('HTTPS or localhost'));

    globalThis.window = originalWindow;
  });

  it('manages mute and unmute state correctly', () => {
    let track1Enabled = true;
    let track2Enabled = true;

    // Attach mock local stream
    mediaStreamManager.localStream = {
      active: true,
      getAudioTracks: () => [
        {
          get enabled() { return track1Enabled; },
          set enabled(v) { track1Enabled = v; },
        },
        {
          get enabled() { return track2Enabled; },
          set enabled(v) { track2Enabled = v; },
        },
      ],
      getTracks: () => [],
    };

    // Initial state
    mediaStreamManager.setMuted(false);
    assert.strictEqual(mediaStreamManager.isMuted, false);
    assert.strictEqual(track1Enabled, true);

    // Mute
    mediaStreamManager.setMuted(true);
    assert.strictEqual(mediaStreamManager.isMuted, true);
    assert.strictEqual(track1Enabled, false);
    assert.strictEqual(track2Enabled, false);

    // Toggle back
    const toggled = mediaStreamManager.toggleMute();
    assert.strictEqual(toggled, false);
    assert.strictEqual(mediaStreamManager.isMuted, false);
    assert.strictEqual(track1Enabled, true);
  });

  it('stops all tracks and releases stream on stopCapture()', () => {
    let stoppedTrackCount = 0;

    mediaStreamManager.localStream = {
      getTracks: () => [
        { stop: () => { stoppedTrackCount++; } },
        { stop: () => { stoppedTrackCount++; } },
      ],
    };

    assert.ok(mediaStreamManager.localStream !== null);
    mediaStreamManager.stopCapture();

    assert.strictEqual(stoppedTrackCount, 2);
    assert.strictEqual(mediaStreamManager.localStream, null);
  });
});
