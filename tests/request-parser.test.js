const { before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const { fork } = require("node:child_process");
const http = require("node:http");
const zlib = require("node:zlib");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const config = require("../config.json");

let child;
let port;
let stderr = "";

before(async () => {
  child = fork(require.resolve("./fixtures/parser-server.js"), [], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    // The test must detect crashes, not inherit a policy that ignores rejections.
    execArgv: ["--unhandled-rejections=strict"],
    env: { NODE_ENV: "test", PATH: process.env.PATH },
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Parser test server startup timed out")), 10000);
    child.once("message", (message) => {
      clearTimeout(timeout);
      resolve(message.port);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Parser test server exited (${code}): ${stderr}`));
    });
  });
});

after(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit");
    child.send("stop");
    const timeout = setTimeout(() => child.kill(), 2000);
    try { await exited; } finally { clearTimeout(timeout); }
  }
});

function request({
  path = "/config", method = "GET", body, encoding, trailingBytes,
  contentType = "application/json",
} = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = contentType;
    if (encoding) headers["Content-Encoding"] = encoding;
    if (trailingBytes) headers["Transfer-Encoding"] = "chunked";
    else if (body !== undefined) headers["Content-Length"] = Buffer.byteLength(body);
    const req = http.request({
      host: "127.0.0.1", port, path, method, headers, agent: false,
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, text, headers: res.headers }));
      res.on("error", reject);
    });
    req.setTimeout(3000, () => req.destroy(new Error("HTTP test timed out")));
    req.on("error", reject);
    if (trailingBytes) {
      req.write(body);
      setTimeout(() => req.end(trailingBytes), 50);
    } else {
      req.end(body);
    }
  });
}

async function assertServerHealthy() {
  assert.equal(child.exitCode, null, stderr);
  assert.equal(child.signalCode, null, stderr);
  const res = await request();
  assert.equal(res.status, 200, res.text);
  assert.equal(JSON.parse(res.text).appName, config.appName);
}

test("entry point still serves config, usage, root and unknown routes", async () => {
  await assertServerHealthy();
  const usage = await request({ path: "/usage" });
  assert.equal(usage.status, 200);
  assert.equal(JSON.parse(usage.text).estimatedRealEpisodes, 0);
  assert.equal(usage.headers["cache-control"], "no-store");
  assert.equal((await request({ path: "/" })).status, 200);
  assert.equal((await request({ path: "/not-a-route" })).status, 400);
});

test("ordinary JSON reaches calculate validation without database access", async () => {
  const res = await request({ path: "/calculate", method: "POST", body: "{}" });
  assert.equal(res.status, 400);
  assert.ok(JSON.parse(res.text).errors.length > 0);
});

test("valid gzip and deflate JSON are still supported", async () => {
  for (const [encoding, compress] of [["gzip", zlib.gzipSync], ["deflate", zlib.deflateSync]]) {
    const res = await request({
      path: "/calculate", method: "POST", encoding, body: compress(Buffer.from("{}")),
    });
    assert.equal(res.status, 400);
    assert.ok(JSON.parse(res.text).errors.length > 0);
  }
});

test("malformed JSON and malformed compression are rejected without a crash", async () => {
  assert.equal((await request({ body: '{"invalid":' })).status, 400);
  assert.equal((await request({ body: "not-gzip", encoding: "gzip" })).status, 400);
  await assertServerHealthy();
});

test("the configured 100kb limit applies to plain and inflated request bodies", async () => {
  assert.equal(config.api.payloadLimit, "100kb");
  const oversized = Buffer.from(JSON.stringify({ value: "x".repeat(103000) }));
  assert.equal((await request({ body: oversized })).status, 413);
  assert.equal((await request({ body: zlib.gzipSync(oversized), encoding: "gzip" })).status, 413);
  await assertServerHealthy();
});

test("unsupported encoding and charset are rejected without a crash", async () => {
  assert.equal((await request({ body: "{}", encoding: "unknown" })).status, 415);
  assert.equal((await request({
    body: zlib.gzipSync(Buffer.from("{}")), encoding: "gzip",
    contentType: "application/json; charset=unsupported",
  })).status, 415);
  await assertServerHealthy();
});

test("compressed frames with immediate or delayed trailing bytes cannot kill the process", async () => {
  for (const [encoding, compress] of [["gzip", zlib.gzipSync], ["deflate", zlib.deflateSync]]) {
    const frame = compress(Buffer.from("{}"));
    const tail = Buffer.from("invalid-trailing-bytes");
    for (const split of [false, true]) {
      const res = await request({
        encoding,
        body: split ? frame : Buffer.concat([frame, tail]),
        trailingBytes: split ? tail : undefined,
      });
      // Depending on decoder buffering, a bad stream is rejected or its valid
      // frame is accepted. The security invariant is no late uncaught error.
      assert.ok([200, 400].includes(res.status), `Unexpected status ${res.status}`);
      await delay(100);
      await assertServerHealthy();
    }
  }
});

test("the lockfile and installed tree contain no pre-patch parser copies", () => {
  const lockfile = require("../package-lock.json");
  const parsers = Object.entries(lockfile.packages)
    .filter(([path]) => /(?:^|\/)node_modules\/body-parser$/.test(path));
  assert.ok(parsers.length > 0);
  for (const [path, entry] of parsers) {
    const [major, minor, patch] = entry.version.split(".").map(Number);
    assert.ok(
      (major === 1 && (minor > 20 || (minor === 20 && patch >= 9))) ||
      (major === 2 && minor >= 4) || major > 2,
      `Unpatched parser in ${path}: ${entry.version}`,
    );
    assert.equal(require(`../${path}/package.json`).version, entry.version);
  }
  const expressPath = require.resolve("express/package.json");
  const { createRequire } = require("node:module");
  const expressRequire = createRequire(expressPath);
  assert.equal(
    expressRequire("body-parser/package.json").version,
    require("body-parser/package.json").version,
  );
});
