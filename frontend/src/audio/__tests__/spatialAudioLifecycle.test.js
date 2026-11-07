import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpatialAudioGraph } from '../SpatialAudioGraph.js';
import { WebRTCPeerManager } from '../webrtcPeerManager.js';

class MockAudioParam {
  constructor(value = 1) {
    this.value = value;
    this.target = value;
  }

  setValueAtTime(value) {
    this.value = value;
    this.target = value;
  }

  setTargetAtTime(value) {
    this.value = value;
    this.target = value;
  }
}

class MockAudioNode {
  constructor() {
    this.connections = [];
    this.isDisconnected = false;
  }

  connect(node) {
    this.connections.push(node);
    return node;
  }

  disconnect() {
    this.connections = [];
    this.isDisconnected = true;
  }
}

class MockAudioContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.destination = new MockAudioNode();
    this.mediaStreamSourceCount = 0;
  }

  createGain() {
    const node = new MockAudioNode();
    node.gain = new MockAudioParam();
    return node;
  }

  createStereoPanner() {
    const node = new MockAudioNode();
    node.pan = new MockAudioParam(0);
    return node;
  }

  createMediaStreamSource() {
    this.mediaStreamSourceCount += 1;
    return new MockAudioNode();
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }

  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

class MockMediaStream {
  constructor() {
    this.tracks = [];
  }

  addTrack(track) {
    this.tracks.push(track);
  }

  getTracks() {
    return this.tracks;
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
}

class MockRTCPeerConnection {
  constructor() {
    this.connectionState = 'new';
    this.iceConnectionState = 'new';
    this.signalingState = 'stable';
    this.localDescription = null;
  }

  addTrack() {}

  getSenders() {
    return [];
  }

  createOffer() {
    return Promise.resolve({ type: 'offer', sdp: 'mock-offer' });
  }

  setLocalDescription(description) {
    this.localDescription = description;
    this.signalingState = 'have-local-offer';
    return Promise.resolve();
  }

  close() {
    this.connectionState = 'closed';
  }
}

const waitFor = async (predicate) => {
  const deadline = Date.now() + 500;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for peer reconnection');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test('spatial audio follows peer join, movement, mute, leave, and reconnect lifecycle', async () => {
  const originalAudioContext = globalThis.AudioContext;
  const originalWebkitAudioContext = globalThis.webkitAudioContext;
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalMediaStream = globalThis.MediaStream;
  const originalWindow = globalThis.window;
  globalThis.AudioContext = MockAudioContext;
  globalThis.webkitAudioContext = MockAudioContext;
  globalThis.RTCPeerConnection = MockRTCPeerConnection;
  globalThis.MediaStream = MockMediaStream;
  globalThis.window = globalThis;

  const graph = new SpatialAudioGraph();
  let manager;
  const addRemoteStream = (peerId, stream) => {
    const position = manager.getPeerPosition(peerId) || { x: 0, y: 0 };
    graph.addPeerStream(peerId, stream, position, { x: 0, y: 0 }, 100);
  };
  manager = new WebRTCPeerManager({
    localUserId: 'local-user',
    localPosition: { x: 0, y: 0 },
    earshotRadius: 100,
    reconnectDelays: [5],
    onRemoteStream: addRemoteStream,
    onPeerPosition(peerId, position) {
      graph.updatePeerSpatial(peerId, position, { x: 0, y: 0 }, 100);
    },
    onPeerRemoved(peerId) {
      graph.removePeer(peerId);
    },
  });

  const deliverAudioTrack = (peerId) => {
    const session = manager.getOrCreatePeer(peerId);
    const track = {
      kind: 'audio',
      readyState: 'live',
      stop() {
        this.readyState = 'ended';
      },
    };
    session.pc.ontrack({ track });
    return { session, track };
  };

  try {
    manager.updatePeerPosition('left-user', { x: -50, y: 0 });
    manager.updatePeerPosition('right-user', { x: 50, y: 0 });
    const { session: leftSession } = deliverAudioTrack('left-user');
    const { track: rightTrack } = deliverAudioTrack('right-user');

    assert.equal(graph.peerNodes.size, 2);
    assert.equal(graph.audioContext.mediaStreamSourceCount, 2);
    assert.equal(graph.getPeerSpatialMetrics('left-user').gain, 0.5);
    assert.equal(graph.getPeerSpatialMetrics('left-user').pan, -0.5);
    assert.equal(graph.getPeerSpatialMetrics('right-user').gain, 0.5);
    assert.equal(graph.getPeerSpatialMetrics('right-user').pan, 0.5);

    const leftPeer = graph.peerNodes.get('left-user');
    leftSession.pc.ontrack({ track: leftSession.remoteStream.getAudioTracks()[0] });
    assert.equal(graph.peerNodes.size, 2);
    assert.equal(graph.audioContext.mediaStreamSourceCount, 2);
    assert.equal(graph.peerNodes.get('left-user'), leftPeer);

    manager.updatePeerPosition('left-user', { x: -25, y: 0 });
    assert.equal(graph.getPeerSpatialMetrics('left-user').gain, 0.8438);
    assert.equal(graph.getPeerSpatialMetrics('left-user').pan, -0.25);

    graph.setMuted(true);
    assert.equal(graph.masterGainNode.gain.target, 0);
    graph.setMuted(false);
    assert.equal(graph.masterGainNode.gain.target, 1);

    manager.closePeer('right-user');
    assert.equal(graph.peerNodes.has('right-user'), false);
    assert.equal(graph.peerNodes.get('left-user'), leftPeer);
    assert.equal(leftPeer.source.isDisconnected, false);
    assert.equal(rightTrack.readyState, 'ended');

    const oldRemoteTrack = leftSession.remoteStream.getAudioTracks()[0];
    leftSession.pc.connectionState = 'failed';
    leftSession.pc.onconnectionstatechange();
    await waitFor(() => {
      const current = manager.peers.get('left-user');
      return current && current !== leftSession;
    });

    assert.equal(graph.peerNodes.has('left-user'), false);
    assert.equal(leftPeer.source.isDisconnected, true);
    assert.equal(oldRemoteTrack.readyState, 'ended');

    const { session: reconnectedSession } = deliverAudioTrack('left-user');
    assert.notEqual(reconnectedSession, leftSession);
    assert.equal(graph.peerNodes.size, 1);
    assert.equal(graph.audioContext.mediaStreamSourceCount, 3);

    const currentPeer = graph.peerNodes.get('left-user');
    manager.destroy();
    assert.equal(graph.peerNodes.size, 0);
    assert.equal(currentPeer.source.isDisconnected, true);
    graph.destroy();
    assert.equal(graph.audioContext, null);
  } finally {
    manager.destroy();
    graph.destroy();
    globalThis.AudioContext = originalAudioContext;
    globalThis.webkitAudioContext = originalWebkitAudioContext;
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
    globalThis.MediaStream = originalMediaStream;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});
