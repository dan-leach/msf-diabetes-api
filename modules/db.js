const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");

const DB_PATH = path.join(__dirname, "../data/dka_calculator.db");

let db;

function getDb() {
  if (!db) {
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    db = new sqlite3.Database(DB_PATH);
    initSchema();
  }
  return db;
}

function initSchema() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS tbl_calculate (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        auditID TEXT UNIQUE NOT NULL,
        episodeType TEXT,
        appVersion TEXT,
        serverCalculations INTEGER,
        legalAgreement INTEGER,
        operationalCentre TEXT,
        project TEXT,
        clientUseragent TEXT,
        clientIP TEXT,
        encryptedData TEXT,
        weightLimitOverride INTEGER,
        use2SD INTEGER,
        bloodGasAvailable INTEGER,
        bloodKetonesAvailable INTEGER,
        syringeDriverAvailable INTEGER,
        serverDatetime DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS tbl_decrypt (
        id INTEGER PRIMARY KEY,
        auditID TEXT,
        decryptedData TEXT,
        serverDatetime DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });
}

/**
 * Run a query that modifies data (INSERT, UPDATE, DELETE).
 * @returns {Promise<{lastID, changes}>}
 */
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

/**
 * Get a single row.
 * @returns {Promise<Object|undefined>}
 */
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

/**
 * Get all rows.
 * @returns {Promise<Object[]>}
 */
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

module.exports = { getDb, dbRun, dbGet, dbAll };
