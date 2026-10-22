import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AudioSignalingAdapter } from '../src/audio/audioSignalingAdapter.js';

// Mock Socket.io client
class MockSocket {
  constructor(id = 'local-socket-id') {
    this.id = id;
    this.connected = true;
    this.listeners = new Map();
    this.emittedEvents = [];
  }

  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(handler);
  }

  off(event, handler) {
    if (!this.listeners.has(event)) return;
    const filtered = this.listeners.get(event).filter((h) => h !== handler);
    this.listeners.set(event, filtered);
  }

  emit(event, payload) {
    this.emittedEvents.push({ event, payload });
  }

  // Trigger simulated incoming event from server
  simulateEvent(event, data) {
    const handlers = this.listeners.get(event) || [];
    for (const h of handlers) {
      h(data);
    }
  }
}

describe('AudioSignalingAdapter', () => {
  it('sends properly formatted WebRTC signaling payloads via Socket.io', () => {
    const mockSocket = new MockSocket();
    const adapter = new AudioSignalingAdapter({
      socket: mockSocket,
      peerConnectionManager: {},
    });

    // 1. Send Offer
    adapter.sendOffer('target-peer-1', { type: 'offer', sdp: 'sdp-offer-string' });
    assert.strictEqual(mockSocket.emittedEvents.length, 1);
    assert.strictEqual(mockSocket.emittedEvents[0].event, 'webrtc:offer');
    assert.deepStrictEqual(mockSocket.emittedEvents[0].payload, {
      to: 'target-peer-1',
      offer: { type: 'offer', sdp: 'sdp-offer-string' },
    });

    // 2. Send Answer
    adapter.sendAnswer('target-peer-1', { type: 'answer', sdp: 'sdp-answer-string' });
    assert.strictEqual(mockSocket.emittedEvents.length, 2);
    assert.strictEqual(mockSocket.emittedEvents[1].event, 'webrtc:answer');
    assert.deepStrictEqual(mockSocket.emittedEvents[1].payload, {
      to: 'target-peer-1',
      answer: { type: 'answer', sdp: 'sdp-answer-string' },
    });

    // 3. Send ICE Candidate
    adapter.sendIceCandidate('target-peer-1', { candidate: 'candidate:123', sdpMid: '0' });
    assert.strictEqual(mockSocket.emittedEvents.length, 3);
    assert.strictEqual(mockSocket.emittedEvents[2].event, 'webrtc:ice-candidate');
    assert.deepStrictEqual(mockSocket.emittedEvents[2].payload, {
      to: 'target-peer-1',
      candidate: { candidate: 'candidate:123', sdpMid: '0' },
    });
  });

  it('routes proximity:enter and initiates connection', () => {
    const mockSocket = new MockSocket('client-me');
    let initiatedSocket = null;
    let initiatedUser = null;

    const mockPCM = {
      initiateConnection: (sId, uId) => {
        initiatedSocket = sId;
        initiatedUser = uId;
      },
    };

    const adapter = new AudioSignalingAdapter({
      socket: mockSocket,
      peerConnectionManager: mockPCM,
    });
    adapter.attachListeners();

    mockSocket.simulateEvent('proximity:enter', {
      peerSocketId: 'remote-socket-abc',
      peerUserId: 'remote-user-123',
      distance: 60,
      earshotRadius: 100,
    });

    assert.strictEqual(initiatedSocket, 'remote-socket-abc');
    assert.strictEqual(initiatedUser, 'remote-user-123');
  });

  it('routes proximity:leave and user:left to closePeer', () => {
    const mockSocket = new MockSocket();
    const closedPeers = [];

    const mockPCM = {
      closePeer: (sId) => {
        closedPeers.push(sId);
      },
    };

    const adapter = new AudioSignalingAdapter({
      socket: mockSocket,
      peerConnectionManager: mockPCM,
    });
    adapter.attachListeners();

    mockSocket.simulateEvent('proximity:leave', {
      peerSocketId: 'peer-left-1',
      distance: 120,
    });
    assert.strictEqual(closedPeers.includes('peer-left-1'), true);

    mockSocket.simulateEvent('user:left', {
      socketId: 'peer-disconnected-2',
      userId: 'user-2',
    });
    assert.strictEqual(closedPeers.includes('peer-disconnected-2'), true);
  });

  it('routes incoming webrtc:offer, answer, and ice-candidate', () => {
    const mockSocket = new MockSocket('local-socket-1');
    let handledOffer = null;
    let handledAnswer = null;
    let handledCandidate = null;

    const mockPCM = {
      handleRemoteOffer: (from, fromUserId, offer) => {
        handledOffer = { from, fromUserId, offer };
      },
      handleRemoteAnswer: (from, answer) => {
        handledAnswer = { from, answer };
      },
      handleRemoteIceCandidate: (from, candidate) => {
        handledCandidate = { from, candidate };
      },
    };

    const adapter = new AudioSignalingAdapter({
      socket: mockSocket,
      peerConnectionManager: mockPCM,
    });
    adapter.attachListeners();

    // 1. Offer
    mockSocket.simulateEvent('webrtc:offer', {
      from: 'remote-peer-2',
      fromUserId: 'u2',
      offer: { type: 'offer', sdp: 'remote-sdp' },
    });
    assert.strictEqual(handledOffer.from, 'remote-peer-2');
    assert.strictEqual(handledOffer.offer.sdp, 'remote-sdp');

    // 2. Answer
    mockSocket.simulateEvent('webrtc:answer', {
      from: 'remote-peer-2',
      fromUserId: 'u2',
      answer: { type: 'answer', sdp: 'answer-sdp' },
    });
    assert.strictEqual(handledAnswer.from, 'remote-peer-2');
    assert.strictEqual(handledAnswer.answer.sdp, 'answer-sdp');

    // 3. ICE Candidate
    mockSocket.simulateEvent('webrtc:ice-candidate', {
      from: 'remote-peer-2',
      fromUserId: 'u2',
      candidate: { candidate: 'cand-str' },
    });
    assert.strictEqual(handledCandidate.from, 'remote-peer-2');
    assert.strictEqual(handledCandidate.candidate.candidate, 'cand-str');
  });

  it('handles webrtc:error PEER_OUT_OF_RANGE by tearing down in-flight connection', () => {
    const mockSocket = new MockSocket();
    let closedPeerId = null;
    let reportedError = null;

    const mockPCM = {
      closePeer: (id) => {
        closedPeerId = id;
      },
    };

    const adapter = new AudioSignalingAdapter({
      socket: mockSocket,
      peerConnectionManager: mockPCM,
      onError: (err) => {
        reportedError = err;
      },
    });
    adapter.attachListeners();

    mockSocket.simulateEvent('webrtc:error', {
      status: 'error',
      code: 'PEER_OUT_OF_RANGE',
      message: 'Peer is beyond 100px earshot radius.',
      targetSocketId: 'peer-fled',
      distance: 140,
    });

    assert.strictEqual(closedPeerId, 'peer-fled');
    assert.strictEqual(reportedError.code, 'PEER_OUT_OF_RANGE');
    assert.strictEqual(reportedError.target, 'peer-fled');
  });

  it('cleans up all listeners on detachListeners()', () => {
    const mockSocket = new MockSocket();
    const adapter = new AudioSignalingAdapter({
      socket: mockSocket,
      peerConnectionManager: {},
    });

    adapter.attachListeners();
    assert.ok(mockSocket.listeners.get('webrtc:offer').length > 0);

    adapter.detachListeners();
    assert.strictEqual(mockSocket.listeners.get('webrtc:offer').length, 0);
    assert.strictEqual(mockSocket.listeners.get('proximity:enter').length, 0);
  });
});
