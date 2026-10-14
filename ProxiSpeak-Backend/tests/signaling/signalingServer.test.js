const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { Server } = require('socket.io');
const { io: Client } = require('socket.io-client');

const {
  SIGNALING_EVENTS,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  EARSHOT_RADIUS,
  isValidPosition,
  isValidSdpPayload,
  isValidIceCandidatePayload,
  createOfferPayload,
  createAnswerPayload,
  createIceCandidatePayload,
} = require('../../src/signaling/signalingContract');

const {
  setupSignalingServer,
  clamp,
  calculateSpatialGain,
  calculateStereoPan,
} = require('../../src/signaling/signalingServer');

describe('Signaling Contract & Server Proximity Relay', () => {
  describe('Signaling Contract Specifications', () => {
    it('should have exact agreed event names matching origin/Sathya-Audio contract', () => {
      assert.strictEqual(SIGNALING_EVENTS.VOICE_JOIN, 'voice:join');
      assert.strictEqual(SIGNALING_EVENTS.VOICE_USER_JOINED, 'voice:user-joined');
      assert.strictEqual(SIGNALING_EVENTS.VOICE_LEAVE, 'voice:leave');
      assert.strictEqual(SIGNALING_EVENTS.VOICE_USER_LEFT, 'voice:user-left');
      assert.strictEqual(SIGNALING_EVENTS.PROXIMITY_UPDATE, 'proximity:position-update');
      assert.strictEqual(SIGNALING_EVENTS.WEBRTC_OFFER, 'webrtc:offer');
      assert.strictEqual(SIGNALING_EVENTS.WEBRTC_ANSWER, 'webrtc:answer');
      assert.strictEqual(SIGNALING_EVENTS.WEBRTC_ICE_CANDIDATE, 'webrtc:ice-candidate');
      assert.strictEqual(SIGNALING_EVENTS.WEBRTC_DISCONNECT, 'webrtc:peer-disconnect');
    });

    it('should enforce 1000x600 canvas and 100px earshot radius constants', () => {
      assert.strictEqual(CANVAS_WIDTH, 1000);
      assert.strictEqual(CANVAS_HEIGHT, 600);
      assert.strictEqual(EARSHOT_RADIUS, 100);
    });

    it('should validate 2D coordinates with isValidPosition', () => {
      assert.strictEqual(isValidPosition({ x: 500, y: 300 }), true);
      assert.strictEqual(isValidPosition({ x: 0, y: 0 }), true);
      assert.strictEqual(isValidPosition(null), false);
      assert.strictEqual(isValidPosition({ x: '500', y: 300 }), false);
      assert.strictEqual(isValidPosition({ x: NaN, y: 300 }), false);
      assert.strictEqual(isValidPosition({}), false);
    });

    it('should validate WebRTC SDP and ICE Candidate payload shapes', () => {
      const offer = createOfferPayload({
        fromUserId: 'user-a',
        toUserId: 'user-b',
        officeId: 'office-01',
        sdp: { type: 'offer', sdp: 'dummy-offer-sdp' },
      });
      assert.strictEqual(isValidSdpPayload(offer), true);
      assert.strictEqual(isValidSdpPayload({ ...offer, fromUserId: '' }), false);
      assert.strictEqual(isValidSdpPayload({ ...offer, sdp: null }), false);

      const ice = createIceCandidatePayload({
        fromUserId: 'user-a',
        toUserId: 'user-b',
        officeId: 'office-01',
        candidate: { candidate: 'candidate:1 1 UDP ...', sdpMid: '0', sdpMLineIndex: 0 },
      });
      assert.strictEqual(isValidIceCandidatePayload(ice), true);
      assert.strictEqual(isValidIceCandidatePayload({ ...ice, candidate: null }), false);
    });
  });

  describe('Attenuation & Panning Formulas', () => {
    it('attenuation formula: t = clamp(d/100, 0, 1); gain = 1 - (3t^2 - 2t^3)', () => {
      // d = 0 => gain = 1.0
      assert.strictEqual(calculateSpatialGain(0), 1.0);
      // d = 25 => t = 0.25 => gain = 0.8438
      assert.strictEqual(calculateSpatialGain(25), 0.8438);
      // d = 50 => t = 0.5 => gain = 0.5
      assert.strictEqual(calculateSpatialGain(50), 0.5);
      // d = 75 => t = 0.75 => gain = 0.1563
      assert.strictEqual(calculateSpatialGain(75), 0.1563);
      // d = 100 => gain = 0.0
      assert.strictEqual(calculateSpatialGain(100), 0.0);
      // d > 100 => clamped to 0.0
      assert.strictEqual(calculateSpatialGain(150), 0.0);
    });

    it('panning formula: Pan = clamp(dx/100, -1, 1)', () => {
      // dx = -100 => -1.0
      assert.strictEqual(calculateStereoPan(500, 400), -1.0);
      // dx = 0 => 0.0
      assert.strictEqual(calculateStereoPan(500, 500), 0.0);
      // dx = +100 => +1.0
      assert.strictEqual(calculateStereoPan(500, 600), 1.0);
      // dx = -50 => -0.5
      assert.strictEqual(calculateStereoPan(500, 450), -0.5);
      // dx = +50 => +0.5
      assert.strictEqual(calculateStereoPan(500, 550), 0.5);
      // dx clamped beyond radius
      assert.strictEqual(calculateStereoPan(500, 200), -1.0);
      assert.strictEqual(calculateStereoPan(500, 900), 1.0);
    });
  });

  describe('Server Proximity Relay Integration', () => {
    let httpServer;
    let ioServer;
    let serverPort;
    let clientA;
    let clientB;
    let clientC;

    before(async () => {
      httpServer = http.createServer();
      ioServer = new Server(httpServer, {
        cors: { origin: '*' },
      });
      setupSignalingServer(ioServer);

      await new Promise((resolve) => {
        httpServer.listen(0, () => {
          serverPort = httpServer.address().port;
          resolve();
        });
      });
    });

    after(async () => {
      if (clientA) clientA.disconnect();
      if (clientB) clientB.disconnect();
      if (clientC) clientC.disconnect();
      if (ioServer) ioServer.close();
      if (httpServer) {
        await new Promise((resolve) => httpServer.close(resolve));
      }
    });

    it('should connect clients and register their positions in the 2D office', async () => {
      clientA = Client(`http://localhost:${serverPort}`);
      clientB = Client(`http://localhost:${serverPort}`);
      clientC = Client(`http://localhost:${serverPort}`);

      await Promise.all([
        new Promise((resolve) => clientA.on('connect', resolve)),
        new Promise((resolve) => clientB.on('connect', resolve)),
        new Promise((resolve) => clientC.on('connect', resolve)),
      ]);

      // Client A at [500, 300]
      clientA.emit(SIGNALING_EVENTS.VOICE_JOIN, {
        userId: 'user_A',
        officeId: 'office-01',
        position: { x: 500, y: 300 },
      });

      // Client B at [550, 300] (distance 50px <= 100px: WITHIN EARSHOT of A)
      clientB.emit(SIGNALING_EVENTS.VOICE_JOIN, {
        userId: 'user_B',
        officeId: 'office-01',
        position: { x: 550, y: 300 },
      });

      // Client C at [750, 300] (distance 250px > 100px: OUTSIDE EARSHOT of A and B)
      clientC.emit(SIGNALING_EVENTS.VOICE_JOIN, {
        userId: 'user_C',
        officeId: 'office-01',
        position: { x: 750, y: 300 },
      });

      // Allow registration to process
      await new Promise((r) => setTimeout(r, 100));
    });

    it('server should RELAY WebRTC offer between peers WITHIN 100px earshot (A -> B: 50px)', async () => {
      const offerPayload = createOfferPayload({
        fromUserId: 'user_A',
        toUserId: 'user_B',
        officeId: 'office-01',
        sdp: { type: 'offer', sdp: 'v=0 offer-from-A' },
      });

      const receivedOffer = await new Promise((resolve) => {
        clientB.once(SIGNALING_EVENTS.WEBRTC_OFFER, (data) => {
          resolve(data);
        });
        clientA.emit(SIGNALING_EVENTS.WEBRTC_OFFER, offerPayload);
      });

      assert.strictEqual(receivedOffer.fromUserId, 'user_A');
      assert.strictEqual(receivedOffer.toUserId, 'user_B');
      assert.strictEqual(receivedOffer.sdp.type, 'offer');
      assert.strictEqual(receivedOffer.sdp.sdp, 'v=0 offer-from-A');
    });

    it('server should RELAY WebRTC answer between peers WITHIN 100px earshot (B -> A: 50px)', async () => {
      const answerPayload = createAnswerPayload({
        fromUserId: 'user_B',
        toUserId: 'user_A',
        officeId: 'office-01',
        sdp: { type: 'answer', sdp: 'v=0 answer-from-B' },
      });

      const receivedAnswer = await new Promise((resolve) => {
        clientA.once(SIGNALING_EVENTS.WEBRTC_ANSWER, (data) => {
          resolve(data);
        });
        clientB.emit(SIGNALING_EVENTS.WEBRTC_ANSWER, answerPayload);
      });

      assert.strictEqual(receivedAnswer.fromUserId, 'user_B');
      assert.strictEqual(receivedAnswer.toUserId, 'user_A');
      assert.strictEqual(receivedAnswer.sdp.type, 'answer');
    });

    it('server should RELAY WebRTC ICE candidate between peers WITHIN 100px earshot', async () => {
      const icePayload = createIceCandidatePayload({
        fromUserId: 'user_A',
        toUserId: 'user_B',
        officeId: 'office-01',
        candidate: { candidate: 'candidate:dummy', sdpMid: '0', sdpMLineIndex: 0 },
      });

      const receivedIce = await new Promise((resolve) => {
        clientB.once(SIGNALING_EVENTS.WEBRTC_ICE_CANDIDATE, (data) => {
          resolve(data);
        });
        clientA.emit(SIGNALING_EVENTS.WEBRTC_ICE_CANDIDATE, icePayload);
      });

      assert.strictEqual(receivedIce.fromUserId, 'user_A');
      assert.strictEqual(receivedIce.candidate.candidate, 'candidate:dummy');
    });

    it('server should DROP and NOT RELAY WebRTC offer between peers OUTSIDE 100px earshot (A -> C: 250px)', async () => {
      const offerToFarPeer = createOfferPayload({
        fromUserId: 'user_A',
        toUserId: 'user_C',
        officeId: 'office-01',
        sdp: { type: 'offer', sdp: 'v=0 offer-to-far-peer' },
      });

      let clientCReceived = false;
      const handler = () => {
        clientCReceived = true;
      };
      clientC.on(SIGNALING_EVENTS.WEBRTC_OFFER, handler);

      clientA.emit(SIGNALING_EVENTS.WEBRTC_OFFER, offerToFarPeer);

      // Wait 150ms to verify no message arrived at client C
      await new Promise((r) => setTimeout(r, 150));
      clientC.off(SIGNALING_EVENTS.WEBRTC_OFFER, handler);

      assert.strictEqual(
        clientCReceived,
        false,
        'Server must NOT relay WebRTC offer to peer outside 100px earshot'
      );
    });

    it('server should DROP and NOT RELAY WebRTC ICE candidate between peers OUTSIDE 100px earshot (C -> A: 250px)', async () => {
      const iceFromFarPeer = createIceCandidatePayload({
        fromUserId: 'user_C',
        toUserId: 'user_A',
        officeId: 'office-01',
        candidate: { candidate: 'candidate:far', sdpMid: '0', sdpMLineIndex: 0 },
      });

      let clientAReceived = false;
      const handler = () => {
        clientAReceived = true;
      };
      clientA.on(SIGNALING_EVENTS.WEBRTC_ICE_CANDIDATE, handler);

      clientC.emit(SIGNALING_EVENTS.WEBRTC_ICE_CANDIDATE, iceFromFarPeer);

      await new Promise((r) => setTimeout(r, 150));
      clientA.off(SIGNALING_EVENTS.WEBRTC_ICE_CANDIDATE, handler);

      assert.strictEqual(
        clientAReceived,
        false,
        'Server must NOT relay ICE candidate between peers beyond 100px'
      );
    });

    it('server should update proximity when avatar moves and stop relaying when moving out of range', async () => {
      // Move Client B to [800, 300] (now 300px away from A at [500, 300])
      clientB.emit(SIGNALING_EVENTS.PROXIMITY_UPDATE, {
        userId: 'user_B',
        officeId: 'office-01',
        position: { x: 800, y: 300 },
      });

      await new Promise((r) => setTimeout(r, 100));

      // Attempt offer from A to B now that B has moved out of earshot
      const offerAfterMove = createOfferPayload({
        fromUserId: 'user_A',
        toUserId: 'user_B',
        officeId: 'office-01',
        sdp: { type: 'offer', sdp: 'v=0 should-be-dropped' },
      });

      let clientBReceived = false;
      const handler = () => {
        clientBReceived = true;
      };
      clientB.on(SIGNALING_EVENTS.WEBRTC_OFFER, handler);

      clientA.emit(SIGNALING_EVENTS.WEBRTC_OFFER, offerAfterMove);

      await new Promise((r) => setTimeout(r, 150));
      clientB.off(SIGNALING_EVENTS.WEBRTC_OFFER, handler);

      assert.strictEqual(
        clientBReceived,
        false,
        'Offer must be dropped once peer has moved beyond 100px earshot'
      );
    });

    it('server should emit voice:user-left when a user leaves voice or disconnects', async () => {
      const leavePromise = new Promise((resolve) => {
        clientA.once(SIGNALING_EVENTS.VOICE_USER_LEFT, (data) => {
          resolve(data);
        });
      });

      clientB.emit(SIGNALING_EVENTS.VOICE_LEAVE, {
        userId: 'user_B',
        officeId: 'office-01',
      });

      const leaveData = await leavePromise;
      assert.strictEqual(leaveData.userId, 'user_B');
      assert.strictEqual(leaveData.officeId, 'office-01');
    });
  });
});
