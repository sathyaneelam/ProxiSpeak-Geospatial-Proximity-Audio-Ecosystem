const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const app = require("../src/app");

describe("REST API Integration Tests", () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("GET / should return 200 and project info", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.project, "ProxiSpeak");
    assert.strictEqual(data.status, "success");
  });

  it("GET /health should return 200 and status OK", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, "OK");
  });

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
      body: JSON.stringify({ userId: "invalid-id", x: 100, y: 100 }),
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.status, "error");
  });

  it("POST with non-JSON Content-Type should return 415", async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "plain text",
    });
    assert.strictEqual(res.status, 415);
  });

  it("GET non-existing route should return 404", async () => {
    const res = await fetch(`${baseUrl}/api/non-existent-route`);
    assert.strictEqual(res.status, 404);
  });
});
