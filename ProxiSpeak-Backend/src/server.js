require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const app = require("./app");
const connectDB = require("./config/database");
const { initSockets } = require("./sockets");
const validateEnv = require("./config/validateEnv");

const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:5173",
  "https://proxispeak-frontend.onrender.com",
  ...(process.env.FRONTEND_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

initSockets(io);

const PORT = process.env.PORT || 3000;

async function startServer(port = PORT) {
  validateEnv();
  await connectDB();

  try {
    const { seedDefaultOffice } = require("./services/officeService");
    await seedDefaultOffice();
    console.log("Default office 'office-01' seeded with furniture obstacles.");
  } catch (error) {
    console.warn("Default office seeding warning:", error.message);
  }

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
