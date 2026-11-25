const { test } = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const { summariseUsage, getUsageStats } = require("../modules/usage");

const start = Date.UTC(2026, 0, 1);
const record = (minutes, overrides = {}) => ({
  episodeType: "real",
  clientIP: "192.0.2.1",
  project: "project-a",
  episodeTimestamp: start + minutes * 60000,
  ...overrides,
});

test("empty table reports zero counts", () => {
  const result = summariseUsage([]);
  assert.deepEqual(result.records, { total: 0, test: 0, real: 0, other: 0 });
  assert.equal(result.estimatedRealEpisodes, 0);
  assert.deepEqual(result.estimatedRealEpisodesByMonth, []);
  assert.equal(result.realRecordsExcludedFromEstimate.total, 0);
});

test("test records are counted once and never affect real deduplication", () => {
  const result = summariseUsage([
    record(0, { episodeType: "test" }),
    record(10),
    record(65),
    record(30, { episodeType: "legacy" }),
  ]);
  assert.deepEqual(result.records, { total: 4, test: 1, real: 2, other: 1 });
  assert.equal(result.estimatedRealEpisodes, 1);
  assert.equal(result.likelyDuplicateRealRecords, 1);
});

test("sorts timestamps and anchors the window to counted records only", () => {
  const result = summariseUsage([record(100), record(50), record(0), record(59.999), record(60)]);
  assert.equal(result.estimatedRealEpisodes, 2);
  assert.equal(result.likelyDuplicateRealRecords, 3);
});

test("identical timestamps are duplicates, but different IPs or projects are not", () => {
  const result = summariseUsage([
    record(0), record(0),
    record(0, { clientIP: "192.0.2.2" }),
    record(0, { project: "project-b" }),
  ]);
  assert.equal(result.estimatedRealEpisodes, 3);
  assert.equal(result.likelyDuplicateRealRecords, 1);
});

test("online and offline records are deduplicated together by occurrence time", () => {
  const result = summariseUsage([
    record(0, { serverCalculations: 1 }),
    record(20, { serverCalculations: 0 }),
    record(60, { serverCalculations: 0, episodeTimestamp: String(start + 3600000) }),
  ]);
  assert.equal(result.estimatedRealEpisodes, 2);
  assert.equal(result.likelyDuplicateRealRecords, 1);
});

test("monthly breakdown counts only estimated real episodes in chronological order", () => {
  const at = (date, overrides = {}) => record(0, {
    episodeTimestamp: Date.parse(date), ...overrides,
  });
  const result = summariseUsage([
    at("2026-03-05T12:00:00Z"),
    at("2025-12-31T12:00:00Z", { clientIP: "192.0.2.2" }),
    at("2026-01-10T12:00:00Z"),
    at("2026-01-10T12:20:00Z"),
    at("2026-01-10T12:00:00Z", { project: "project-b" }),
    at("2026-02-01T12:00:00Z", { episodeType: "test" }),
    at("2026-02-01T12:00:00Z", { episodeType: "legacy" }),
    at("2026-02-01T12:00:00Z", { clientIP: null }),
    record(0, { episodeTimestamp: "invalid" }),
  ]);
  assert.deepEqual(result.estimatedRealEpisodesByMonth, [
    { month: "2025-12", estimatedRealEpisodes: 1 },
    { month: "2026-01", estimatedRealEpisodes: 2 },
    { month: "2026-03", estimatedRealEpisodes: 1 },
  ]);
  assert.equal(result.estimatedRealEpisodes,
    result.estimatedRealEpisodesByMonth.reduce((sum, item) => sum + item.estimatedRealEpisodes, 0));
  assert.equal(result.deduplication.monthlyTimezone, "UTC");
});

test("deduplication spans month and year boundaries and uses original offline occurrence time", () => {
  const result = summariseUsage([
    record(0, { episodeTimestamp: Date.parse("2026-01-01T00:40:00Z"), serverCalculations: 0 }),
    record(0, { episodeTimestamp: Date.parse("2025-12-31T23:40:00Z"), serverCalculations: 1 }),
    record(0, { episodeTimestamp: String(Date.parse("2026-01-01T00:10:00Z")),
      serverCalculations: 0, serverDatetime: "2026-03-01 12:00:00" }),
    record(0, { episodeTimestamp: Date.parse("2026-01-31T23:50:00Z") }),
    record(0, { episodeTimestamp: Date.parse("2026-02-01T00:10:00Z") }),
  ]);
  assert.deepEqual(result.estimatedRealEpisodesByMonth, [
    { month: "2025-12", estimatedRealEpisodes: 1 },
    { month: "2026-01", estimatedRealEpisodes: 2 },
  ]);
  assert.equal(result.estimatedRealEpisodes, 3);
  assert.equal(result.likelyDuplicateRealRecords, 2);
});

