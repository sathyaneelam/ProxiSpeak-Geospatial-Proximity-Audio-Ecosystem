
const test = require("node:test");
const assert = require("node:assert");
const errorHandler = require("../src/middleware/errorHandler");

function runHandler(err, headersSent = false) {
  let statusCode;
  let responseBody;
  let nextError;

  const res = {
    headersSent,
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };

  const next = (error) => {
    nextError = error;
  };

  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    errorHandler(err, {}, res, next);
  } finally {
    console.error = originalConsoleError;
  }

  return { statusCode, responseBody, nextError };
}

test("returns a safe response for internal server errors", () => {
  const result = runHandler({
    status: 500,
    message: "database password leaked",
    stack: "test stack",
  });

  assert.strictEqual(result.statusCode, 500);
  assert.deepStrictEqual(result.responseBody, {
    status: "error",
    message: "Internal server error",
  });
});

test("uses valid client error status codes", () => {
  const result = runHandler({
    status: 400,
    message: "Invalid request",
    stack: "test stack",
  });

  assert.strictEqual(result.statusCode, 400);
  assert.strictEqual(result.responseBody.message, "Invalid request");
});

test("defaults invalid status codes to 500", () => {
  const result = runHandler({
    status: 200,
    message: "Unexpected error",
    stack: "test stack",
  });

  assert.strictEqual(result.statusCode, 500);
});

test("passes errors onward when response headers were sent", () => {
  const error = { message: "Already sent", stack: "test stack" };
  const result = runHandler(error, true);

  assert.strictEqual(result.nextError, error);
});
test("handles errors without a stack trace", () => {
  const result = runHandler({
    status: 500,
    message: "Unexpected failure",
  });

  assert.strictEqual(result.statusCode, 500);
  assert.deepStrictEqual(result.responseBody, {
    status: "error",
    message: "Internal server error",
  });
});