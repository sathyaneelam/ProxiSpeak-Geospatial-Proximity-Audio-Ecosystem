import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { PeerConnectionManager } from '../src/audio/peerConnectionManager.js';

// Minimal RTCPeerConnection mock for Node.js test environment
class MockRTCPeerConnection {
  constructor(config) {
    this.config = config;
    this.signalingState = 'stable';
    this.connectionState = 'new';
    this.localDescription = null;
    this.remoteDescription = null;
    this.senders = [];
    this.isClosed = false;

    this.onicecandidate = null;
    this.onconnectionstatechange = null;
    this.ontrack = null;
    this.onnegotiationneeded = null;
  }

  addTrack(track, stream) {
    const sender = { track, stream, replaceTrack: async (t) => { this.track = t; } };
    this.senders.push(sender);
    return sender;
  }

  getSenders() {
    return this.senders;
  }

  async createOffer() {
    return { type: 'offer', sdp: 'mock-offer-sdp' };
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'mock-answer-sdp' };
  }

  async setLocalDescription(desc) {
    this.localDescription = desc;
    if (desc.type === 'offer') {
      this.signalingState = 'have-local-offer';
    } else if (desc.type === 'answer') {
      this.signalingState = 'stable';
    } else if (desc.type === 'rollback') {
      this.signalingState = 'stable';
    }
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
    if (desc.type === 'offer') {
      this.signalingState = 'have-remote-offer';
    } else if (desc.type === 'answer') {
      this.signalingState = 'stable';
    }
  }

  async addIceCandidate(candidate) {
    this.candidate = candidate;
  }

  close() {
    this.isClosed = true;
    this.signalingState = 'closed';
    this.connectionState = 'closed';
  }
}

describe('PeerConnectionManager', () => {
  let originalRTC;

  beforeEach(() => {
    originalRTC = globalThis.RTCPeerConnection;
    globalThis.RTCPeerConnection = MockRTCPeerConnection;
    globalThis.RTCSessionDescription = class {
      constructor(desc) {
        this.type = desc.type;
        this.sdp = desc.sdp;
      }
    };
    globalThis.RTCIceCandidate = class {
      constructor(cand) {
        this.candidate = cand.candidate;
      }
    };
  });

  afterEach(() => {
    globalThis.RTCPeerConnection = originalRTC;
  });

  it('prevents duplicate connections for the same peer pair', () => {
    const manager = new PeerConnectionManager({
      localSocketId: 'client-local',
      localUserId: 'user-local',
      sendOffer: () => {},
      sendAnswer: () => {},
      sendIceCandidate: () => {},
    });

    const peer1 = manager.getOrCreatePeer('peer-socket-1', 'user-1', 'Alice');
    assert.strictEqual(manager.hasPeer('peer-socket-1'), true);
    assert.strictEqual(manager.getPeersList().length, 1);

    // Call again for the same peer ID
    const peer2 = manager.getOrCreatePeer('peer-socket-1', 'user-1', 'Alice');
    assert.strictEqual(peer1, peer2, 'Must return identical peer context without creating duplicate');
    assert.strictEqual(manager.getPeersList().length, 1, 'Peer count must remain 1');
  });

  it('deterministically assigns polite and impolite roles for Perfect Negotiation', () => {
    // Case 1: local 'client-aaa' < remote 'client-bbb' -> local is POLITE
    const managerPolite = new PeerConnectionManager({
      localSocketId: 'client-aaa',
      localUserId: 'user-aaa',
      sendOffer: () => {},
      sendAnswer: () => {},
      sendIceCandidate: () => {},
    });
    const peer1 = managerPolite.getOrCreatePeer('client-bbb');
    assert.strictEqual(peer1.isPolite, true, 'client-aaa < client-bbb => polite is true');

    // Case 2: local 'client-zzz' > remote 'client-bbb' -> local is IMPOLITE
    const managerImpolite = new PeerConnectionManager({
      localSocketId: 'client-zzz',
      localUserId: 'user-zzz',
      sendOffer: () => {},
      sendAnswer: () => {},
      sendIceCandidate: () => {},
    });
    const peer2 = managerImpolite.getOrCreatePeer('client-bbb');
    assert.strictEqual(peer2.isPolite, false, 'client-zzz > client-bbb => polite is false');
  });

  it('updates spatial parameters (distance, gain, pan) and triggers callback', () => {
    let updateEventCount = 0;
    let latestPeers = [];

    const manager = new PeerConnectionManager({
      localSocketId: 'client-local',
      localUserId: 'user-local',
      sendOffer: () => {},
      sendAnswer: () => {},
      sendIceCandidate: () => {},
      onPeersUpdated: (peers) => {
        updateEventCount++;
        latestPeers = peers;
      },
    });

    manager.getOrCreatePeer('peer-socket-1');

    // Listener at (500, 300), peer at (450, 300) -> distance 50px, dx = -50
    // Gain: max(0, 1 - 50/100) = 0.5
    // Pan: -50 / 100 = -0.5
    manager.updateSpatialParameters(
      'peer-socket-1',
      { x: 500, y: 300 },
      { x: 450, y: 300 },
      100
    );

    const peer = manager.getPeer('peer-socket-1');
    assert.strictEqual(peer.distance, 50);
    assert.strictEqual(peer.gain, 0.5);
    assert.strictEqual(peer.pan, -0.5);
    assert.ok(updateEventCount >= 2);
    assert.strictEqual(latestPeers[0].distance, 50);
  });

  it('cleans up individual peer connection and resources on closePeer()', () => {
    let audioDisconnected = false;
    let audioTrackStopped = false;

    const manager = new PeerConnectionManager({
      localSocketId: 'client-local',
      localUserId: 'user-local',
      sendOffer: () => {},
      sendAnswer: () => {},
      sendIceCandidate: () => {},
    });

    const peer = manager.getOrCreatePeer('peer-to-close');

    // Attach mock audio resources
    peer.audioPipeline = {
      disconnect: () => { audioDisconnected = true; },
    };
    peer.remoteStream = {
      getTracks: () => [{ stop: () => { audioTrackStopped = true; } }],
    };

    assert.strictEqual(manager.hasPeer('peer-to-close'), true);

    manager.closePeer('peer-to-close');

    assert.strictEqual(manager.hasPeer('peer-to-close'), false);
    assert.strictEqual(manager.getPeersList().length, 0);
    assert.strictEqual(audioDisconnected, true, 'Audio pipeline must be disconnected');
    assert.strictEqual(audioTrackStopped, true, 'Remote tracks must be stopped');
    assert.strictEqual(peer.pc.isClosed, true, 'RTCPeerConnection must be closed');
  });

  it('cleans up all peers completely on closeAllPeers()', () => {
    const manager = new PeerConnectionManager({
      localSocketId: 'client-local',
      localUserId: 'user-local',
      sendOffer: () => {},
      sendAnswer: () => {},
      sendIceCandidate: () => {},
    });

    manager.getOrCreatePeer('peer-1');
    manager.getOrCreatePeer('peer-2');
    manager.getOrCreatePeer('peer-3');
    assert.strictEqual(manager.getPeersList().length, 3);

    manager.closeAllPeers();
    assert.strictEqual(manager.getPeersList().length, 0);
    assert.strictEqual(manager.hasPeer('peer-1'), false);
    assert.strictEqual(manager.hasPeer('peer-2'), false);
    assert.strictEqual(manager.hasPeer('peer-3'), false);
  });
});
