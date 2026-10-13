const mongoose = require("mongoose");

/**
 * Connect to MongoDB using environment variables or a provided URI.
 * Configured for flat 2D geospatial indexing and resilient connection handling.
 *
 * @param {string} [uri] - Optional MongoDB URI (defaults to process.env.MONGODB_URI)
 * @param {object} [options] - Optional Mongoose connection options
 * @returns {Promise<mongoose.Connection>}
 */
async function connectDB(uri = process.env.MONGODB_URI, options = {}) {
  const mongoURI = uri || process.env.MONGODB_URI;

  if (!mongoURI) {
    const errorMsg = "MongoDB connection failed: MONGODB_URI environment variable is not defined";
    console.error(errorMsg);
    if (process.env.NODE_ENV !== "test" && options.exitOnError !== false) {
      process.exit(1);
    }
    throw new Error(errorMsg);
  }

  const defaultOptions = {
    autoIndex: true, // Auto-build 2D planar indexes in development/test
    serverSelectionTimeoutMS: options.serverSelectionTimeoutMS || 5000,
    ...options
  };

  try {
    await mongoose.connect(mongoURI, defaultOptions);
    console.log("MongoDB connected successfully");
    return mongoose.connection;
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    if (process.env.NODE_ENV !== "test" && options.exitOnError !== false) {
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Disconnect from MongoDB (useful for test teardown and graceful shutdown).
 */
async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log("MongoDB disconnected successfully");
  }
}

/**
 * Get current MongoDB connection status.
 * 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
 */
function getConnectionStatus() {
  const states = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting"
  };
  return {
    state: states[mongoose.connection.readyState] || "unknown",
    readyState: mongoose.connection.readyState,
    host: mongoose.connection.host,
    name: mongoose.connection.name
  };
}

module.exports = connectDB;
module.exports.connectDB = connectDB;
module.exports.disconnectDB = disconnectDB;
module.exports.getConnectionStatus = getConnectionStatus;