const bcrypt = require("bcryptjs");
const User = require("../models/User");

async function signup(req, res, next) {
  try {
    const { displayName, email, password } = req.body;

    if (
      typeof displayName !== "string" ||
      !displayName.trim() ||
      typeof email !== "string" ||
      !email.trim() ||
      typeof password !== "string" ||
      password.length < 8
    ) {
      return res.status(400).json({
        status: "error",
        message: "Display name, valid email and password of at least 8 characters are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({
        status: "error",
        message: "Email is already registered",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await User.create({
      displayName: displayName.trim(),
      email: normalizedEmail,
      passwordHash,
    });

    return res.status(201).json({
      status: "success",
      message: "Account created successfully",
      data: {
        id: user._id,
        displayName: user.displayName,
        email: user.email,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        status: "error",
        message: "Email is already registered",
      });
    }

    next(error);
  }
}

module.exports = { signup };