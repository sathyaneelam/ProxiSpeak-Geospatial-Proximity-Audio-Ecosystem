const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
  type: String,
  lowercase: true,
  trim: true,
  unique: true,
  sparse: true,
},
passwordHash: {
  type: String,
  select: false,
},
    socketId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);