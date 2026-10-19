const mongoose = require("mongoose");
const Position = require("../models/Position");
const User = require("../models/User");
async function savePosition(req, res, next) {
  try {
    const { userId, x, y } = req.body;
    // Validate the user ID
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({
        status: "error",
        message: "A valid userId is required",
      });
    }
    // Validate coordinates
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return res.status(400).json({
        status: "error",
        message: "x and y must be valid numbers",
      });
    }
    // Check whether the user exists
    const userExists = await User.findById(userId);

    if (!userExists) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }
    
    const position = await Position.findOneAndUpdate(
      { userId },
      { x, y },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );
    return res.status(200).json({
      status: "success",
      message: "Avatar position saved successfully",
      data: position,
    });
  } catch (error) {
    next(error);
  }
}
async function getPositionByUserId(req, res, next) {
  try {
    const { userId } = req.params;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({
        status: "error",
        message: "A valid userId is required",
      });
    }

    const position = await Position.findOne({ userId });
    if (!position) {
      return res.status(404).json({
        status: "error",
        message: "Position not found for user",
      });
    }

    return res.status(200).json({
      status: "success",
      data: position,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { savePosition, getPositionByUserId };
