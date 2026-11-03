import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGNALING_EVENTS,
  isValidPosition,
  isValidSdpDescription,
  isValidSdpPayload,
  isValidIceCandidatePayload,
  isValidPeerPresencePayload,
  normalizeSdpPayload,
  normalizeIceCandidatePayload,
  createOfferPayload,
  createAnswerPayload,
  createIceCandidatePayload,
} from '../signalingContract.js';
import {
  BaseSignalingTransport,
  BroadcastSignalingTransport,
  SocketIOSignalingTransport,
} from '../signalingAdapter.js';

describe('Signaling Contract & Adapter - Event Payloads and Validation', () => {
  test('isValidPosition properly checks 2D coordinate objects', () => {
    assert.equal(isValidPosition({ x: 100, y: 200 }), true);
    assert.equal(isValidPosition({ x: 0, y: 0 }), true);
    assert.equal(isValidPosition(null), false);
    assert.equal(isValidPosition({ x: '100', y: 200 }), false);
    assert.equal(isValidPosition({ x: NaN, y: 200 }), false);
    assert.equal(isValidPosition({ x: Infinity, y: 200 }), false);
    assert.equal(isValidPosition({}), false);
  });

  test('isValidSdpPayload validates SDP structures', () => {
    const validOffer = {
      fromUserId: 'user-1',
      toUserId: 'user-2',
      officeId: 'office-a',
      sdp: { type: 'offer', sdp: 'v=0...' },
    };
    assert.equal(isValidSdpPayload(validOffer), true);

    assert.equal(isValidSdpPayload({ ...validOffer, fromUserId: '' }), false);
    assert.equal(isValidSdpPayload({ ...validOffer, sdp: null }), false);
    assert.equal(isValidSdpPayload({ ...validOffer, sdp: { type: 'answer', sdp: 'v=0...' } }, 'offer'), false);
    assert.equal(isValidSdpPayload({ toUserId: 'user-2', sdp: validOffer.sdp }), false);
    assert.equal(isValidSdpPayload({ fromUserId: 'user-1', sdp: validOffer.sdp }), false);
    assert.equal(isValidSdpPayload({ ...validOffer, to: 'another-user' }), false);
    assert.equal(isValidSdpDescription({ type: 'offer', sdp: '' }, 'offer'), false);
    assert.equal(isValidSdpPayload(null), false);
  });

  test('isValidIceCandidatePayload validates candidate structures', () => {
    const validIce = {
      fromUserId: 'user-1',
      toUserId: 'user-2',
      officeId: 'office-a',
      candidate: { candidate: 'candidate:1 1 UDP ...' },
    };
    assert.equal(isValidIceCandidatePayload(validIce), true);
    assert.equal(isValidIceCandidatePayload({ ...validIce, candidate: {} }), false);
    assert.equal(isValidIceCandidatePayload({ ...validIce, fromUserId: undefined }), false);
    assert.equal(isValidIceCandidatePayload({
      ...validIce,
      candidate: { candidate: 'candidate:1', sdpMLineIndex: -1 },
    }), false);
    assert.equal(isValidIceCandidatePayload({
      ...validIce,
      candidate: { candidate: '' },
    }), true);
  });

  test('normalizes supported backend aliases into canonical signaling envelopes', () => {
    const offer = normalizeSdpPayload({
      from: ' remote ',
      to: 'local',
      officeId: 'room',
      offer: { type: 'offer', sdp: 'v=0...' },
    }, 'offer');
    assert.equal(offer.fromUserId, 'remote');
    assert.equal(offer.toUserId, 'local');
    assert.equal(offer.sdp.type, 'offer');

    const candidate = normalizeIceCandidatePayload({
      from: 'remote',
      to: 'local',
      candidate: { candidate: 'candidate:1' },
    });
    assert.equal(candidate.fromUserId, 'remote');
    assert.equal(candidate.toUserId, 'local');
    assert.equal(candidate.candidate.candidate, 'candidate:1');
  });

  test('validates presence IDs and optional position data', () => {
    assert.equal(isValidPeerPresencePayload({ userId: 'remote' }), true);
    assert.equal(isValidPeerPresencePayload({ userId: '' }), false);
    assert.equal(isValidPeerPresencePayload({ userId: 'remote', position: { x: 1, y: Infinity } }), false);
  });

  test('createOfferPayload, createAnswerPayload, and createIceCandidatePayload format compliant envelopes', () => {
    assert.equal(SIGNALING_EVENTS.WEBRTC_OFFER, 'webrtc:offer');
    assert.equal(SIGNALING_EVENTS.VOICE_JOIN, 'voice:join');

    const offer = createOfferPayload({
      fromUserId: 'alice',
      toUserId: 'bob',
      officeId: 'room-1',
      sdp: { type: 'offer', sdp: 'sdp-data' },
    });
    assert.equal(offer.fromUserId, 'alice');
    assert.equal(offer.toUserId, 'bob');
    assert.equal(offer.officeId, 'room-1');
    assert.equal(offer.sdp.type, 'offer');
    assert.ok(typeof offer.timestamp === 'number');

    const answer = createAnswerPayload({
      fromUserId: 'bob',
      toUserId: 'alice',
      officeId: 'room-1',
      sdp: { type: 'answer', sdp: 'ans-data' },
    });
    assert.equal(answer.fromUserId, 'bob');
    assert.equal(answer.toUserId, 'alice');
    assert.equal(answer.sdp.type, 'answer');

    const ice = createIceCandidatePayload({
      fromUserId: 'alice',
      toUserId: 'bob',
      officeId: 'room-1',
      candidate: { candidate: 'cand-str', sdpMid: '0', sdpMLineIndex: 0 },
    });
    assert.equal(ice.candidate.candidate, 'cand-str');
  });

  test('BaseSignalingTransport registers and cleans up listeners correctly', () => {
    const transport = new BaseSignalingTransport();
    let callCount = 0;
    const unsubscribe = transport.on('test-event', (data) => {
      callCount += 1;
      assert.equal(data.foo, 'bar');
    });

    transport.emitLocal('test-event', { foo: 'bar' });
    assert.equal(callCount, 1);

    unsubscribe();
    transport.emitLocal('test-event', { foo: 'bar' });
    assert.equal(callCount, 1); // Not called again after unsubscribing
    assert.equal(transport.listeners.size, 0);
  });

  test('Socket.IO transport rejoins the voice room after reconnecting', () => {
    const transport = new SocketIOSignalingTransport();
    const socketHandlers = new Map();
    const emittedEvents = [];
    let disconnectCount = 0;
    transport.socket = {
      connected: true,
      id: 'socket-1',
      on(event, handler) {
        socketHandlers.set(event, handler);
      },
      off(event, handler) {
        if (socketHandlers.get(event) === handler) socketHandlers.delete(event);
      },
      emit(event, payload) {
        emittedEvents.push({ event, payload });
      },
      disconnect() {
        disconnectCount += 1;
      },
    };
    transport.userId = 'user-1';
    transport.officeId = 'office-1';
    transport.position = { x: 10, y: 20 };

    transport._bindSocketEvents();
    socketHandlers.get('connect')();
    transport.socket.connected = false;
    socketHandlers.get('disconnect')('transport close');
    transport.updatePosition({ x: 30, y: 40 });
    transport.socket.connected = true;
    socketHandlers.get('connect')();

    assert.deepEqual(emittedEvents[0], {
      event: SIGNALING_EVENTS.VOICE_JOIN,
      payload: {
        userId: 'user-1',
        officeId: 'office-1',
        position: { x: 10, y: 20 },
      },
    });
    assert.deepEqual(emittedEvents[1], {
      event: SIGNALING_EVENTS.VOICE_JOIN,
      payload: {
        userId: 'user-1',
        officeId: 'office-1',
        position: { x: 30, y: 40 },
      },
    });

    transport._bindSocketEvents();
    assert.equal(socketHandlers.size, 10, 'Socket event handlers should only be bound once.');
    transport.disconnect();
    assert.equal(socketHandlers.size, 0);
    assert.equal(disconnectCount, 1);
  });

  test('Socket.IO transport forwards valid WebRTC server error events', () => {
    const transport = new SocketIOSignalingTransport();
    const socketHandlers = new Map();
    transport.socket = {
      connected: true,
      on(event, handler) {
        socketHandlers.set(event, handler);
      },
      off(event, handler) {
        if (socketHandlers.get(event) === handler) socketHandlers.delete(event);
      },
      emit() {},
      disconnect() {},
    };
    transport.userId = 'local';
    transport.officeId = 'office';
    transport._bindSocketEvents();
    const received = [];
    transport.on(SIGNALING_EVENTS.WEBRTC_ERROR, (payload) => received.push(payload));

    socketHandlers.get(SIGNALING_EVENTS.WEBRTC_ERROR)({
      code: 'PEER_UNAVAILABLE',
      message: 'Peer is unavailable',
      targetUserId: 'remote',
    });

    assert.deepEqual(received, [{
      code: 'PEER_UNAVAILABLE',
      message: 'Peer is unavailable',
      targetUserId: 'remote',
    }]);
    transport.disconnect();
  });

  test('Socket.IO transport drops malformed, self, and misrouted signaling messages', () => {
    const transport = new SocketIOSignalingTransport();
    const socketHandlers = new Map();
    transport.socket = {
      connected: true,
      on(event, handler) {
        socketHandlers.set(event, handler);
      },
      off() {},
      emit() {},
      disconnect() {},
    };
    transport.userId = 'local';
    transport.officeId = 'office';
    transport._bindSocketEvents();
    const received = [];
    transport.on(SIGNALING_EVENTS.WEBRTC_OFFER, (payload) => received.push(payload));
    const receiveOffer = socketHandlers.get(SIGNALING_EVENTS.WEBRTC_OFFER);

    receiveOffer({
      from: 'remote',
      to: 'local',
      officeId: 'office',
      offer: { type: 'offer', sdp: 'v=0...' },
    });
    receiveOffer({
      from: 'remote',
      to: 'other-user',
      offer: { type: 'offer', sdp: 'v=0...' },
    });
    receiveOffer({
      to: 'local',
      offer: { type: 'offer', sdp: 'v=0...' },
    });
    receiveOffer({
      from: 'local',
      to: 'local',
      offer: { type: 'offer', sdp: 'v=0...' },
    });
    receiveOffer({
      from: 'remote',
      to: 'local',
      offer: { type: 'answer', sdp: 'v=0...' },
    });

    assert.equal(received.length, 1);
    assert.equal(received[0].fromUserId, 'remote');
    assert.equal(received[0].toUserId, 'local');
    transport.disconnect();
  });

  test('Broadcast transport validates and normalizes incoming signaling messages', () => {
    const transport = new BroadcastSignalingTransport();
    transport.userId = 'local';
    transport.officeId = 'office';
    const received = [];
    transport.on(SIGNALING_EVENTS.WEBRTC_ANSWER, (payload) => received.push(payload));

    transport._handleBroadcastMessage({
      type: SIGNALING_EVENTS.WEBRTC_ANSWER,
      payload: {
        from: 'remote',
        to: 'local',
        officeId: 'office',
        answer: { type: 'answer', sdp: 'v=0...' },
      },
    });
    transport._handleBroadcastMessage({
      type: SIGNALING_EVENTS.WEBRTC_ANSWER,
      payload: {
        from: 'remote',
        to: 'elsewhere',
        answer: { type: 'answer', sdp: 'v=0...' },
      },
    });

    assert.equal(received.length, 1);
    assert.equal(received[0].fromUserId, 'remote');
    assert.equal(received[0].toUserId, 'local');
    transport.disconnect();
  });

  test('Broadcast transport discovers existing users when a new tab joins', async () => {
    const originalBroadcastChannel = globalThis.BroadcastChannel;
    const channels = new Map();

    globalThis.BroadcastChannel = class {
      constructor(name) {
        this.name = name;
        if (!channels.has(name)) channels.set(name, new Set());
        channels.get(name).add(this);
      }

      postMessage(data) {
        for (const channel of channels.get(this.name) || []) {
          if (channel !== this && channel.onmessage) {
            const handler = channel.onmessage;
            queueMicrotask(() => handler({ data }));
          }
        }
      }

      close() {
        channels.get(this.name)?.delete(this);
      }
    };

    const first = new BroadcastSignalingTransport('test-room');
    const second = new BroadcastSignalingTransport('test-room');
    const firstUsers = [];
    const secondUsers = [];
    first.on(SIGNALING_EVENTS.VOICE_USER_JOINED, (payload) =>
      firstUsers.push(payload.userId)
    );
    second.on(SIGNALING_EVENTS.VOICE_USER_JOINED, (payload) =>
      secondUsers.push(payload.userId)
    );

    try {
      await first.connect({
        userId: 'first',
        officeId: 'office',
        position: { x: 10, y: 20 },
      });
      await second.connect({
        userId: 'second',
        officeId: 'office',
        position: { x: 30, y: 40 },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.ok(firstUsers.includes('second'));
      assert.ok(secondUsers.includes('first'));
    } finally {
      first.disconnect();
      second.disconnect();
      globalThis.BroadcastChannel = originalBroadcastChannel;
    }
  });
});
