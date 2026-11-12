const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { io: ioClient } = require("socket.io-client");

const { initSockets } = require("../src/sockets");
const officeManager = require("../src/services/officeManager");

describe("Socket.io Proximity & WebRTC Signaling Integration Tests", () => {
  let server;
  let ioServer;
  let serverUrl;

  before(async () => {
    const app = express();
    server = http.createServer(app);
    ioServer = new Server(server, { cors: { origin: "*" } });
    initSockets(ioServer);

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (ioServer) ioServer.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    officeManager.reset();
  });

  function connectClient() {
    return new Promise((resolve) => {
      const socket = ioClient(serverUrl, {
        transports: ["websocket"],
        forceNew: true,
      });
      socket.once("connect", () => resolve(socket));
    });
  }

  function waitForEvent(socket, eventName, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for event "${eventName}"`));
      }, timeoutMs);
      socket.once(eventName, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  it("should handle office:join and provide existing peers list with earshot status", async () => {
    const clientA = await connectClient();
    const clientB = await connectClient();

    try {
      const joinAPromise = waitForEvent(clientA, "office:joined");
      clientA.emit("office:join", {
        officeId: "office_tech",
        userId: "user_a",
        displayName: "Alice",
        x: 100,
        y: 100,
      });
      const respA = await joinAPromise;
      assert.strictEqual(respA.status, "success");
      assert.strictEqual(respA.peers.length, 0);

      // Client B joins nearby at (150, 100) -> distance 50px (within 100px earshot)
      const joinBPromise = waitForEvent(clientB, "office:joined");
      const userJoinedPromise = waitForEvent(clientA, "user:joined");
      const proxEnterPromise = waitForEvent(clientA, "proximity:enter");

      clientB.emit("office:join", {
        officeId: "office_tech",
        userId: "user_b",
        displayName: "Bob",
        x: 150,
        y: 100,
      });

      const [respB, userJoined, proxEnter] = await Promise.all([
        joinBPromise,
        userJoinedPromise,
        proxEnterPromise,
      ]);

      assert.strictEqual(respB.status, "success");
      assert.strictEqual(respB.peers.length, 1);
      assert.strictEqual(respB.peers[0].userId, "user_a");
      assert.strictEqual(respB.peers[0].isWithinEarshot, true);
      assert.strictEqual(respB.peers[0].distance, 50);

      assert.strictEqual(userJoined.userId, "user_b");
      assert.strictEqual(proxEnter.peerUserId, "user_b");
      assert.strictEqual(proxEnter.distance, 50);
    } finally {
      clientA.disconnect();
      clientB.disconnect();
    }
  });

  it("should broadcast avatar:moved to same office and maintain cross-office isolation", async () => {
    const clientA = await connectClient();
    const clientB = await connectClient();
    const clientC = await connectClient();

    try {
      await Promise.all([
        new Promise((resolve) => {
          clientA.once("office:joined", resolve);
          clientA.emit("office:join", { officeId: "room_1", userId: "uA", x: 10, y: 10 });
        }),
        new Promise((resolve) => {
          clientB.once("office:joined", resolve);
          clientB.emit("office:join", { officeId: "room_1", userId: "uB", x: 20, y: 20 });
        }),
        new Promise((resolve) => {
          clientC.once("office:joined", resolve);
          clientC.emit("office:join", { officeId: "room_2", userId: "uC", x: 20, y: 20 });
        }),
      ]);

      let clientCReceived = false;
      clientC.on("avatar:moved", () => {
        clientCReceived = true;
      });

      const movedPromiseB = waitForEvent(clientB, "avatar:moved");
      clientA.emit("avatar:move", { x: 55, y: 65 });

      const movedDataB = await movedPromiseB;
      assert.strictEqual(movedDataB.userId, "uA");
      assert.strictEqual(movedDataB.x, 55);
      assert.strictEqual(movedDataB.y, 65);

      // Brief wait to ensure client C definitely did not receive it
      await new Promise((r) => setTimeout(r, 50));
      assert.strictEqual(clientCReceived, false, "Client C in different office must NOT receive movement");
    } finally {
      clientA.disconnect();
      clientB.disconnect();
      clientC.disconnect();
    }
  });

  it("should emit proximity:enter and proximity:leave transitions when moving relative to 100px earshot", async () => {
    const clientA = await connectClient();
    const clientB = await connectClient();

    try {
      await Promise.all([
        new Promise((resolve) => {
          clientA.once("office:joined", resolve);
          clientA.emit("office:join", { officeId: "room_prox", userId: "uA", x: 0, y: 0 });
        }),
        new Promise((resolve) => {
          clientB.once("office:joined", resolve);
          clientB.emit("office:join", { officeId: "room_prox", userId: "uB", x: 200, y: 0 });
        }),
      ]);

      // Move client A into earshot (from x=0 to x=140 -> distance to Bob at x=200 is 60px <= 100px)
      const enterPromiseB = waitForEvent(clientB, "proximity:enter");
      const enterPromiseA = waitForEvent(clientA, "proximity:enter");
      clientA.emit("avatar:move", { x: 140, y: 0 });

      const [enterB, enterA] = await Promise.all([enterPromiseB, enterPromiseA]);
      assert.strictEqual(enterB.peerUserId, "uA");
      assert.strictEqual(enterB.distance, 60);
      assert.strictEqual(enterA.peerUserId, "uB");
      assert.strictEqual(enterA.distance, 60);

      // Move client A back out of earshot (from x=140 to x=-50 -> distance to Bob is 250px > 100px)
      const leavePromiseB = waitForEvent(clientB, "proximity:leave");
      const leavePromiseA = waitForEvent(clientA, "proximity:leave");
      clientA.emit("avatar:move", { x: -50, y: 0 });

      const [leaveB, leaveA] = await Promise.all([leavePromiseB, leavePromiseA]);
      assert.strictEqual(leaveB.peerUserId, "uA");
      assert.strictEqual(leaveB.distance, 250);
      assert.strictEqual(leaveA.peerUserId, "uB");
    } finally {
      clientA.disconnect();
      clientB.disconnect();
    }
  });

  it("should allow WebRTC offer/answer/ICE-candidate signaling when peers are within earshot", async () => {
    const clientA = await connectClient();
    const clientB = await connectClient();

    try {
      await Promise.all([
        new Promise((resolve) => {
          clientA.once("office:joined", resolve);
          clientA.emit("office:join", { officeId: "room_webrtc", userId: "uA", x: 50, y: 50 });
        }),
        new Promise((resolve) => {
          clientB.once("office:joined", resolve);
          // Distance = 50px <= 100px earshot
          clientB.emit("office:join", { officeId: "room_webrtc", userId: "uB", x: 100, y: 50 });
        }),
      ]);

      // 1. Offer
      const offerPromiseB = waitForEvent(clientB, "webrtc:offer");
      clientA.emit("webrtc:offer", {
        to: clientB.id,
        offer: { type: "offer", sdp: "dummy-offer-sdp" },
      });
      const offerData = await offerPromiseB;
      assert.strictEqual(offerData.fromUserId, "uA");
      assert.strictEqual(offerData.offer.sdp, "dummy-offer-sdp");

      // 2. Answer
      const answerPromiseA = waitForEvent(clientA, "webrtc:answer");
      clientB.emit("webrtc:answer", {
        to: clientA.id,
        answer: { type: "answer", sdp: "dummy-answer-sdp" },
      });
      const answerData = await answerPromiseA;
      assert.strictEqual(answerData.fromUserId, "uB");
      assert.strictEqual(answerData.answer.sdp, "dummy-answer-sdp");

      // 3. ICE Candidate
      const candidatePromiseB = waitForEvent(clientB, "webrtc:ice-candidate");
      clientA.emit("webrtc:ice-candidate", {
        to: clientB.id,
        candidate: { candidate: "candidate:123" },
      });
      const candidateData = await candidatePromiseB;
      assert.strictEqual(candidateData.candidate.candidate, "candidate:123");
    } finally {
      clientA.disconnect();
      clientB.disconnect();
    }
  });

  it("should BLOCK WebRTC signaling and return webrtc:error when peers are outside earshot", async () => {
    const clientA = await connectClient();
    const clientB = await connectClient();

    try {
      await Promise.all([
        new Promise((resolve) => {
          clientA.once("office:joined", resolve);
          clientA.emit("office:join", { officeId: "room_out_of_range", userId: "uA", x: 0, y: 0 });
        }),
        new Promise((resolve) => {
          clientB.once("office:joined", resolve);
          // Distance = 300px > 100px earshot
          clientB.emit("office:join", { officeId: "room_out_of_range", userId: "uB", x: 300, y: 0 });
        }),
      ]);

      let bReceivedOffer = false;
      clientB.on("webrtc:offer", () => {
        bReceivedOffer = true;
      });

      const errPromise = waitForEvent(clientA, "webrtc:error");
      clientA.emit("webrtc:offer", {
        to: clientB.id,
        offer: { type: "offer", sdp: "unauthorized-sdp" },
      });

      const err = await errPromise;
      assert.strictEqual(err.status, "error");
      assert.strictEqual(err.code, "PEER_OUT_OF_RANGE");
      assert.strictEqual(err.targetSocketId, clientB.id);

      await new Promise((r) => setTimeout(r, 50));
      assert.strictEqual(bReceivedOffer, false, "Target peer should NEVER receive out-of-range offer");
    } finally {
      clientA.disconnect();
      clientB.disconnect();
    }
  });

  it("should BLOCK WebRTC signaling across different offices with DIFFERENT_OFFICE code", async () => {
    const clientA = await connectClient();
    const clientB = await connectClient();

    try {
      await Promise.all([
        new Promise((resolve) => {
          clientA.once("office:joined", resolve);
          clientA.emit("office:join", { officeId: "office_one", userId: "uA", x: 50, y: 50 });
        }),
        new Promise((resolve) => {
          clientB.once("office:joined", resolve);
          // Same coords, but DIFFERENT office
          clientB.emit("office:join", { officeId: "office_two", userId: "uB", x: 50, y: 50 });
        }),
      ]);

      const errPromise = waitForEvent(clientA, "webrtc:error");
      clientA.emit("webrtc:offer", {
        to: clientB.id,
        offer: { type: "offer", sdp: "cross-office-sdp" },
      });

      const err = await errPromise;
      assert.strictEqual(err.status, "error");
      assert.strictEqual(err.code, "DIFFERENT_OFFICE");
    } finally {
      clientA.disconnect();
      clientB.disconnect();
    }
  });

  it("should handle disconnect and emit user:left and proximity:leave to remaining peers", async () => {
    const clientA = await connectClient();
    const clientB = await connectClient();

    try {
      await Promise.all([
        new Promise((resolve) => {
          clientA.once("office:joined", resolve);
          clientA.emit("office:join", { officeId: "room_dc", userId: "uA", x: 50, y: 50 });
        }),
        new Promise((resolve) => {
          clientB.once("office:joined", resolve);
          // Distance = 40px <= 100px (in earshot)
          clientB.emit("office:join", { officeId: "room_dc", userId: "uB", x: 90, y: 50 });
        }),
      ]);

      const userLeftPromise = waitForEvent(clientB, "user:left");
      const proximityLeavePromise = waitForEvent(clientB, "proximity:leave");

      clientA.disconnect();

      const [userLeft, proximityLeave] = await Promise.all([
        userLeftPromise,
        proximityLeavePromise,
      ]);

      assert.strictEqual(userLeft.userId, "uA");
      assert.strictEqual(proximityLeave.peerUserId, "uA");
      assert.strictEqual(proximityLeave.reason, "disconnected");
    } finally {
      clientB.disconnect();
    }
  });

  it("should emit error event on invalid avatar:move coordinates", async () => {
    const client = await connectClient();

    try {
      const errPromise = waitForEvent(client, "error");
      client.emit("avatar:move", { x: "NaN", y: null });
      const err = await errPromise;
      assert.strictEqual(err.code, "INVALID_COORDINATES");
    } finally {
      client.disconnect();
    }
  });
});
