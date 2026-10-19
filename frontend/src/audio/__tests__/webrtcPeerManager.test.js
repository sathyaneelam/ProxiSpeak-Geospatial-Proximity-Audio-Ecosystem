import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { WebRTCPeerManager, getRTCConfiguration } from '../webrtcPeerManager.js';

// Minimal mock for RTCPeerConnection in Node.js test environment
class MockRTCPeerConnection {
  constructor() {
    this.connectionState = 'new';
    this.signalingState = 'stable';
    this.remoteDescription = null;
    this.localDescription = null;
    this.senders = [];
    this.onnegotiationneeded = null;
    this.onicecandidate = null;
    this.ontrack = null;
    this.onconnectionstatechange = null;
  }

  getSenders() {
    return this.senders;
  }

  addTrack(track) {
    this.senders.push({ track });
  }

  createOffer() {
    return Promise.resolve({ type: 'offer', sdp: 'mock-offer-sdp' });
  }

  createAnswer() {
    return Promise.resolve({ type: 'answer', sdp: 'mock-answer-sdp' });
  }

  setLocalDescription(desc) {
    this.localDescription = desc || { type: 'offer', sdp: 'local' };
    return Promise.resolve();
  }

  setRemoteDescription(desc) {
    this.remoteDescription = desc;
    return Promise.resolve();
  }

  addIceCandidate(cand) {
    return Promise.resolve(cand);
  }

  close() {
    this.connectionState = 'closed';
  }
}

describe('WebRTCPeerManager - Deduplication, Glare Arbitration, and Teardown', () => {
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalMediaStream = globalThis.MediaStream;
  const originalRTCSessionDescription = globalThis.RTCSessionDescription;
  const originalRTCIceCandidate = globalThis.RTCIceCandidate;

  beforeEach(() => {
    globalThis.window = globalThis;
    globalThis.RTCPeerConnection = MockRTCPeerConnection;
    globalThis.MediaStream = class {
      constructor() {
        this.tracks = [];
      }
      addTrack(t) {
        this.tracks.push(t);
      }
      getTracks() {
        return this.tracks;
      }
    };
    globalThis.RTCSessionDescription = class {
      constructor(init) {
        this.type = init.type;
        this.sdp = init.sdp;
      }
    };
    globalThis.RTCIceCandidate = class {
      constructor(init) {
        this.candidate = init.candidate;
      }
    };
  });

  afterEach(() => {
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
    globalThis.MediaStream = originalMediaStream;
    globalThis.RTCSessionDescription = originalRTCSessionDescription;
    globalThis.RTCIceCandidate = originalRTCIceCandidate;
  });

  test('isPolite deterministically evaluates local vs remote ID', () => {
    const manager = new WebRTCPeerManager({ localUserId: 'user-m' });
    // 'user-m' > 'user-a' -> true (polite)
    assert.equal(manager.isPolite('user-a'), true);
    // 'user-m' < 'user-z' -> false (impolite)
    assert.equal(manager.isPolite('user-z'), false);
  });

  test('getOrCreatePeer prevents duplicate peer connections for the same peer ID', () => {
    const manager = new WebRTCPeerManager({ localUserId: 'local-1' });

    const session1 = manager.getOrCreatePeer('remote-1');
    assert.ok(session1);
    assert.equal(manager.peers.size, 1);

    const session2 = manager.getOrCreatePeer('remote-1');
    assert.equal(session1, session2, 'Must return the existing active peer session');
    assert.equal(manager.peers.size, 1);
  });

  test('buffers ICE candidates when remote description is not set, then drains them', async () => {
    const manager = new WebRTCPeerManager({ localUserId: 'local-1' });
    const session = manager.getOrCreatePeer('remote-2');

    // Remote description is not set yet
    assert.equal(session.pc.remoteDescription, null);

    // Incoming candidate should be buffered
    await manager.handleRemoteIceCandidate('remote-2', { candidate: 'cand-1' });
    assert.equal(session.iceCandidateBuffer.length, 1);
    assert.equal(session.iceCandidateBuffer[0].candidate, 'cand-1');

    // Setting remote answer should drain the candidate buffer
    session.pc.signalingState = 'have-local-offer';
    await manager.handleRemoteAnswer('remote-2', { type: 'answer', sdp: 'ans' });

    assert.equal(session.iceCandidateBuffer.length, 0);
  });

  test('closePeer and destroy safely clean up resources', () => {
    const manager = new WebRTCPeerManager({ localUserId: 'local-1' });
    const session = manager.getOrCreatePeer('remote-3');

    assert.equal(session.pc.connectionState, 'new');

    manager.closePeer('remote-3');
    assert.equal(manager.peers.has('remote-3'), false);
    assert.equal(session.pc.connectionState, 'closed');

    manager.getOrCreatePeer('remote-4');
    manager.getOrCreatePeer('remote-5');
    assert.equal(manager.peers.size, 2);

    manager.destroy();
    assert.equal(manager.peers.size, 0);
  });

  test('getRTCConfiguration provides default STUN servers and incorporates TURN from env', () => {
    const config = getRTCConfiguration();
    assert.ok(Array.isArray(config.iceServers));
    assert.ok(config.iceServers.length >= 2);
    assert.ok(config.iceServers.some((s) => s.urls.includes('stun.l.google.com')));

    // Test with TURN env vars set
    const oldTurnUrl = process.env.VITE_TURN_URL;
    const oldTurnUser = process.env.VITE_TURN_USERNAME;
    const oldTurnCred = process.env.VITE_TURN_CREDENTIAL;

    try {
      process.env.VITE_TURN_URL = 'turn:turn.example.com:3478';
      process.env.VITE_TURN_USERNAME = 'proxi_user';
      process.env.VITE_TURN_CREDENTIAL = 'proxi_password';

      const turnConfig = getRTCConfiguration();
      const turnEntry = turnConfig.iceServers.find((s) => s.urls === 'turn:turn.example.com:3478');
      assert.ok(turnEntry);
      assert.equal(turnEntry.username, 'proxi_user');
      assert.equal(turnEntry.credential, 'proxi_password');
    } finally {
      process.env.VITE_TURN_URL = oldTurnUrl;
      process.env.VITE_TURN_USERNAME = oldTurnUser;
      process.env.VITE_TURN_CREDENTIAL = oldTurnCred;
    }
  });
});

