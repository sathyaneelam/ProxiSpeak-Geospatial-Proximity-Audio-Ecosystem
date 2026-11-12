const express = require("express");
const router = express.Router();

const {
  signup,
  login,
  getCurrentUser,
  logout,
} = require("../controllers/authController");

router.post("/signup", signup);
router.post("/login", login);
router.get("/me", getCurrentUser);
router.post("/logout", logout);

module.exports = router;