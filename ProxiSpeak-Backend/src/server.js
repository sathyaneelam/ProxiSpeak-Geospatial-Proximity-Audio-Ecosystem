require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const app = require("./app");
const connectDB = require("./config/database");
const { initSockets } = require("./sockets");
const validateEnv = require("./config/validateEnv");

const server = http.createServer(app);
const frontendOrigin =
  process.env.FRONTEND_ORIGIN || "http://localhost:5173";

const io = new Server(server, {
  cors: {
    origin: frontendOrigin,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Initialize modular socket event handlers and lifecycle management
initSockets(io);

const PORT = process.env.PORT || 3000;

async function startServer(port = PORT) {
  validateEnv();
  await connectDB();

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`ProxiSpeak backend running on port ${port}`);
      resolve({ server, io, app });
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Backend startup failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { app, server, io, startServer };