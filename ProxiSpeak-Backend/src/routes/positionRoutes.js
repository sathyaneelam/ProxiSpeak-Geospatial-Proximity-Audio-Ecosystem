const express = require("express");
const router = express.Router();

const {
  savePosition,
  getPositionByUserId,
} = require("../controllers/positionController");

router.post("/", savePosition);
router.get("/:userId", getPositionByUserId);

module.exports = router;
