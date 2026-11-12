import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MediaStreamManager } from '../mediaStreamManager.js';

describe('MediaStreamManager - Capture, Controls, and Error Parsing', () => {
  test('parseMediaError provides descriptive messages for all DOMException error names', () => {
    const notAllowed = MediaStreamManager.parseMediaError({ name: 'NotAllowedError', message: '' });
    assert.match(notAllowed.message, /permission was denied/i);

    const notFound = MediaStreamManager.parseMediaError({ name: 'NotFoundError', message: '' });
    assert.match(notFound.message, /no microphone device was detected/i);

    const notReadable = MediaStreamManager.parseMediaError({ name: 'NotReadableError', message: '' });
    assert.match(notReadable.message, /in use by another application/i);

    const overconstrained = MediaStreamManager.parseMediaError({ name: 'OverconstrainedError', message: '' });
    assert.match(overconstrained.message, /audio constraints could not be satisfied/i);

    const security = MediaStreamManager.parseMediaError({ name: 'SecurityError', message: '' });
    assert.match(security.message, /HTTPS.*localhost/i);
  });

  test('mute, unmute, and toggleMute alter audio track enabled states', () => {
    const manager = new MediaStreamManager();

    const mockTrack = {
      enabled: true,
      readyState: 'live',
      stop() {
        this.readyState = 'ended';
      },
    };

    manager.stream = {
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack],
    };

    assert.equal(manager.isMuted, false);
    assert.equal(mockTrack.enabled, true);

    manager.mute();
    assert.equal(manager.isMuted, true);
    assert.equal(mockTrack.enabled, false);

    manager.unmute();
    assert.equal(manager.isMuted, false);
    assert.equal(mockTrack.enabled, true);

    manager.toggleMute();
    assert.equal(manager.isMuted, true);
    assert.equal(mockTrack.enabled, false);
  });

  test('stopStream stops all tracks and clears the stream instance', () => {
    const manager = new MediaStreamManager();
    let stopped = false;

    const mockTrack = {
      enabled: true,
      readyState: 'live',
      stop() {
        stopped = true;
        this.readyState = 'ended';
      },
      onended: null,
    };

    manager.stream = {
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack],
    };

    manager.stopStream();
    assert.equal(stopped, true);
    assert.equal(manager.stream, null);
    assert.equal(manager.isMuted, false);
  });
});
