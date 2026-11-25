const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { createProxyDiagnostics } = require("../modules/proxyDiagnostics");

function request(overrides = {}) {
  return {
    method: "GET", path: "/config",
    headers: { "x-proxy-diagnostic": "1" },
    rawHeaders: [],
    app: { get: () => 1 },
    socket: { remoteAddress: "127.0.0.1", remoteFamily: "IPv4" },
    ip: "192.0.2.1", ips: ["192.0.2.1"], protocol: "https",
    ...overrides,
  };
}

test("proxy logging is disabled by default and requires an explicit config probe", () => {
  const logs = [];
  const disabled = createProxyDiagnostics({ logger: (line) => logs.push(line) });
  let next = 0;
  disabled(request(), {}, () => next++);
  const enabled = createProxyDiagnostics({ enabled: true, logger: (line) => logs.push(line) });
  for (const req of [
    request({ headers: {} }),
    request({ path: "/calculate", method: "POST" }),
    request({ path: "/usage" }),
    request({ method: "HEAD" }),
  ]) enabled(req, {}, () => next++);
  assert.equal(next, 5);
  assert.deepEqual(logs, []);
});

test("proxy logs preserve forwarding observations without leaking unrelated request data", () => {
  const logs = [];
  const middleware = createProxyDiagnostics({ enabled: true, logger: (line) => logs.push(line) });
  const res = { unchanged: true };
  let next = 0;
  middleware(request({
    headers: { "x-proxy-diagnostic": "1", "x-forwarded-for": "198.51.100.1, 192.0.2.1",
      "x-forwarded-proto": "https", authorization: "secret-auth", cookie: "secret-cookie" },
    rawHeaders: ["Authorization", "secret-auth", "Cookie", "secret-cookie",
      "X-Forwarded-For", "198.51.100.1", "X-Forwarded-For", "192.0.2.1",
      "X-Forwarded-Proto", "https"],
    originalUrl: "/config?secret-query", body: { patient: "secret-body" },
  }), res, () => next++);
  assert.equal(next, 1);
  assert.deepEqual(res, { unchanged: true });
  assert.ok(logs[0].startsWith("[proxy-diagnostic] "));
  const data = JSON.parse(logs[0].slice("[proxy-diagnostic] ".length));
  assert.equal(data.trustProxy, 1);
  assert.equal(data.socketRemoteAddress, "127.0.0.1");
  assert.equal(data.socketRemoteFamily, "IPv4");
  assert.equal(data.ip, "192.0.2.1");
  assert.deepEqual(data.ips, ["192.0.2.1"]);
  assert.equal(data.xForwardedFor, "198.51.100.1, 192.0.2.1");
  assert.equal(data.xForwardedProto, "https");
  assert.equal(data.protocol, "https");
  assert.equal(data.rawForwardingHeaders.length, 3);
  assert.equal(data.truncated, false);
  assert.ok(!logs[0].includes("secret-"));
});

test("absent forwarding headers and socket values are recorded as null", () => {
  let data;
  const middleware = createProxyDiagnostics({
    enabled: true, logger: (line) => { data = JSON.parse(line.slice("[proxy-diagnostic] ".length)); },
  });
  middleware(request({ socket: {}, ip: undefined, ips: [], protocol: "http" }), {}, () => {});
  assert.equal(data.socketRemoteAddress, null);
  assert.equal(data.socketRemoteFamily, null);
  assert.equal(data.xForwardedFor, null);
  assert.equal(data.xForwardedProto, null);
  assert.equal(data.ip, null);
});

test("log entries and caller-controlled values are bounded and JSON escaped", () => {
  const logs = [];
  const middleware = createProxyDiagnostics({ enabled: true, logger: (line) => logs.push(line) });
  const req = request({
    headers: { "x-proxy-diagnostic": "1", "x-forwarded-for": "forged\nline" },
    rawHeaders: Array.from({ length: 12 }, () => ["X-Forwarded-For", "x".repeat(2000)]).flat(),
  });
  let next = 0;
  for (let i = 0; i < 55; i++) middleware(req, {}, () => next++);
  assert.equal(next, 55);
  assert.equal(logs.length, 50);
  assert.ok(!logs[0].includes("\n"));
  const data = JSON.parse(logs[0].slice("[proxy-diagnostic] ".length));
  assert.equal(data.rawForwardingHeaders.length, 8);
  assert.equal(data.rawForwardingHeaders[0].value.length, 1024);
  assert.equal(data.truncated, true);
});

test("real Express one-hop observations reflect ordinary and forged-header requests without exposing logs", async (t) => {
  const logs = [];
  const app = express();
  app.set("trust proxy", 1);
  app.use(createProxyDiagnostics({ enabled: true, logger: (line) => logs.push(line) }));
  app.get("/config", (req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  async function get(headers) {
    return new Promise((resolve, reject) => {
      http.get({ hostname: "127.0.0.1", port: server.address().port, path: "/config", headers }, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          assert.equal(res.statusCode, 200);
          resolve(JSON.parse(body));
        });
      }).on("error", reject);
    });
  }
  assert.deepEqual(await get({ "X-Proxy-Diagnostic": "1" }), { ok: true });
  assert.deepEqual(await get(["Host", "127.0.0.1", "X-Proxy-Diagnostic", "1",
    "X-Forwarded-For", "198.51.100.123", "X-Forwarded-For", "192.0.2.25",
    "X-Forwarded-Proto", "https"]), { ok: true });
  const data = logs.map((line) => JSON.parse(line.slice("[proxy-diagnostic] ".length)));
  assert.equal(data[0].ip, "127.0.0.1");
  assert.equal(data[0].xForwardedFor, null);
  assert.equal(data[1].ip, "192.0.2.25");
  assert.equal(data[1].rawForwardingHeaders.length, 3);
  // This local server has no LiteSpeed in front: the test verifies observations,
  // not whether the production proxy sanitises forged headers.
});
