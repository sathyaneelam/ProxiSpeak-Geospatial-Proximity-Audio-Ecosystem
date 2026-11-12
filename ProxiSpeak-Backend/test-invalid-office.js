
const { io } = require("socket.io-client");

const client = io("http://localhost:3000");

const invalidInputs = [
  { name: "missing officeId", data: {} },
  { name: "empty officeId", data: { officeId: "" } },
  { name: "whitespace officeId", data: { officeId: "   " } },
  { name: "numeric officeId", data: { officeId: 123 } },
  { name: "missing payload", data: undefined },
];

let passed = 0;
let failed = 0;
let currentIndex = 0;
let finished = false;
let testTimer;
let overallTimer;

function finish() {
  if (finished) return;
  finished = true;

  clearTimeout(testTimer);
  clearTimeout(overallTimer);

  console.log("\n--- Invalid Office Join Test Results ---");
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

    if (error && error.code === "INVALID_OFFICE_ID") {
      gotError = true;
      passed++;
      console.log(`PASS: ${test.name} rejected`);

      clearTimeout(testTimer);
      client.off("error", onError);

      currentIndex++;
      setTimeout(runNextTest, 100);
    }
  }

  client.on("error", onError);
  client.emit("office:join", test.data);

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
  failed = invalidInputs.length - passed;
  finish();
});

overallTimer = setTimeout(() => {
  if (!finished) {
    console.error("Overall test timed out.");
    failed = invalidInputs.length - passed;
    finish();
  }
}, 10000);
