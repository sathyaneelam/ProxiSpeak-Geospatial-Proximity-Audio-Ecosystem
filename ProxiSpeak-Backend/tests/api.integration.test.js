
require("dotenv").config();

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const app = require("../src/app");
const connectDB = require("../src/config/database");
const User = require("../src/models/User");
const Office = require("../src/models/Office");
const Position = require("../src/models/Position");

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
      const closePromise = new Promise((resolve) => {
        server.close(resolve);
      });

      server.closeIdleConnections?.();
      server.closeAllConnections?.();

      await closePromise;
    }

    if (app.locals.sessionStore) {
      await app.locals.sessionStore.close();
    }

    await mongoose.disconnect();
  });

  // BASIC API TESTS

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

  // SIGNUP TESTS

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

  // LOGIN TESTS

  it("POST /api/auth/login should log in with correct credentials", async () => {
    const email = `login${Date.now()}@example.com`;
    const password = "testpass123";

    try {
      const passwordHash = await bcrypt.hash(password, 12);

      await User.create({
        displayName: "Login Test User",
        email,
        passwordHash,
      });

      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.status, "success");
      assert.strictEqual(data.message, "Login successful");
      assert.strictEqual(data.data.email, email);
      assert.strictEqual(data.data.passwordHash, undefined);
    } finally {
      await User.deleteOne({ email });
    }
  });

  it("POST /api/auth/login should reject an incorrect password", async () => {
    const email = `wrong${Date.now()}@example.com`;

    try {
      const passwordHash = await bcrypt.hash("correctpass123", 12);

      await User.create({
        displayName: "Login Test User",
        email,
        passwordHash,
      });

      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "wrongpass123",
        }),
      });

      assert.strictEqual(res.status, 401);

      const data = await res.json();
      assert.strictEqual(data.status, "error");
      assert.strictEqual(data.message, "Invalid email or password");
    } finally {
      await User.deleteOne({ email });
    }
  });

  // SESSION TESTS

  it("GET /api/auth/me should reject requests without a login session", async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`);

    assert.strictEqual(res.status, 401);

    const data = await res.json();
    assert.strictEqual(data.status, "error");
    assert.strictEqual(data.message, "Authentication required");
  });

  it("should create, verify and destroy a login session", async () => {
    const email = `session${Date.now()}@example.com`;
    const password = "testpass123";

    try {
      const passwordHash = await bcrypt.hash(password, 12);

      await User.create({
        displayName: "Session Test User",
        email,
        passwordHash,
      });

      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      assert.strictEqual(loginRes.status, 200);

      const cookieHeader = loginRes.headers.get("set-cookie");
      assert.ok(cookieHeader, "Login should return a session cookie");

      const sessionCookie = cookieHeader.split(";")[0];

      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: sessionCookie },
      });

      assert.strictEqual(meRes.status, 200);

      const meData = await meRes.json();
      assert.strictEqual(meData.data.email, email);
      assert.strictEqual(meData.data.displayName, "Session Test User");

      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: sessionCookie,
        },
        body: JSON.stringify({}),
      });

      assert.strictEqual(logoutRes.status, 200);

      const afterLogoutRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: sessionCookie },
      });

      assert.strictEqual(afterLogoutRes.status, 401);
    } finally {
      await User.deleteOne({ email });
    }
  });

  // EXISTING API TESTS

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
        userId: new mongoose.Types.ObjectId().toString(),
        x: "invalid",
        y: 100,
      }),
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.status, "error");
  });

  // OFFICE DATABASE PERSISTENCE TESTS
    it("POST /api/positions with a non-existing user should return 404", async () => {
    const res = await fetch(`${baseUrl}/api/positions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: new mongoose.Types.ObjectId().toString(),
        x: 100,
        y: 100,
      }),
    });

    assert.strictEqual(res.status, 404);
  });

  it("GET /api/positions/:userId should return a saved position", async () => {
    const user = await User.create({
      displayName: "Position Test User",
    });

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
      await Position.deleteOne({ userId: user._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  it("GET /api/positions/:userId should return 404 when position does not exist", async () => {
    const user = await User.create({
      displayName: "No Position User",
    });

    try {
      const res = await fetch(
        `${baseUrl}/api/positions/${user._id.toString()}`
      );

      assert.strictEqual(res.status, 404);
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });
  it("POST /api/offices should save an office and GET should retrieve it", async () => {
    const officeName = `Persistence Test Office ${Date.now()}`;
    let officeId;

    try {
      const createRes = await fetch(`${baseUrl}/api/offices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: officeName,
          width: 1200,
          height: 800,
        }),
      });

      assert.strictEqual(createRes.status, 201);
      const created = await createRes.json();

      assert.strictEqual(created.data.name, officeName);
      assert.strictEqual(created.data.width, 1200);
      assert.strictEqual(created.data.height, 800);

      officeId = created.data._id;
      assert.ok(officeId);

      const getRes = await fetch(`${baseUrl}/api/offices/${officeId}`);
      assert.strictEqual(getRes.status, 200);

      const retrieved = await getRes.json();
      assert.strictEqual(retrieved.data._id, officeId);
      assert.strictEqual(retrieved.data.name, officeName);
    } finally {
      if (officeId) {
        await Office.deleteOne({ _id: officeId });
      }
    }
  });

  it("GET /api/offices should return saved offices", async () => {
    const office = await Office.create({
      name: `List Test Office ${Date.now()}`,
    });

    try {
      const res = await fetch(`${baseUrl}/api/offices`);
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.ok(
        data.data.some((item) => item._id === office._id.toString())
      );
    } finally {
      await Office.deleteOne({ _id: office._id });
    }
  });
});