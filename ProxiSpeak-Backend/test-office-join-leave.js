
const { io } = require("socket.io-client");

const clientA = io("http://localhost:3000");
const clientB = io("http://localhost:3000");

const officeId = `test-office-${Date.now()}`;

let joinedA = false;
let joinedB = false;
let receivedUserJoined = false;
let receivedUserLeft = false;
let finished = false;
let timeout;

function finishTest() {
  if (finished) return;
  finished = true;

  clearTimeout(timeout);
  clientA.disconnect();
  clientB.disconnect();

  console.log("\n--- Office Join/Leave Test Results ---");
  console.log(joinedA ? "PASS: Client A joined office" : "FAIL: Client A joined office");
  console.log(joinedB ? "PASS: Client B joined office" : "FAIL: Client B joined office");
  console.log(
    receivedUserJoined
      ? "PASS: Existing client received user:joined"
      : "FAIL: Existing client received user:joined"
  );
  console.log(
    receivedUserLeft
      ? "PASS: Existing client received user:left"
      : "FAIL: Existing client received user:left"
  );

  if (!joinedA || !joinedB || !receivedUserJoined || !receivedUserLeft) {
    process.exitCode = 1;
  }
}

function joinOffice(client, displayName) {
  return new Promise((resolve, reject) => {
    client.emit(
      "office:join",
      { officeId, displayName },
      (response) => {
        if (response && response.status === "success") {
          resolve(response);
        } else {
          reject(new Error(`Office join failed: ${JSON.stringify(response)}`));
        }
      }
    );
  });
}

clientA.on("connect", tryStart);
clientB.on("connect", tryStart);

let readyCount = 0;
let started = false;

function tryStart() {
  readyCount++;
  if (readyCount < 2 || started || finished) return;
  started = true;
  runTest();
}

clientA.on("user:joined", (data) => {
  if (data.displayName === "Client B") {
    receivedUserJoined = true;
    console.log("PASS: Client A received user:joined");
  }
});

clientA.on("user:left", (data) => {
  if (data.displayName === "Client B" || data.userId === clientB.id) {
    receivedUserLeft = true;
    console.log("PASS: Client A received user:left");
    finishTest();
  }
});

async function runTest() {
  try {
    const responseA = await joinOffice(clientA, "Client A");
    joinedA = responseA.officeId === officeId;
    console.log(joinedA ? "PASS: Client A joined office" : "FAIL: Client A joined office");

    await new Promise((resolve) => setTimeout(resolve, 150));

    const responseB = await joinOffice(clientB, "Client B");
    joinedB = responseB.officeId === officeId;
    console.log(joinedB ? "PASS: Client B joined office" : "FAIL: Client B joined office");

    await new Promise((resolve) => setTimeout(resolve, 150));

    clientB.emit("office:leave", (response) => {
      if (!response || response.status !== "success") {
        console.error("Client B leave failed:", response);
        finishTest();
      }
    });
  } catch (error) {
    console.error("Test error:", error.message);
    finishTest();
  }
}

timeout = setTimeout(() => {
  console.error("Timed out waiting for office events.");
  finishTest();
}, 7000);

clientA.on("connect_error", (error) => {
  console.error("Client A connection failed:", error.message);
  finishTest();
});

clientB.on("connect_error", (error) => {
  console.error("Client B connection failed:", error.message);
  finishTest();
});
