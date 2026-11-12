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
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
      sparse: true,
    },
    passwordHash: {
      type: String,
      select: false,
    },
    avatarColor: {
      type: String,
      default: "#3b82f6",
      trim: true,
    },
    avatarUrl: {
      type: String,
      default: "",
      trim: true,
    },
    currentOfficeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Office",
      default: null,
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    lastActive: {
      type: Date,
      default: Date.now,
    },
    socketId: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
