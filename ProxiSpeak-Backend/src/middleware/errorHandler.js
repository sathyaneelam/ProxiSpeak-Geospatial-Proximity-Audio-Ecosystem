
function errorHandler(err, req, res, next) {
  console.error(err.stack);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500).json({
    status: "error",
    message:
      err.status && err.status < 500
        ? err.message
        : "Internal server error",
  });
}
module.exports = errorHandler;
