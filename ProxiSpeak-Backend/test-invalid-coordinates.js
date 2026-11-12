
const { io } = require("socket.io-client");

const client = io("http://localhost:3000");

const invalidInputs = [
  { name: "missing x", data: { y: 10 } },
  { name: "missing y", data: { x: 10 } },
  { name: "string x", data: { x: "10", y: 20 } },
  { name: "NaN coordinate", data: { x: NaN, y: 20 } },
  { name: "infinite coordinate", data: { x: Infinity, y: 20 } },
  { name: "missing payload", data: undefined },
];

let passed = 0;
let failed = 0;
let currentIndex = 0;
let finished = false;
let testTimer;

function finish() {
  if (finished) return;
  finished = true;
  clearTimeout(testTimer);

  console.log("\n--- Invalid Coordinates Test Results ---");
  console.log(`PASS: ${passed}`);
  console.log(`FAIL: ${failed}`);
  console.log(`TOTAL: ${invalidInputs.length}`);

  client.disconnect();
  if (failed > 0 || passed !== invalidInputs.length) {
    process.exitCode = 1;
  }
}

function runNextTest() {
  if (finished) return;

  if (currentIndex >= invalidInputs.length) {
    finish();
    return;
  }

  const test = invalidInputs[currentIndex];
  let gotError = false;

  function onError(error) {
    if (gotError || finished) return;

    if (error && error.code === "INVALID_COORDINATES") {
      gotError = true;
      passed++;
      console.log(`PASS: ${test.name} rejected`);
      clearTimeout(testTimer);
      currentIndex++;
      setTimeout(runNextTest, 100);
    }
  }

  client.on("error", onError);

  // Socket.IO serializes NaN and Infinity as null.
  // The server should still reject those coordinates.
  client.emit("avatar:move", test.data);

  testTimer = setTimeout(() => {
    if (gotError || finished) return;

    client.off("error", onError);
    failed++;
    console.log(`FAIL: ${test.name} was not rejected correctly`);
    currentIndex++;
    runNextTest();
  }, 1000);
}

client.on("connect", () => {
  console.log("Connected to ProxiSpeak:", client.id);
  runNextTest();
});

client.on("connect_error", (error) => {
  console.error("Connection failed:", error.message);
  finish();
});

setTimeout(() => {
  if (!finished) {
    console.error("Overall test timed out.");
    finish();
  }
}, 10000);
