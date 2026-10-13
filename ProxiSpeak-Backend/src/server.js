require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const app = require("./app");
const connectDB = require("./config/database");
const { initSockets } = require("./sockets");

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Initialize modular socket event handlers and lifecycle management
initSockets(io);

const PORT = process.env.PORT || 3000;

async function startServer(port = PORT) {
  await connectDB();
  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`ProxiSpeak backend running on port ${port}`);
      resolve({ server, io, app });
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, server, io, startServer };