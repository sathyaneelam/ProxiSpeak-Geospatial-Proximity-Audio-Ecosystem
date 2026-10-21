
function errorHandler(err, req, res, next) {
  console.error(err.stack);

  if (res.headersSent) {
    return next(err);
  }

  const statusCode = Number.isInteger(err.status) &&
    err.status >= 400 && err.status < 600
    ? err.status
    : 500;

  const message = statusCode === 500
    ? "Internal server error"
    : err.message || "Request failed";

  res.status(statusCode).json({
    status: "error",
    message,
  });
}

module.exports = errorHandler;
