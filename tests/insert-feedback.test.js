const { test } = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const config = require("../config.json");
const { insertFeedback } = require("../modules/insertData");

test("feedback insert uses bound parameters and awaits connection closure", async (t) => {
  const calls = [];
  let finishClose;
  const closed = new Promise((resolve) => { finishClose = resolve; });
  let closing;
  const closeStarted = new Promise((resolve) => { closing = resolve; });
  const feedback = "Feedback with 'quotes' and ? placeholders";
  t.mock.method(mysql, "createConnection", async (options) => {
    calls.push("connect");
    assert.equal(options.host, "localhost");
    assert.equal(options.database, config.api.database.name);
    assert.equal(options.user, process.env.app_insert_user);
    assert.equal(options.password, process.env.app_insert_key);
    return {
      execute: async (sql, params) => {
        calls.push("execute");
        assert.equal(sql.trim(),
          `INSERT INTO ${config.api.database.tables.feedback} (auditID, feedbackText) VALUES (?, ?)`);
        assert.deepEqual(params, ["ABC123", feedback]);
        return [{ affectedRows: 1 }];
      },
      end: async () => {
        calls.push("end");
        closing();
        await closed;
      },
    };
  });

  let settled = false;
  const insertion = insertFeedback(feedback, "ABC123");
  insertion.then(() => { settled = true; }, () => { settled = true; });
  await closeStarted;
  try {
    assert.equal(settled, false, "must not resolve before end() finishes");
    assert.deepEqual(calls, ["connect", "execute", "end"]);
  } finally {
    finishClose();
  }
  assert.equal(await insertion, undefined);
  assert.deepEqual(calls, ["connect", "execute", "end"]);
});

test("failed feedback insert closes its connection exactly once", async (t) => {
  const calls = [];
  t.mock.method(mysql, "createConnection", async () => ({
    execute: async () => {
      calls.push("execute");
      throw new Error("insert failed");
    },
    end: async () => { calls.push("end"); },
  }));

  await assert.rejects(insertFeedback("Feedback", "ABC123"), {
    message: "Feedback could not be logged: insert failed",
  });
  assert.deepEqual(calls, ["execute", "end"]);
});

test("connection failure retains the feedback error without attempting an insert", async (t) => {
  const connect = t.mock.method(mysql, "createConnection", async () => {
    throw new Error("connection refused");
  });

  await assert.rejects(insertFeedback("Feedback", "ABC123"), {
    message: "Feedback could not be logged: connection refused",
  });
  assert.equal(connect.mock.callCount(), 1);
});

for (const insertFails of [false, true]) {
  test(`cleanup failure preserves a ${insertFails ? "failed" : "successful"} feedback insert outcome`, async (t) => {
    let closed = 0;
    t.mock.method(mysql, "createConnection", async () => ({
      execute: async () => {
        if (insertFails) throw new Error("insert failed");
        return [{ affectedRows: 1 }];
      },
      end: async () => {
        closed++;
        throw new Error("close failed");
      },
    }));

    if (insertFails) {
      await assert.rejects(insertFeedback("Feedback", "ABC123"), {
        message: "Feedback could not be logged: insert failed",
      });
    } else {
      assert.equal(await insertFeedback("Feedback", "ABC123"), undefined);
    }
    assert.equal(closed, 1);
  });
}
