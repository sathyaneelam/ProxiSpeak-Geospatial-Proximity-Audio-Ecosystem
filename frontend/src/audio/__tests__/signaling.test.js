import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGNALING_EVENTS,
  isValidPosition,
  isValidSdpPayload,
  isValidIceCandidatePayload,
  createOfferPayload,
  createAnswerPayload,
  createIceCandidatePayload,
} from '../signalingContract.js';
import { BaseSignalingTransport, SocketIOSignalingTransport } from '../signalingAdapter.js';

describe('Signaling Contract & Adapter - Event Payloads and Validation', () => {
  test('isValidPosition properly checks 2D coordinate objects', () => {
    assert.equal(isValidPosition({ x: 100, y: 200 }), true);
    assert.equal(isValidPosition({ x: 0, y: 0 }), true);
    assert.equal(isValidPosition(null), false);
    assert.equal(isValidPosition({ x: '100', y: 200 }), false);
    assert.equal(isValidPosition({ x: NaN, y: 200 }), false);
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
  });

  test('Socket.IO transport rejoins the voice room after reconnecting', () => {
    const transport = new SocketIOSignalingTransport();
    const socketHandlers = new Map();
    const emittedEvents = [];
    transport.socket = {
      connected: true,
      id: 'socket-1',
      on(event, handler) {
        socketHandlers.set(event, handler);
      },
      emit(event, payload) {
        emittedEvents.push({ event, payload });
      },
    };
    transport.userId = 'user-1';
    transport.officeId = 'office-1';
    transport.position = { x: 10, y: 20 };

    transport._bindSocketEvents();
    socketHandlers.get('connect')();
    transport.socket.connected = false;
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
  });
});
