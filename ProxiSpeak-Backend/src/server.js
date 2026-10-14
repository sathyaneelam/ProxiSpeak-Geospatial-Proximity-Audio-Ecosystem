require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const app = require("./app");
const connectDB = require("./config/database");
const { setupSignalingServer } = require("./signaling/signalingServer");

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Initialize proximity WebRTC signaling server (1000x600 canvas, 100px earshot relay)
setupSignalingServer(io);

const PORT = process.env.PORT || 3000;

async function startServer() {
  if (process.env.MONGODB_URI) {
    try {
      await connectDB();
    } catch (err) {
      console.warn("MongoDB connection warning:", err.message);
    }
  }
  return new Promise((resolve) => {
    server.listen(PORT, () => {
      console.log(`ProxiSpeak backend running on port ${PORT}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { server, io, startServer, PORT };