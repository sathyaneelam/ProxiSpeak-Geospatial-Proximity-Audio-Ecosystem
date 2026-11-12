const mongoose = require("mongoose");
const { obstacleSchema } = require("./Obstacle");

const zoneSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, default: "", trim: true },
    x: { type: Number, required: true, min: 0 },
    y: { type: Number, required: true, min: 0 },
    w: { type: Number, required: true, min: 1 },
    h: { type: Number, required: true, min: 1 },
    fill: { type: String, default: "#13273a" },
    stroke: { type: String, default: "#2d5676" },
  },
  { _id: true }
);

const officeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    dimensions: {
      width: {
        type: Number,
        required: true,
        default: 1000,
        min: 100,
      },
      height: {
        type: Number,
        required: true,
        default: 600,
        min: 100,
      },
    },
    proximityRadius: {
      type: Number,
      required: true,
      default: 100,
      min: 10,
      max: 2000,
    },
    zones: {
      type: [zoneSchema],
      default: [],
    },
    obstacles: {
      type: [obstacleSchema],
      default: [],
    },
    settings: {
      type: Map,
      of: String,
      default: {},
    },
  },
  { timestamps: true }
);

const Office = mongoose.models.Office || mongoose.model("Office", officeSchema);

module.exports = Office;
module.exports.Office = Office;
module.exports.zoneSchema = zoneSchema;
