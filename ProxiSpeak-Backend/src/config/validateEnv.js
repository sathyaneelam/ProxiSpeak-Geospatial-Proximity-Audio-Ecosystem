function validateEnv() {
  const requiredVariables = [
    "MONGODB_URI",
    "SESSION_SECRET",
    "FRONTEND_ORIGIN",
  ];

  const missingVariables = requiredVariables.filter(
    (key) => !process.env[key] || !process.env[key].trim()
  );

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVariables.join(", ")}`
    );
  }

  if (
    process.env.SESSION_SECRET.length < 32 ||
    process.env.SESSION_SECRET === "replace-with-a-long-random-secret"
  ) {
    throw new Error(
      "SESSION_SECRET must be a secure random value of at least 32 characters."
    );
  }

  try {
    new URL(process.env.FRONTEND_ORIGIN);
  } catch {
    throw new Error("FRONTEND_ORIGIN must be a valid URL.");
  }
}

module.exports = validateEnv;