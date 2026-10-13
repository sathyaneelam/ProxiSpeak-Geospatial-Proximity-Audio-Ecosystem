const officeManager = require("../services/officeManager");
const registerOfficeHandlers = require("./officeHandler");
const registerAvatarHandlers = require("./avatarHandler");
const registerWebRTCHandlers = require("./webrtcHandler");
const { registerDisconnectHandler, startStalePeerCleaner } = require("./disconnectHandler");

/**
 * Initializes all Socket.io event handlers, rooms, and background cleaners.
 * @param {object} io - Socket.io Server instance
 */
function initSockets(io) {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Initial default office room assignment for backward compatibility
    socket.join("office:default-office");
    officeManager.joinOffice(socket.id, {
      officeId: "default-office",
      userId: socket.id,
      displayName: "Guest",
      x: 0,
      y: 0,
    });

    registerOfficeHandlers(io, socket);
    registerAvatarHandlers(io, socket);
    registerWebRTCHandlers(io, socket);
    registerDisconnectHandler(io, socket);
  });

  // Start background cleaner for inactive/stale peers
  startStalePeerCleaner(io);

  return io;
}

module.exports = { initSockets };
