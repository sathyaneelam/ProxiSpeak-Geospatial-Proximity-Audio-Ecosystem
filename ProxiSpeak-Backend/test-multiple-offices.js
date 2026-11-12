
const { io } = require("socket.io-client");

const clientA = io("http://localhost:3000");
const clientB = io("http://localhost:3000");

const officeA = `office-A-${Date.now()}`;
const officeB = `office-B-${Date.now()}`;

let joinedA = false;
let joinedB = false;
let crossOfficeNotification = false;
let finished = false;
let timeout;

function finishTest() {
  if (finished) return;
  finished = true;

  clearTimeout(timeout);
  clientA.disconnect();
  clientB.disconnect();

  console.log("\n--- Multiple Offices Test Results ---");
  console.log(joinedA ? "PASS: Client A joined Office A" : "FAIL: Client A joined Office A");
  console.log(joinedB ? "PASS: Client B joined Office B" : "FAIL: Client B joined Office B");
  console.log(
    !crossOfficeNotification
      ? "PASS: No cross-office user:joined notification"
      : "FAIL: Cross-office notification received"
  );

  if (!joinedA || !joinedB || crossOfficeNotification) {
    process.exitCode = 1;
  }
}

function joinOffice(client, officeId, displayName) {
  return new Promise((resolve, reject) => {
    client.emit("office:join", { officeId, displayName }, (response) => {
      if (response && response.status === "success") {
        resolve(response);
      } else {
        reject(new Error(`Join failed: ${JSON.stringify(response)}`));
      }
    });
  });
}

let readyCount = 0;
let started = false;

function tryStart() {
  readyCount++;
  if (readyCount < 2 || started || finished) return;
  started = true;
  runTest();
}

clientA.on("connect", tryStart);
clientB.on("connect", tryStart);

clientA.on("user:joined", (data) => {
  if (data.displayName === "Client B") {
    crossOfficeNotification = true;
    console.log("FAIL: Client A received Client B's join notification");
  }
});

clientB.on("user:joined", (data) => {
  if (data.displayName === "Client A") {
    crossOfficeNotification = true;
    console.log("FAIL: Client B received Client A's join notification");
  }
});

async function runTest() {
  try {
    const responseA = await joinOffice(clientA, officeA, "Client A");
    joinedA = responseA.officeId === officeA;
    console.log(joinedA ? "PASS: Client A joined Office A" : "FAIL: Client A joined Office A");

    const responseB = await joinOffice(clientB, officeB, "Client B");
    joinedB = responseB.officeId === officeB;
    console.log(joinedB ? "PASS: Client B joined Office B" : "FAIL: Client B joined Office B");

    // Allow any unexpected cross-office notification to arrive.
    setTimeout(finishTest, 500);
  } catch (error) {
    console.error("Test error:", error.message);
    finishTest();
  }
}

timeout = setTimeout(() => {
  console.error("Timed out waiting for clients to connect.");
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
