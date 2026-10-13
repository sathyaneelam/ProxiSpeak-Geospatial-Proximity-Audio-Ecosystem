
const { io } = require("socket.io-client");

const clientA = io("http://localhost:3000");
const clientB = io("http://localhost:3000");

let receivedMovement = false;

clientB.on("avatar:moved", (data) => {
  receivedMovement = true;
  console.log("Client B received movement:", data);

  clientA.disconnect();
  clientB.disconnect();
});

clientA.on("connect", () => {
  console.log("Client A connected:", clientA.id);
  checkReady();
});

clientB.on("connect", () => {
  console.log("Client B connected:", clientB.id);
  checkReady();
});

function checkReady() {
  if (clientA.connected && clientB.connected && !sentMovement) {
    sentMovement = true;

    clientA.emit("avatar:move", {
      x: 350,
      y: 275,
    });
  }
}

let sentMovement = false;

setTimeout(() => {
  if (!receivedMovement) {
    console.error("Test failed: movement was not received.");
    clientA.disconnect();
    clientB.disconnect();
    process.exitCode = 1;
  }
}, 5000);
