const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../modules/handleError"), "utf8");
const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

// Load only the real handler, with no real config, environment or SMTP access.
function loadHandler({ mode = "test", sendMail = async () => {}, setupError } = {}) {
  const logs = [];
  const sent = [];
  let transports = 0;
  let mailLoads = 0;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    process: { env: { NODE_ENV: mode } },
    console: { error: (...args) => logs.push(args) },
    require(name) {
      if (name === "../config.json") {
        return { author: { email: "alerts@example.invalid" } };
      }
      assert.equal(name, "nodemailer", `Unexpected dependency: ${name}`);
      mailLoads++;
      return {
        createTransport() {
          transports++;
          if (setupError) throw setupError;
          return {
            sendMail(options) {
              sent.push(options);
              return sendMail(options);
            },
          };
        },
      };
    },
  }, { filename: "modules/handleError.js" });
  return { handleError: module.exports.handleError, logs, sent,
    transports: () => transports, mailLoads: () => mailLoads };
}

function response() {
  return {
    statuses: [],
    bodies: [],
    status(code) { this.statuses.push(code); return this; },
    json(body) { this.bodies.push(JSON.parse(JSON.stringify(body))); return this; },
  };
}

function assertOriginalResponse(res, code = 500) {
  assert.deepEqual(res.statuses, [code]);
  assert.deepEqual(res.bodies, [{
    errors: [{ msg: "Request failed: original request error" }],
  }]);
}

function assertNotificationFailure(handler) {
  const failures = handler.logs.filter(([message]) =>
    message === "Error email notification failed");
  assert.equal(failures.length, 1);
  assert.equal(failures[0][1].route, "/example");
  assert.equal(failures[0][1].statusCode, 500);
  assert.doesNotMatch(JSON.stringify(handler.logs), /private SMTP details/);
  assert.equal(handler.transports(), 1, "must not recursively send alerts");
}

test("SMTP rejection is contained after the original response is sent", async () => {
  let rejectMail;
  const delivery = new Promise((resolve, reject) => { rejectMail = reject; });
  const handler = loadHandler({ sendMail: () => delivery });
  const res = response();
  const original = new Error("original request error");

  assert.equal(handler.handleError(original, 500, "/example", "Request failed", res), undefined);
  assertOriginalResponse(res);
  assert.equal(handler.logs[0][3], original, "keep the original request error log");
  assert.equal(handler.sent.length, 1);
  rejectMail(new Error("private SMTP details"));
  // Node's test runner fails on an unhandled rejection after this turn.
  await flushAsyncWork();

  assertOriginalResponse(res);
  assertNotificationFailure(handler);
});

test("SMTP setup failure is contained without replacing the response", async () => {
  const handler = loadHandler({ setupError: new Error("private SMTP details") });
  const res = response();
  handler.handleError(new Error("original request error"), 500, "/example", "Request failed", res);
  await flushAsyncWork();
  assertOriginalResponse(res);
  assertNotificationFailure(handler);
});

test("SMTP rejection is also contained when there is no response object", async () => {
  const handler = loadHandler({
    sendMail: async () => { throw new Error("private SMTP details"); },
  });
  handler.handleError(new Error("original request error"), 500, "/example");
  await flushAsyncWork();
  assertNotificationFailure(handler);
});

test("development mode disables mail without loading a transport", async () => {
  const handler = loadHandler({ mode: "development" });
  const res = response();
  handler.handleError(new Error("original request error"), 500, "/example", "Request failed", res);
  await flushAsyncWork();
  assertOriginalResponse(res);
  assert.equal(handler.mailLoads(), 0);
  assert.equal(handler.transports(), 0);
  assert.equal(handler.sent.length, 0);
  assert.ok(handler.logs.some(([message]) =>
    message === "Api dev mode active: error email notifications disabled"));
  assert.ok(!handler.logs.some(([message]) => message === "Error email notification failed"));
});

test("non-500 responses do not attempt error email delivery", async () => {
  const handler = loadHandler();
  const res = response();
  handler.handleError(new Error("original request error"), 400, "/example", "Request failed", res);
  await flushAsyncWork();
  assertOriginalResponse(res, 400);
  assert.equal(handler.mailLoads(), 0);
});

test("successful error email delivery retains its report and response", async () => {
  const handler = loadHandler();
  const res = response();
  handler.handleError(new Error("original request error"), 500, "/example", "Request failed", res, ["audit-example"]);
  await flushAsyncWork();
  assertOriginalResponse(res);
  assert.equal(handler.sent.length, 1);
  assert.equal(handler.sent[0].to, "alerts@example.invalid");
  assert.equal(handler.sent[0].subject, "MSF Diabetes API status 500 error report");
  assert.match(handler.sent[0].html, /original request error/);
  assert.match(handler.sent[0].html, /audit-example/);
  assert.ok(!handler.logs.some(([message]) => message === "Error email notification failed"));
});
