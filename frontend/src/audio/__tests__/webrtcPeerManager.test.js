import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RTC_CONFIG,
  getRTCConfiguration,
  WebRTCPeerManager,
} from '../webrtcPeerManager.js';

const rtcEnvironmentKeys = [
  'VITE_STUN_URL',
  'STUN_URL',
  'VITE_TURN_URL',
  'TURN_URL',
  'VITE_TURN_USERNAME',
  'TURN_USERNAME',
  'VITE_TURN_CREDENTIAL',
  'TURN_CREDENTIAL',
  'VITE_TURN_PASSWORD',
  'TURN_PASSWORD',
];

const withRtcEnvironment = (values, callback) => {
  const previousValues = new Map(
    rtcEnvironmentKeys.map((key) => [key, globalThis.process.env[key]])
  );

  try {
    for (const key of rtcEnvironmentKeys) {
      if (values[key] === undefined) {
        delete globalThis.process.env[key];
      } else {
        globalThis.process.env[key] = values[key];
      }
    }
    callback();
  } finally {
    for (const [key, value] of previousValues) {
      if (value === undefined) {
        delete globalThis.process.env[key];
      } else {
        globalThis.process.env[key] = value;
      }
    }
  }
};

const waitFor = async (predicate, timeout = 500) => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeout) {
      throw new Error('Timed out waiting for the expected peer state');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

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
    this.addedIceCandidates = [];
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
    this.signalingState =
      this.localDescription.type === 'offer' ? 'have-local-offer' : 'stable';
    return Promise.resolve();
  }

  setRemoteDescription(desc) {
    this.remoteDescription = desc;
    this.signalingState =
      desc.type === 'offer' ? 'have-remote-offer' : 'stable';
    return Promise.resolve();
  }

  addIceCandidate(cand) {
    this.addedIceCandidates.push(cand);
    return Promise.resolve(cand);
  }

  close() {
    this.connectionState = 'closed';
  }
}

