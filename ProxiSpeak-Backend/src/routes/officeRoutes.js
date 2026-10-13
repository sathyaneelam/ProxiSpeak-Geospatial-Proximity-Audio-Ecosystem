const express = require("express");
const router = express.Router();

const {
  createOffice,
  getOfficeById,
  getAllOffices,
} = require("../controllers/officeController");

router.post("/", createOffice);
router.get("/", getAllOffices);
router.get("/:id", getOfficeById);

module.exports = router;
