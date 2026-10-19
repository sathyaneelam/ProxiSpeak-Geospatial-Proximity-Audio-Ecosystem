
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const app = express();
const server = http.createServer(app);
app.use(cors());
app.use(express.json());
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});
app.get("/", (req, res) => {
  res.json({
    message: "ProxiSpeak Backend is running!",
    status: "success",
  });
});
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
console.log(`ProxiSpeak backend running on port ${PORT}`);
});
