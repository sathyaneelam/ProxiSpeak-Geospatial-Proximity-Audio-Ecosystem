
function validateJson(req, res, next) {
  if (!req.is("application/json") && req.method !== "GET") {
    return res.status(415).json({
      status: "error",
      message: "Content-Type must be application/json",
    });
  }

  next();
}

module.exports = validateJson;
