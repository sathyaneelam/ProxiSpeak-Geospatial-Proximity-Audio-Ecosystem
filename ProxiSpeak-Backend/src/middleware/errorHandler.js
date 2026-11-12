
function errorHandler(error, req, res, next) {
  // Pass the error to Express if headers are already sent.
  if (res.headersSent) {
    return next(error);
  }

  // Accept only valid HTTP error status codes (400–599).
  const statusCode =
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status <= 599
      ? error.status
      : 500;

  if (statusCode === 500) {
    console.error(error);
  }

  return res.status(statusCode).json({
    status: "error",
    message:
      statusCode === 500
        ? "Internal server error"
        : error.message,
  });
}

module.exports = errorHandler;
