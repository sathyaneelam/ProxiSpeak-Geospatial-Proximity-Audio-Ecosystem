require("dotenv").config();

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const mongoose = require("mongoose");
const app = require("../src/app");
const connectDB = require("../src/config/database");
const User = require("../src/models/User");

describe("REST API Integration Tests", () => {
  let server;
  let baseUrl;

  before(async () => {
    await connectDB();

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));

    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    await mongoose.disconnect();
  });

  it("GET / should return 200 and project info", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.project, "ProxiSpeak");
    assert.strictEqual(data.status, "success");
  });

  it("GET /health should return 200 and the complete health response", async () => {
    const res = await fetch(`${baseUrl}/health`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      res.headers.get("content-type").includes("application/json"),
      true
    );

    const data = await res.json();
    assert.deepStrictEqual(data, {
      status: "OK",
      message: "ProxiSpeak server is healthy",
    });
  });

  // NEW SIGNUP TESTS

  it("POST /api/auth/signup should create a new account", async () => {
    const email = `signup${Date.now()}@example.com`;

    try {
      const res = await fetch(`${baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: "Test User",
          email,
          password: "testpass123",
        }),
      });

      assert.strictEqual(res.status, 201);

      const data = await res.json();
      assert.strictEqual(data.status, "success");
      assert.strictEqual(data.data.displayName, "Test User");
      assert.strictEqual(data.data.email, email);
      assert.strictEqual(data.data.passwordHash, undefined);
    } finally {
      await User.deleteOne({ email });
    }
  });

  it("POST /api/auth/signup should reject a password shorter than 8 characters", async () => {
    const res = await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: "Test User",
        email: `short${Date.now()}@example.com`,
        password: "123",
      }),
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.status, "error");
  });

  it("POST /api/auth/signup should reject an already registered email", async () => {
    const email = `duplicate${Date.now()}@example.com`;

    try {
      await User.create({
        displayName: "Existing User",
        email,
        passwordHash: "test-hash",
      });

      const res = await fetch(`${baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: "Another User",
          email,
          password: "testpass123",
        }),
      });

      assert.strictEqual(res.status, 409);
      const data = await res.json();
      assert.strictEqual(data.message, "Email is already registered");
    } finally {
      await User.deleteOne({ email });
    }
  });

  // EXISTING TESTS

  it("POST /api/users without displayName should return 400", async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "   " }),
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.status, "error");
    assert.strictEqual(data.message, "displayName is required");
  });

  it("POST /api/offices without name should return 400", async () => {
    const res = await fetch(`${baseUrl}/api/offices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.status, "error");
    assert.strictEqual(data.message, "Office name is required");
  });

  it("POST /api/positions with invalid userId should return 400", async () => {
    const res = await fetch(`${baseUrl}/api/positions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "invalid-id",
        x: 100,
        y: 100,
      }),
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.status, "error");
  });

  it("POST with non-JSON Content-Type should return a clear 415 error", async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "plain text",
    });

    assert.strictEqual(res.status, 415);
    const data = await res.json();

    assert.deepStrictEqual(data, {
      status: "error",
      message: "Content-Type must be application/json",
    });
  });

  it("GET non-existing route should return a clear 404 error", async () => {
    const res = await fetch(`${baseUrl}/api/non-existent-route`);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(
      res.headers.get("content-type").includes("application/json"),
      true
    );

    const data = await res.json();
    assert.strictEqual(data.status, "error");
    assert.strictEqual(data.message, "Route not found");
  });

  it("POST /api/positions with invalid coordinates should return 400", async () => {
    const res = await fetch(`${baseUrl}/api/positions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "507f1f77bcf86cd799439011",
        x: "invalid",
        y: 100,
      }),
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.status, "error");
  });

  it("POST /api/positions with a non-existing user should return 404", async () => {
    const res = await fetch(`${baseUrl}/api/positions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "507f1f77bcf86cd799439011",
        x: 100,
        y: 100,
      }),
    });

    assert.strictEqual(res.status, 404);
  });

  it("GET /api/positions/:userId should return a saved position", async () => {
    const user = await User.create({ displayName: "Position Test User" });

    try {
      const saveRes = await fetch(`${baseUrl}/api/positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user._id.toString(),
          x: 150,
          y: 200,
        }),
      });

      assert.strictEqual(saveRes.status, 200);

      const res = await fetch(
        `${baseUrl}/api/positions/${user._id.toString()}`
      );

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.data.x, 150);
      assert.strictEqual(data.data.y, 200);
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  it("GET /api/positions/:userId should return 404 when position does not exist", async () => {
    const user = await User.create({ displayName: "No Position User" });

    try {
      const res = await fetch(
        `${baseUrl}/api/positions/${user._id.toString()}`
      );

      assert.strictEqual(res.status, 404);
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });
});