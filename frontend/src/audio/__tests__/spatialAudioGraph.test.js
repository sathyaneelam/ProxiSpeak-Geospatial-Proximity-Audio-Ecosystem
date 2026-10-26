import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SpatialAudioGraph } from '../SpatialAudioGraph.js';

class MockAudioParam {
  constructor(defaultValue = 1.0) {
    this.value = defaultValue;
    this.target = defaultValue;
    this.timeConstant = 0;
  }

  setValueAtTime(val) {
    this.value = val;
    this.target = val;
  }

  setTargetAtTime(target, time, timeConstant) {
    this.target = target;
    this.timeConstant = timeConstant;
    this.value = target;
  }
}

class MockAudioNode {
  constructor() {
    this.connections = [];
    this.isDisconnected = false;
  }

  connect(dest) {
    this.connections.push(dest);
    return dest;
  }

  disconnect() {
    this.connections = [];
    this.isDisconnected = true;
  }
}

class MockGainNode extends MockAudioNode {
  constructor(initialGain = 1.0) {
    super();
    this.gain = new MockAudioParam(initialGain);
  }
}

class MockStereoPannerNode extends MockAudioNode {
  constructor() {
    super();
    this.pan = new MockAudioParam(0.0);
  }
}

class MockAudioContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.destination = new MockAudioNode();
  }

  createGain() {
    return new MockGainNode(1.0);
  }

  createStereoPanner() {
    return new MockStereoPannerNode();
  }

  createMediaStreamSource() {
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

function createMockStream() {
  const track = {
    kind: 'audio',
    readyState: 'live',
    enabled: true,
    stop() {
      this.readyState = 'ended';
    },
  };

  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };
}

