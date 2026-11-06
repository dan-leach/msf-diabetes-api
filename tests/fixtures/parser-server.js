// Exercise the real entry point and HTTP dependencies in an isolated process.
// Never use production credentials, MySQL or SMTP in these regression tests.
const fs = require("node:fs");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const express = require("express");

const entryPoint = require.resolve("../../index.js");
const appRequire = createRequire(entryPoint);
let server;
const fakeUsage = {
  records: { total: 0, test: 0, real: 0, other: 0 },
  estimatedRealEpisodes: 0,
};

function testExpress() {
  const app = express();
  app.set("env", "test");
  const listen = app.listen.bind(app);
  app.listen = () => {
    server = listen(0, "127.0.0.1", () => {
      process.send({ port: server.address().port });
    });
    return server;
  };
  return app;
}

vm.runInNewContext(fs.readFileSync(entryPoint, "utf8"), {
  require(name) {
    if (name === "express") return testExpress;
    if (name === "./modules/usage") {
      return { getUsageStats: async () => fakeUsage };
    }
    if ([
      "./modules/encrypt", "./modules/decrypt", "./modules/insertData",
      "./modules/generateAuditID", "./modules/handleError",
    ].includes(name)) {
      return {
        handleError() { throw new Error("Unexpected application error in parser test"); },
      };
    }
    return appRequire(name);
  },
  process: {
    env: {
      NODE_ENV: "test",
      rsaPublicKey: Buffer.from("synthetic-public-key").toString("base64"),
      app_insert_key: "test-only",
      app_select_key: "test-only",
    },
    exit() { throw new Error("Unexpected startup failure in parser test"); },
  },
  Buffer,
  console: { log() {}, error() {} },
}, { filename: entryPoint });

process.on("message", (message) => {
  if (message === "stop") {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  }
});