test("monthly boundaries use UTC rather than the supplied timestamp's offset", () => {
  const result = summariseUsage([
    record(0, { episodeTimestamp: Date.parse("2026-03-01T00:30:00+01:00") }),
  ]);
  assert.deepEqual(result.estimatedRealEpisodesByMonth, [
    { month: "2026-02", estimatedRealEpisodes: 1 },
  ]);
});

test("out-of-range dates are excluded instead of breaking monthly reporting", () => {
  const result = summariseUsage([
    ...[1e300, Infinity, Date.UTC(10000, 0, 1)].map((episodeTimestamp) =>
      record(0, { episodeTimestamp })),
  ]);
  assert.equal(result.realRecordsExcludedFromEstimate.missingOrInvalidTimestamp, 3);
  assert.deepEqual(result.estimatedRealEpisodesByMonth, []);
});

test("unusable metadata is explicitly excluded, not silently deduplicated", () => {
  const result = summariseUsage([
    record(0),
    ...[null, undefined, "", "bad", 0].map((episodeTimestamp) => record(0, { episodeTimestamp })),
    record(0, { clientIP: null }),
    record(0, { project: "" }),
  ]);
  assert.equal(result.estimatedRealEpisodes, 1);
  assert.deepEqual(result.realRecordsExcludedFromEstimate, {
    total: 7, missingOrInvalidTimestamp: 5, missingClientIPOrProject: 2,
  });
  assert.equal(result.records.real,
    result.estimatedRealEpisodes + result.likelyDuplicateRealRecords +
    result.realRecordsExcludedFromEstimate.total);
  assert.ok(!JSON.stringify(result).includes("192.0.2.1"));
  assert.ok(!JSON.stringify(result).includes("project-a"));
});

test("database reader selects only metadata and always closes the connection", async () => {
  const original = mysql.createConnection;
  let closed = 0;
  let failQuery = false;
  mysql.createConnection = async (options) => {
    assert.equal(options.user, process.env.app_select_user);
    return {
      execute: async (sql) => {
        assert.match(sql, /WHEN serverCalculations = 1\s+THEN UNIX_TIMESTAMP\(serverDatetime\)/);
        assert.match(sql, /WHEN serverCalculations = 0 THEN/);
        assert.match(sql, /CAST\(offlineTimestamp AS UNSIGNED\)/);
        assert.match(sql, /UNIX_TIMESTAMP\(offlineTimestamp\)/);
        assert.doesNotMatch(sql, /encryptedData|INSERT|UPDATE|DELETE/);
        if (failQuery) throw new Error("database unavailable");
        return [[record(0)]];
      },
      end: async () => { closed++; },
    };
  };
  try {
    assert.equal((await getUsageStats()).estimatedRealEpisodes, 1);
    assert.equal(closed, 1);
    failQuery = true;
    await assert.rejects(getUsageStats, /database unavailable/);
    assert.equal(closed, 2);
    mysql.createConnection = async () => { throw new Error("connection refused"); };
    await assert.rejects(getUsageStats, /connection refused/);
  } finally {
    mysql.createConnection = original;
  }
});

test("GET /usage is wired without authentication and returns safe JSON errors", async () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const routes = new Map();
  let fail = false;
  const app = {
    use() {}, set() {}, post() {}, listen() {},
    get(path, ...handlers) { routes.set(path, handlers); },
  };
  const response = () => ({
    statusCode: 200,
    headers: {},
    set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  const middleware = () => {};
  const stubs = {
    express: () => app,
    cors: () => middleware,
    "body-parser": { json: () => middleware },
    "express-rate-limit": () => middleware,
    "express-validator": {},
    "./config.json": require("../config.json"),
    "./modules/validate": {},
    "./modules/handleError": {},
    "./modules/usage": {
      async getUsageStats() {
        if (fail) throw new Error("private database details");
        return summariseUsage([record(0)]);
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../index.js"), "utf8"), {
    require(name) {
      assert.ok(Object.hasOwn(stubs, name), `Unexpected dependency: ${name}`);
      return stubs[name];
    },
    // Isolate startup checks without using real credentials or starting a server.
    process: { env: {
      rsaPublicKey: "test-only", app_insert_key: "test-only", app_select_key: "test-only",
    } },
    console: { log() {}, error() {} },
  });
  const handlers = routes.get("/usage");
  assert.equal(handlers.length, 2);
  assert.equal(handlers[0], middleware);
  const success = response();
  await handlers[1]({ headers: {} }, success);
  assert.equal(success.statusCode, 200);
  assert.equal(success.body.estimatedRealEpisodes, 1);
  assert.deepEqual(success.body.estimatedRealEpisodesByMonth, [
    { month: "2026-01", estimatedRealEpisodes: 1 },
  ]);
  assert.equal(success.headers["Cache-Control"], "no-store");

  fail = true;
  const failure = response();
  await handlers[1]({ headers: {} }, failure);
  assert.equal(failure.statusCode, 500);
  assert.match(failure.body.errors[0].msg, /Unable to retrieve usage statistics/);
  assert.ok(!JSON.stringify(failure.body).includes("private database details"));
});
