
const { io } = require("socket.io-client");

const clientA = io("http://localhost:3000");
const clientB = io("http://localhost:3000");

let receivedMovement = false;
let receivedEnter = false;
let receivedLeave = false;
let finished = false;
let readyCount = 0;
let timeout;

function finishTest() {
  if (finished) return;
  finished = true;

  clearTimeout(timeout);
  clientA.disconnect();
  clientB.disconnect();

  console.log("\n--- Proximity Test Results ---");
  console.log(
    receivedMovement
      ? "PASS: Avatar movement broadcast"
      : "FAIL: Avatar movement broadcast"
  );
  console.log(
    receivedEnter
      ? "PASS: proximity:enter"
      : "FAIL: proximity:enter"
  );
  console.log(
    receivedLeave
      ? "PASS: proximity:leave"
      : "FAIL: proximity:leave"
  );

  if (!receivedMovement || !receivedEnter || !receivedLeave) {
    process.exitCode = 1;
  }
}

function moveAvatar(client, x, y) {
  return new Promise((resolve, reject) => {
    client.emit("avatar:move", { x, y });

    // Allow time for the server to process the movement.
    setTimeout(resolve, 250);
  });
}

clientA.on("connect", () => {
  console.log("Client A connected:", clientA.id);
  startWhenReady();
});

clientB.on("connect", () => {
  console.log("Client B connected:", clientB.id);
  startWhenReady();
});

clientB.on("avatar:moved", (data) => {
  if (data.x === 150 && data.y === 0) {
    receivedMovement = true;
    console.log("PASS: Client B received movement:", data);
  }
});

clientA.on("proximity:enter", (data) => {
  if (data.peerSocketId === clientB.id) {
    receivedEnter = true;
    console.log("Client A received proximity:enter:", data);
  }
});

clientA.on("proximity:leave", (data) => {
  if (data.peerSocketId === clientB.id && receivedEnter) {
    receivedLeave = true;
    console.log("Client A received proximity:leave:", data);
    finishTest();
  }
});

async function startWhenReady() {
  readyCount++;
  if (readyCount !== 2 || finished) return;

  try {
    // Establish starting positions.
    await moveAvatar(clientA, 0, 0);
    await moveAvatar(clientB, 200, 0);

    // Move A within earshot: distance = 50.
    await moveAvatar(clientA, 150, 0);

    // Move A outside earshot: distance = 200.
    await moveAvatar(clientA, 0, 0);
  } catch (error) {
    console.error("Test error:", error);
    finishTest();
  }
}

timeout = setTimeout(() => {
  console.error("Timed out waiting for proximity events.");
  finishTest();
}, 5000);
