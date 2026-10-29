import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { WebRTCPeerManager, getRTCConfiguration } from '../webrtcPeerManager.js';

// Minimal mock for RTCPeerConnection in Node.js test environment
class MockRTCPeerConnection {
  constructor() {
    this.connectionState = 'new';
    this.iceConnectionState = 'new';
    this.signalingState = 'stable';
    this.remoteDescription = null;
    this.localDescription = null;
    this.senders = [];
    this.onnegotiationneeded = null;
    this.onicecandidate = null;
    this.ontrack = null;
    this.onconnectionstatechange = null;
    this.oniceconnectionstatechange = null;
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
      removeTrack(t) {
        this.tracks = this.tracks.filter((track) => track !== t);
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

  test('closePeer clears pending ICE candidates and stops remote stream tracks', async () => {
    const removedPeers = [];
    const mockSpatialAudioGraph = {
      removed: [],
      removePeer(id) {
        this.removed.push(id);
      },
    };

    const manager = new WebRTCPeerManager({
      localUserId: 'local-clean',
      spatialAudioGraph: mockSpatialAudioGraph,
      onPeerRemoved: (id) => removedPeers.push(id),
    });

    const session = manager.getOrCreatePeer('remote-clean');

    // Add a remote track
    let trackStopped = false;
    const track = {
      kind: 'audio',
      stop() {
        trackStopped = true;
      },
    };
    session.remoteStream.addTrack(track);

    // Buffer an ICE candidate
    await manager.handleRemoteIceCandidate('remote-clean', { candidate: 'cand-buffered' });
    assert.equal(session.iceCandidateBuffer.length, 1);

    // Close peer
    manager.closePeer('remote-clean');

    // Verify PC is closed
    assert.equal(session.pc.connectionState, 'closed');
    // Verify candidate buffer is cleared
    assert.equal(session.iceCandidateBuffer.length, 0);
    // Verify track stopped and removed from stream
    assert.equal(trackStopped, true);
    assert.equal(session.remoteStream.getTracks().length, 0);
    // Verify spatial audio graph and callback notified
    assert.deepEqual(mockSpatialAudioGraph.removed, ['remote-clean']);
    assert.deepEqual(removedPeers, ['remote-clean']);
    // Verify removed from map
    assert.equal(manager.peers.has('remote-clean'), false);
  });

  test('closePeer is safe to call multiple times (idempotent)', () => {
    let removeCount = 0;
    const manager = new WebRTCPeerManager({
      localUserId: 'local-idem',
      onPeerRemoved: () => {
        removeCount += 1;
      },
    });

    manager.getOrCreatePeer('remote-idem');
    assert.equal(manager.peers.has('remote-idem'), true);

    // First close
    manager.closePeer('remote-idem');
    assert.equal(removeCount, 1);
    assert.equal(manager.peers.has('remote-idem'), false);

    // Second close should be safe no-op
    assert.doesNotThrow(() => {
      manager.closePeer('remote-idem');
    });
    assert.equal(removeCount, 1);

    // Closing non-existent peer is safe no-op
    assert.doesNotThrow(() => {
      manager.closePeer('non-existent');
    });
    assert.equal(removeCount, 1);
  });

  test('closePeer does not affect other active peers (peer isolation)', () => {
    const manager = new WebRTCPeerManager({ localUserId: 'local-iso' });
    const sessionA = manager.getOrCreatePeer('peer-A');
    const sessionB = manager.getOrCreatePeer('peer-B');

    assert.equal(manager.peers.size, 2);

    manager.closePeer('peer-A');
    assert.equal(manager.peers.has('peer-A'), false);
    assert.equal(sessionA.pc.connectionState, 'closed');

    // Peer B remains alive and untouched
    assert.equal(manager.peers.has('peer-B'), true);
    assert.equal(sessionB.pc.connectionState, 'new');
    assert.equal(manager.peers.size, 1);

    manager.destroy();
  });

  test('pc.onconnectionstatechange triggers closePeer on disconnected state', () => {
    const manager = new WebRTCPeerManager({ localUserId: 'local-disc' });
    const session = manager.getOrCreatePeer('peer-disc');

    assert.equal(manager.peers.has('peer-disc'), true);

    // Simulate connectionState transitioning to 'disconnected'
    session.pc.connectionState = 'disconnected';
    session.pc.onconnectionstatechange();

    // Verify peer was automatically closed and removed
    assert.equal(manager.peers.has('peer-disc'), false);
    assert.equal(session.pc.connectionState, 'closed');
  });

  test('getOrCreatePeer replaces a stale or disconnected peer connection', () => {
    const manager = new WebRTCPeerManager({ localUserId: 'local-reconnect' });
    const sessionOld = manager.getOrCreatePeer('peer-reconnect');

    // Simulate stale disconnected state
    sessionOld.pc.connectionState = 'disconnected';

    // Calling getOrCreatePeer should evict the stale session and create a fresh one
    const sessionNew = manager.getOrCreatePeer('peer-reconnect');
    assert.notEqual(sessionOld, sessionNew);
    assert.equal(sessionOld.pc.connectionState, 'closed');
    assert.equal(sessionNew.pc.connectionState, 'new');
    assert.equal(manager.peers.get('peer-reconnect'), sessionNew);
  });

  test('handleRemoteIceCandidate drops candidates safely if connection is closed or disconnected', async () => {
    const manager = new WebRTCPeerManager({ localUserId: 'local-ice' });
    const session = manager.getOrCreatePeer('peer-ice');

    session.pc.connectionState = 'closed';

    await assert.doesNotReject(async () => {
      await manager.handleRemoteIceCandidate('peer-ice', { candidate: 'candidate:foo' });
    });
    assert.equal(session.iceCandidateBuffer.length, 0);
  });

  test('signaling event webrtc:peer-disconnect closes peer cleanly', () => {
    const listeners = new Map();
    const mockTransport = {
      on(event, handler) {
        listeners.set(event, handler);
        return () => listeners.delete(event);
      },
    };

    const manager = new WebRTCPeerManager({
      localUserId: 'local-sig',
      signalingTransport: mockTransport,
    });

    const session = manager.getOrCreatePeer('remote-sig');
    assert.equal(manager.peers.has('remote-sig'), true);

    // Fire webrtc:peer-disconnect event
    const disconnectHandler = listeners.get('webrtc:peer-disconnect');
    assert.ok(disconnectHandler);
    disconnectHandler({ peerId: 'remote-sig' });

    assert.equal(manager.peers.has('remote-sig'), false);
    assert.equal(session.pc.connectionState, 'closed');
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

