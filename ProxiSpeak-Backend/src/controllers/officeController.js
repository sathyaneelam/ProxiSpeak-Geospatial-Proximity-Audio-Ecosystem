const mongoose = require("mongoose");
const Office = require("../models/Office");
async function createOffice(req, res, next) {
  try {
    const { name, width, height } = req.body;
    if (typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Office name is required",
      });
    }
    const office = await Office.create({
      name: name.trim(),
      ...(width !== undefined && { width }),
      ...(height !== undefined && { height }),
    });
    return res.status(201).json({
      status: "success",
      message: "Office created successfully",
      data: office,
    });
  } catch (error) {
    next(error);
  }
}
async function getOfficeById(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid office ID format",
      });
    }
    const office = await Office.findById(id);
    if (!office) {
      return res.status(404).json({
        status: "error",
        message: "Office not found",
      });
    }
    return res.status(200).json({
      status: "success",
      data: office,
    });
  } catch (error) {
    next(error);
  }
}
async function getAllOffices(req, res, next) {
  try {
    const offices = await Office.find();
    return res.status(200).json({
      status: "success",
      data: offices,
    });
  } catch (error) {
    next(error);
  }
}
module.exports = { createOffice, getOfficeById, getAllOffices };