class MockSignalingTransport {
  constructor(userId) {
    this.userId = userId;
    this.listeners = new Map();
    this.sentOffers = [];
    this.sentAnswers = [];
    this.peer = null;
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  emit(event, payload) {
    for (const handler of this.listeners.get(event) || []) handler(payload);
  }

  sendOffer(payload) {
    this.sentOffers.push(payload);
    this.peer?.emit('webrtc:offer', {
      fromUserId: this.userId,
      sdp: payload.sdp,
    });
  }

  sendAnswer(payload) {
    this.sentAnswers.push(payload);
    this.peer?.emit('webrtc:answer', {
      fromUserId: this.userId,
      sdp: payload.sdp,
    });
  }

  sendIceCandidate(payload) {
    this.peer?.emit('webrtc:ice-candidate', {
      fromUserId: this.userId,
      candidate: payload.candidate,
    });
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

  test('uses VITE STUN and TURN settings, including comma-separated URLs', () => {
    withRtcEnvironment({
      VITE_STUN_URL: 'stun:primary.example, stun:secondary.example',
      STUN_URL: 'stun:fallback.example',
      VITE_TURN_URL: 'turn:relay.example, turns:relay.example',
      TURN_URL: 'turn:fallback.example',
      VITE_TURN_USERNAME: 'vite-user',
      TURN_USERNAME: 'fallback-user',
      VITE_TURN_CREDENTIAL: 'vite-secret',
      TURN_CREDENTIAL: 'fallback-secret',
    }, () => {
      assert.deepEqual(getRTCConfiguration().iceServers, [
        { urls: 'stun:primary.example' },
        { urls: 'stun:secondary.example' },
        {
          urls: ['turn:relay.example', 'turns:relay.example'],
          username: 'vite-user',
          credential: 'vite-secret',
        },
      ]);
    });
  });

  test('supports fallback STUN/TURN environment variables and TURN password names', () => {
    withRtcEnvironment({
      STUN_URL: 'stun:fallback.example',
      TURN_URL: 'turn:fallback.example',
      TURN_USERNAME: 'fallback-user',
      TURN_PASSWORD: 'fallback-password',
    }, () => {
      assert.deepEqual(getRTCConfiguration().iceServers, [
        { urls: 'stun:fallback.example' },
        {
          urls: 'turn:fallback.example',
          username: 'fallback-user',
          credential: 'fallback-password',
        },
      ]);
    });
  });

  test('merges custom RTC overrides and constructor configuration', () => {
    withRtcEnvironment({}, () => {
      const customIceServers = [{ urls: 'turn:custom.example' }];
      const customConfig = {
        iceServers: customIceServers,
        iceCandidatePoolSize: 0,
        bundlePolicy: 'max-bundle',
      };
      const resolvedConfig = getRTCConfiguration(customConfig);
      const manager = new WebRTCPeerManager({ rtcConfig: customConfig });

      assert.equal(DEFAULT_RTC_CONFIG.iceCandidatePoolSize, 2);
      assert.equal(resolvedConfig.iceServers, customIceServers);
      assert.equal(resolvedConfig.iceCandidatePoolSize, 0);
      assert.equal(resolvedConfig.bundlePolicy, 'max-bundle');
      assert.deepEqual(manager.rtcConfig, resolvedConfig);
    });
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

  test('exchanges offer, answer, and ICE candidates between two peer managers', async () => {
    const aliceTransport = new MockSignalingTransport('alice');
    const bobTransport = new MockSignalingTransport('bob');
    aliceTransport.peer = bobTransport;
    bobTransport.peer = aliceTransport;
    const alice = new WebRTCPeerManager({
      localUserId: 'alice',
      signalingTransport: aliceTransport,
    });
    const bob = new WebRTCPeerManager({
      localUserId: 'bob',
      signalingTransport: bobTransport,
    });

    try {
      await alice.initiateConnection('bob');
      await waitFor(() => alice.peers.get('bob')?.pc.remoteDescription?.type === 'answer');

      assert.equal(aliceTransport.sentOffers.length, 1);
      assert.equal(bobTransport.sentAnswers.length, 1);
      assert.equal(bob.peers.get('alice').pc.remoteDescription.type, 'offer');
      assert.equal(alice.peers.get('bob').pc.remoteDescription.type, 'answer');

      alice.peers.get('bob').pc.onicecandidate({
        candidate: { candidate: 'candidate:alice' },
      });
      await waitFor(() => bob.peers.get('alice').pc.addedIceCandidates.length === 1);
      assert.equal(
        bob.peers.get('alice').pc.addedIceCandidates[0].candidate,
        'candidate:alice'
      );
    } finally {
      alice.destroy();
      bob.destroy();
    }
  });

  test('discovers peers from signaling and negotiates only within earshot', async () => {
    const transport = new MockSignalingTransport('local');
    const manager = new WebRTCPeerManager({
      localUserId: 'local',
      officeId: 'office-1',
      localPosition: { x: 0, y: 0 },
      earshotRadius: 100,
      signalingTransport: transport,
    });

    try {
      transport.emit('voice:user-joined', {
        userId: 'near-peer',
        officeId: 'office-1',
        position: { x: 40, y: 0 },
      });
      transport.emit('voice:user-joined', {
        userId: 'far-peer',
        officeId: 'office-1',
        position: { x: 300, y: 0 },
      });
      await waitFor(() => transport.sentOffers.length === 1);

      assert.ok(manager.peers.has('near-peer'));
      assert.equal(manager.peers.has('far-peer'), false);

      transport.emit('proximity:position-update', {
        userId: 'far-peer',
        officeId: 'office-1',
        position: { x: 50, y: 0 },
      });
      await waitFor(() => transport.sentOffers.length === 2);
      assert.ok(manager.peers.has('far-peer'));

      transport.emit('voice:user-left', { userId: 'near-peer' });
      assert.equal(manager.peers.has('near-peer'), false);
      assert.equal(manager.getPeerPosition('near-peer'), null);
    } finally {
      manager.destroy();
    }

    for (const listeners of transport.listeners.values()) {
      assert.equal(listeners.size, 0);
    }
  });

  test('reports WebRTC connection-state changes for the peer', () => {
    const reportedStates = [];
    const manager = new WebRTCPeerManager({
      localUserId: 'local-1',
      onPeerConnectionState: (peerId, state) => reportedStates.push({ peerId, state }),
    });
    const session = manager.getOrCreatePeer('remote-1');

    session.pc.connectionState = 'connected';
    session.pc.onconnectionstatechange();

    assert.deepEqual(reportedStates, [{ peerId: 'remote-1', state: 'connected' }]);
  });

  test('retries failed peers with one bounded reconnection attempt', async () => {
    const manager = new WebRTCPeerManager({
      localUserId: 'local-1',
      reconnectDelays: [5],
    });
    const originalSession = manager.getOrCreatePeer('remote-retry');

    try {
      originalSession.pc.connectionState = 'failed';
      originalSession.pc.onconnectionstatechange();
      originalSession.pc.onconnectionstatechange();
      assert.equal(manager.peers.get('remote-retry'), originalSession);

      await waitFor(() => manager.peers.get('remote-retry') !== originalSession);

      const retriedSession = manager.peers.get('remote-retry');
      assert.ok(retriedSession);
      assert.notEqual(retriedSession, originalSession);
      assert.equal(originalSession.pc.connectionState, 'closed');

      retriedSession.pc.connectionState = 'failed';
      retriedSession.pc.onconnectionstatechange();
      await waitFor(() => !manager.peers.has('remote-retry'));

      assert.equal(manager.peers.has('remote-retry'), false, 'Retries stop after the configured limit');
    } finally {
      manager.destroy();
    }
  });

  test('waits through brief disconnects and retries only after the grace period', async () => {
    const manager = new WebRTCPeerManager({
      localUserId: 'local-1',
      reconnectDelays: [5],
      disconnectGracePeriod: 30,
    });
    const originalSession = manager.getOrCreatePeer('remote-disconnect');

    try {
      originalSession.pc.connectionState = 'disconnected';
      originalSession.pc.onconnectionstatechange();
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(manager.peers.get('remote-disconnect'), originalSession);

      originalSession.pc.connectionState = 'connected';
      originalSession.pc.onconnectionstatechange();
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(manager.peers.get('remote-disconnect'), originalSession);

      originalSession.pc.connectionState = 'disconnected';
      originalSession.pc.onconnectionstatechange();
      await waitFor(() => manager.peers.get('remote-disconnect') !== originalSession);
      assert.notEqual(manager.peers.get('remote-disconnect'), originalSession);
    } finally {
      manager.destroy();
    }
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
});
