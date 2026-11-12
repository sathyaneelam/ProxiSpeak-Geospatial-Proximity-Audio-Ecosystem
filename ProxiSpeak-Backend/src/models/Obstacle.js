const mongoose = require('mongoose');

/**
 * Schema for obstacles in the virtual 2D office (desks, tables, sofas, counters, walls, etc.)
 * Flat 2D Cartesian plane: coordinates and dimensions are in pixels.
 */
const obstacleSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ['desk', 'table', 'sofa', 'coffee', 'counter', 'wall', 'custom'],
      default: 'desk',
      trim: true
    },
    x: {
      type: Number,
      required: true,
      min: 0,
      description: 'Top-left X coordinate in virtual office pixels'
    },
    y: {
      type: Number,
      required: true,
      min: 0,
      description: 'Top-left Y coordinate in virtual office pixels'
    },
    w: {
      type: Number,
      required: true,
      min: 1,
      description: 'Width in pixels'
    },
    h: {
      type: Number,
      required: true,
      min: 1,
      description: 'Height in pixels'
    },
    label: {
      type: String,
      trim: true,
      default: ''
    },
    isCollidable: {
      type: Boolean,
      default: true
    }
  },
  { _id: true, timestamps: true }
);

module.exports = {
  obstacleSchema,
  Obstacle: mongoose.model('Obstacle', obstacleSchema)
};
