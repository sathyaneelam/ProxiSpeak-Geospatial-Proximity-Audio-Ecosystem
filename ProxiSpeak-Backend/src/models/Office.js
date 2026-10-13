const mongoose = require("mongoose");

const officeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    width: {
      type: Number,
      default: 1000,
      min: 1,
    },
    height: {
      type: Number,
      default: 700,
      min: 1,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Office", officeSchema);