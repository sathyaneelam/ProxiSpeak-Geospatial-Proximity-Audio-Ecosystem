
const bcrypt = require("bcryptjs");
const User = require("../models/User");

// SIGNUP API
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
        message:
          "Display name, valid email and password of at least 8 characters are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

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

// LOGIN API WITH SESSION CREATION
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      !email.trim() ||
      typeof password !== "string" ||
      !password
    ) {
      return res.status(400).json({
        status: "error",
        message: "Email and password are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({
      email: normalizedEmail,
    }).select("+passwordHash");

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Invalid email or password",
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        status: "error",
        message: "Invalid email or password",
      });
    }

    req.session.regenerate((regenerateError) => {
      if (regenerateError) {
        return next(regenerateError);
      }

      req.session.userId = user._id.toString();

      req.session.save((saveError) => {
        if (saveError) {
          return next(saveError);
        }

        return res.status(200).json({
          status: "success",
          message: "Login successful",
          data: {
            id: user._id,
            displayName: user.displayName,
            email: user.email,
          },
        });
      });
    });
  } catch (error) {
    next(error);
  }
}

// VERIFY LOGIN SESSION API
async function getCurrentUser(req, res, next) {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
      });
    }

    const user = await User.findById(req.session.userId);

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "User session is invalid",
      });
    }

    return res.status(200).json({
      status: "success",
      message: "User session verified",
      data: {
        id: user._id,
        displayName: user.displayName,
        email: user.email,
      },
    });
  } catch (error) {
    next(error);
  }
}

// LOGOUT API
async function logout(req, res, next) {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
      });
    }

    req.session.destroy((error) => {
      if (error) {
        return next(error);
      }

      res.clearCookie("proxispeak.sid", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite:
          process.env.NODE_ENV === "production" ? "none" : "lax",
        path: "/",
      });

      return res.status(200).json({
        status: "success",
        message: "Logout successful",
      });
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  signup,
  login,
  getCurrentUser,
  logout,
};
