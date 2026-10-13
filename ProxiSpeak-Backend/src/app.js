const helmet = require("helmet");
const express = require("express");
const cors = require("cors");

const userRoutes = require("./routes/userRoutes");
const positionRoutes = require("./routes/positionRoutes");
const officeRoutes = require("./routes/officeRoutes");
const errorHandler = require("./middleware/errorHandler");
const validateJson = require("./middleware/validateJson");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(validateJson);

app.get("/", (req, res) => {
  res.json({
    project: "ProxiSpeak",
    message: "Backend API is running successfully",
    status: "success",
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "ProxiSpeak server is healthy",
  });
});

app.use("/api/users", userRoutes);
app.use("/api/positions", positionRoutes);
app.use("/api/offices", officeRoutes);

app.use((req, res, next) => {
  const error = new Error("Route not found");
  error.status = 404;
  next(error);
});

app.use(errorHandler);

module.exports = app;
