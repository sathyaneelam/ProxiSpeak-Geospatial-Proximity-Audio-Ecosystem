const mongoose = require("mongoose");
const User = require("../models/User");

async function createUser(req, res, next) {
  try {
    const { displayName } = req.body;

    if (
      typeof displayName !== "string" ||
      displayName.trim().length === 0
    ) {
      return res.status(400).json({
        status: "error",
        message: "displayName is required",
      });
    }

    const user = await User.create({
      displayName: displayName.trim(),
    });

    res.status(201).json({
      status: "success",
      message: "User created successfully",
      data: user,
    });
  } catch (error) {
    next(error);
  }
}

async function getUserById(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid user ID format",
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    res.status(200).json({
      status: "success",
      data: user,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { createUser, getUserById };