describe('SpatialAudioGraph - Web Audio Graph, Master Volume, and Spatial Attenuation', () => {
  const originalAudioContext = globalThis.AudioContext;
  const originalWebkitAudioContext = globalThis.webkitAudioContext;

  beforeEach(() => {
    globalThis.AudioContext = MockAudioContext;
    globalThis.webkitAudioContext = MockAudioContext;
  });

  afterEach(() => {
    globalThis.AudioContext = originalAudioContext;
    globalThis.webkitAudioContext = originalWebkitAudioContext;
  });

  test('lazily initializes AudioContext and configures masterGainNode connected to destination', () => {
    const graph = new SpatialAudioGraph();
    assert.equal(graph.audioContext, null);
    assert.equal(graph.masterGainNode, null);

    const ctx = graph.getAudioContext();
    assert.ok(ctx);
    assert.ok(graph.masterGainNode);
    assert.equal(graph.masterGainNode.connections.length, 1);
    assert.equal(graph.masterGainNode.connections[0], ctx.destination);
    assert.equal(graph.masterGainNode.gain.value, 1.0);
    assert.equal(graph.getMasterVolume(), 1.0);
    assert.equal(graph.isMasterMuted(), false);

    graph.destroy();
  });

  test('resumes suspended context to satisfy autoplay policy', async () => {
    const graph = new SpatialAudioGraph();
    assert.equal(graph.getAudioContext().state, 'suspended');

    const state = await graph.resumeContext();
    assert.equal(state, 'running');
    assert.equal(graph.getAudioContext().state, 'running');

    graph.destroy();
  });

  test('setMasterVolume smoothly updates master gain and clamps out-of-range values', () => {
    const graph = new SpatialAudioGraph();
    graph.getAudioContext();

    // Valid value
    graph.setMasterVolume(0.65);
    assert.equal(graph.getMasterVolume(), 0.65);
    assert.equal(graph.masterGainNode.gain.target, 0.65);

    // Clamp upper bound
    graph.setMasterVolume(1.8);
    assert.equal(graph.getMasterVolume(), 1.0);
    assert.equal(graph.masterGainNode.gain.target, 1.0);

    // Clamp lower bound
    graph.setMasterVolume(-0.4);
    assert.equal(graph.getMasterVolume(), 0.0);
    assert.equal(graph.masterGainNode.gain.target, 0.0);

    // Non-finite value ignored
    graph.setMasterVolume(0.8);
    graph.setMasterVolume(NaN);
    assert.equal(graph.getMasterVolume(), 0.8);

    graph.destroy();
  });

  test('setMuted (deafen) smoothly mutes master output and cleanly restores volume on unmute', () => {
    const graph = new SpatialAudioGraph();
    graph.getAudioContext();
    graph.setMasterVolume(0.85);

    // Mute master output
    graph.setMuted(true);
    assert.equal(graph.isMasterMuted(), true);
    assert.equal(graph.masterGainNode.gain.target, 0.0);
    assert.equal(graph.getMasterVolume(), 0.85); // Preserves configured volume level

    // Adjusting master volume while muted updates target without leaking sound
    graph.setMasterVolume(0.6);
    assert.equal(graph.getMasterVolume(), 0.6);
    assert.equal(graph.masterGainNode.gain.target, 0.0); // Stays muted

    // Unmuting restores the configured master volume
    graph.setMuted(false);
    assert.equal(graph.isMasterMuted(), false);
    assert.equal(graph.masterGainNode.gain.target, 0.6);

    graph.destroy();
  });

  test('addPeerStream connects through gain, panner, and master gain bus', () => {
    const graph = new SpatialAudioGraph();
    const stream = createMockStream();

    const result = graph.addPeerStream(
      'peer-alice',
      stream,
      { x: 50, y: 0 },
      { x: 0, y: 0 },
      100
    );

    assert.ok(result);
    assert.equal(result.distance, 50);
    assert.equal(result.pan, 0.5);
    assert.ok(result.gain > 0 && result.gain < 1.0);
    assert.equal(result.volume, 1.0);

    const peerData = graph.peerNodes.get('peer-alice');
    assert.ok(peerData);
    assert.equal(peerData.lastDistance, 50);
    assert.equal(peerData.lastPan, 0.5);

    // Check pipeline connections: source -> gainNode -> pannerNode -> masterGainNode
    assert.equal(peerData.source.connections[0], peerData.gainNode);
    assert.equal(peerData.gainNode.connections[0], peerData.pannerNode);
    assert.equal(peerData.pannerNode.connections[0], graph.masterGainNode);

    graph.destroy();
  });

  test('addPeerStream ignores stream without audio tracks safely', () => {
    const graph = new SpatialAudioGraph();
    const emptyStream = { getAudioTracks: () => [] };

    const result = graph.addPeerStream('empty-peer', emptyStream);
    assert.equal(result, undefined);
    assert.equal(graph.peerNodes.has('empty-peer'), false);

    graph.destroy();
  });

  test('updatePeerSpatial accurately recalculates distance, smoothstep gain, and obstacles without affecting mute state', () => {
    const graph = new SpatialAudioGraph();
    const stream = createMockStream();

    graph.addPeerStream('peer-bob', stream, { x: 0, y: 0 }, { x: 0, y: 0 }, 100);

    // Mute master audio
    graph.setMuted(true);

    // Moving peer should still update peer's spatial gain calculation
    const obstacles = [{ x: 20, y: -10, w: 20, h: 20, type: 'wall' }];
    const updated = graph.updatePeerSpatial('peer-bob', { x: 80, y: 0 }, { x: 0, y: 0 }, 100, obstacles);

    assert.ok(updated);
    assert.equal(updated.distance, 80);
    assert.equal(updated.pan, 0.8);
    assert.ok(updated.obstacleAttenuation <= 0.1);
    // Peer's gainNode still computes its spatial gain accurately
    const peerData = graph.peerNodes.get('peer-bob');
    assert.ok(peerData.lastGain > 0);

    // Unmuting master preserves peer's spatial gain without resetting it to 0
    graph.setMuted(false);
    assert.equal(graph.masterGainNode.gain.target, 1.0);
    assert.ok(peerData.lastGain > 0);

    graph.destroy();
  });

  test('setPeerVolume adjusts individual peer multiplier and clamps boundaries', () => {
    const graph = new SpatialAudioGraph();
    const stream = createMockStream();

    graph.addPeerStream('peer-charlie', stream, { x: 0, y: 0 }, { x: 0, y: 0 }, 100);
    assert.equal(graph.getPeerVolume('peer-charlie'), 1.0);

    // Boost volume
    const vol = graph.setPeerVolume('peer-charlie', 1.5);
    assert.equal(vol, 1.5);
    assert.equal(graph.getPeerVolume('peer-charlie'), 1.5);

    // Clamp above 2.0
    graph.setPeerVolume('peer-charlie', 2.8);
    assert.equal(graph.getPeerVolume('peer-charlie'), 2.0);

    // Clamp below 0.0
    graph.setPeerVolume('peer-charlie', -0.5);
    assert.equal(graph.getPeerVolume('peer-charlie'), 0.0);

    // Unknown peer returns null
    assert.equal(graph.setPeerVolume('unknown-peer', 1.0), null);
    assert.equal(graph.getPeerVolume('unknown-peer'), null);

    // Metrics reflect individual volume and spatial gain
    const metrics = graph.getPeerSpatialMetrics('peer-charlie');
    assert.equal(metrics.volume, 0.0);
    assert.equal(metrics.gain, 0.0);
    assert.equal(metrics.spatialGain, 1.0);

    graph.destroy();
  });

  test('repeated setPeerVolume calls calculate effective gain consistently without compounding', () => {
    const graph = new SpatialAudioGraph();
    const stream = createMockStream();

    // At distance 50 with earshot radius 100: smoothstep spatialGain is 0.5
    const init = graph.addPeerStream('peer-eva', stream, { x: 50, y: 0 }, { x: 0, y: 0 }, 100);
    assert.equal(init.spatialGain, 0.5);
    assert.equal(init.gain, 0.5);

    const peerData = graph.peerNodes.get('peer-eva');

    // 1. Set volume to 0.5 -> effective gain = 0.5 * 0.5 = 0.25
    graph.setPeerVolume('peer-eva', 0.5);
    assert.equal(peerData.volume, 0.5);
    assert.equal(peerData.spatialGain, 0.5);
    assert.equal(peerData.lastGain, 0.25);
    assert.equal(peerData.gainNode.gain.target, 0.25);

    // 2. Set volume to 0.5 again -> must NOT compound to 0.125!
    graph.setPeerVolume('peer-eva', 0.5);
    assert.equal(peerData.volume, 0.5);
    assert.equal(peerData.spatialGain, 0.5);
    assert.equal(peerData.lastGain, 0.25);
    assert.equal(peerData.gainNode.gain.target, 0.25);

    // 3. Set volume to 1.5 -> effective gain = 0.5 * 1.5 = 0.75
    graph.setPeerVolume('peer-eva', 1.5);
    assert.equal(peerData.volume, 1.5);
    assert.equal(peerData.spatialGain, 0.5);
    assert.equal(peerData.lastGain, 0.75);
    assert.equal(peerData.gainNode.gain.target, 0.75);

    // 4. Repeatedly setting volume to 1.5 must remain 0.75 without compounding
    graph.setPeerVolume('peer-eva', 1.5);
    assert.equal(peerData.volume, 1.5);
    assert.equal(peerData.spatialGain, 0.5);
    assert.equal(peerData.lastGain, 0.75);
    assert.equal(peerData.gainNode.gain.target, 0.75);

    // 5. Resetting volume back to 1.0 cleanly restores the original spatial gain 0.5
    graph.setPeerVolume('peer-eva', 1.0);
    assert.equal(peerData.volume, 1.0);
    assert.equal(peerData.spatialGain, 0.5);
    assert.equal(peerData.lastGain, 0.5);
    assert.equal(peerData.gainNode.gain.target, 0.5);

    graph.destroy();
  });

  test('updatePeerSpatial after setPeerVolume preserves peer volume multiplier without compounding', () => {
    const graph = new SpatialAudioGraph();
    const stream = createMockStream();

    // Start at distance 50 (spatialGain = 0.5)
    graph.addPeerStream('peer-frank', stream, { x: 50, y: 0 }, { x: 0, y: 0 }, 100);
    const peerData = graph.peerNodes.get('peer-frank');

    // Set peer volume to 0.8 -> effectiveGain = 0.5 * 0.8 = 0.4
    graph.setPeerVolume('peer-frank', 0.8);
    assert.equal(peerData.lastGain, 0.4);

    // Move peer to distance 0 (local: (0, 0), peer: (0, 0)) -> spatialGain = 1.0
    // Effective gain should become 1.0 * 0.8 = 0.8
    const updated = graph.updatePeerSpatial('peer-frank', { x: 0, y: 0 }, { x: 0, y: 0 }, 100);
    assert.equal(updated.spatialGain, 1.0);
    assert.equal(updated.volume, 0.8);
    assert.equal(updated.gain, 0.8);
    assert.equal(peerData.spatialGain, 1.0);
    assert.equal(peerData.lastGain, 0.8);
    assert.equal(peerData.gainNode.gain.target, 0.8);

    // Further calling setPeerVolume(peer-frank, 0.8) must still be 1.0 * 0.8 = 0.8
    graph.setPeerVolume('peer-frank', 0.8);
    assert.equal(peerData.lastGain, 0.8);
    assert.equal(peerData.gainNode.gain.target, 0.8);

    // Move peer out of earshot (distance 120 >= 100) -> spatialGain = 0.0 -> effectiveGain = 0.0
    const outOfRange = graph.updatePeerSpatial('peer-frank', { x: 120, y: 0 }, { x: 0, y: 0 }, 100);
    assert.equal(outOfRange.spatialGain, 0.0);
    assert.equal(outOfRange.gain, 0.0);
    assert.equal(peerData.lastGain, 0.0);

    // Move back into halfway (distance 50) -> spatialGain = 0.5 -> effectiveGain = 0.5 * 0.8 = 0.4
    const backInRange = graph.updatePeerSpatial('peer-frank', { x: 50, y: 0 }, { x: 0, y: 0 }, 100);
    assert.equal(backInRange.spatialGain, 0.5);
    assert.equal(backInRange.volume, 0.8);
    assert.equal(backInRange.gain, 0.4);
    assert.equal(peerData.lastGain, 0.4);

    graph.destroy();
  });

  test('falls back gracefully when StereoPannerNode is unavailable', () => {
    // Context without createStereoPanner
    const originalCreateStereoPanner = MockAudioContext.prototype.createStereoPanner;
    delete MockAudioContext.prototype.createStereoPanner;

    const graph = new SpatialAudioGraph();
    const stream = createMockStream();

    const result = graph.addPeerStream('peer-fallback', stream, { x: 50, y: 0 }, { x: 0, y: 0 }, 100);
    assert.ok(result);

    const peerData = graph.peerNodes.get('peer-fallback');
    assert.equal(peerData.pannerNode, null);
    // Direct connection: source -> gainNode -> masterGainNode
    assert.equal(peerData.source.connections[0], peerData.gainNode);
    assert.equal(peerData.gainNode.connections[0], graph.masterGainNode);

    // Update works without pannerNode
    const updated = graph.updatePeerSpatial('peer-fallback', { x: 10, y: 0 }, { x: 0, y: 0 }, 100);
    assert.ok(updated);

    MockAudioContext.prototype.createStereoPanner = originalCreateStereoPanner;
    graph.destroy();
  });

  test('removePeer disconnects peer audio nodes cleanly', () => {
    const graph = new SpatialAudioGraph();
    const stream = createMockStream();

    graph.addPeerStream('peer-david', stream, { x: 0, y: 0 }, { x: 0, y: 0 }, 100);
    const peerData = graph.peerNodes.get('peer-david');

    assert.equal(peerData.source.isDisconnected, false);
    assert.equal(peerData.gainNode.isDisconnected, false);
    assert.equal(peerData.pannerNode.isDisconnected, false);

    graph.removePeer('peer-david');
    assert.equal(graph.peerNodes.has('peer-david'), false);
    assert.equal(peerData.source.isDisconnected, true);
    assert.equal(peerData.gainNode.isDisconnected, true);
    assert.equal(peerData.pannerNode.isDisconnected, true);

    graph.destroy();
  });

  test('destroy releases all peers, disconnects master gain node, and closes AudioContext', () => {
    const graph = new SpatialAudioGraph();
    const stream1 = createMockStream();
    const stream2 = createMockStream();

    graph.addPeerStream('peer-1', stream1);
    graph.addPeerStream('peer-2', stream2);

    const ctx = graph.getAudioContext();
    const master = graph.masterGainNode;

    assert.equal(graph.peerNodes.size, 2);
    assert.equal(master.isDisconnected, false);
    assert.notEqual(ctx.state, 'closed');

    graph.destroy();

    assert.equal(graph.peerNodes.size, 0);
    assert.equal(master.isDisconnected, true);
    assert.equal(graph.masterGainNode, null);
    assert.equal(ctx.state, 'closed');
    assert.equal(graph.audioContext, null);
  });
});
