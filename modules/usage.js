/**
 * Aggregate usage reporting. Never returns patient data or individual IPs.
 * Online timestamps come from serverDatetime; offline timestamps come from
 * offlineTimestamp, not the time at which an offline record was synced.
 */
const mysql = require("mysql2/promise");
const config = require("../config.json");

const DEDUPLICATION_WINDOW_MS = 60 * 60 * 1000;

/**
 * Estimate real episodes within each (clientIP, project) group.
 * A skipped record does not extend the window from the last counted record.
 * Records exactly one hour apart count as separate episodes.
 */
function summariseUsage(rows) {
  const counts = { total: rows.length, test: 0, real: 0, other: 0 };
  const groups = new Map();
  let missingTimestamp = 0;
  let missingGrouping = 0;

  for (const row of rows) {
    if (row.episodeType === "test") {
      counts.test++;
      continue;
    }
    if (row.episodeType !== "real") {
      counts.other++;
      continue;
    }
    counts.real++;

    // Number(null) and Number("") are zero, not valid episode timestamps.
    const timestamp = row.episodeTimestamp === null ||
      row.episodeTimestamp === undefined || row.episodeTimestamp === ""
      ? NaN
      : Number(row.episodeTimestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      missingTimestamp++;
      continue;
    }
    if (
      typeof row.clientIP !== "string" || !row.clientIP.trim() ||
      typeof row.project !== "string" || !row.project.trim()
    ) {
      missingGrouping++;
      continue;
    }

    // Tuple encoding avoids collisions between different IP/project pairs.
    const key = JSON.stringify([row.clientIP, row.project]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(timestamp);
  }

  let estimatedRealEpisodes = 0;
  let likelyDuplicateRealRecords = 0;
  for (const timestamps of groups.values()) {
    timestamps.sort((a, b) => a - b);
    let lastCountedTimestamp = -Infinity;
    for (const timestamp of timestamps) {
      if (timestamp - lastCountedTimestamp >= DEDUPLICATION_WINDOW_MS) {
        estimatedRealEpisodes++;
        lastCountedTimestamp = timestamp;
      } else {
        likelyDuplicateRealRecords++;
      }
    }
  }

  return {
    records: counts,
    estimatedRealEpisodes,
    likelyDuplicateRealRecords,
    realRecordsExcludedFromEstimate: {
      total: missingTimestamp + missingGrouping,
      missingOrInvalidTimestamp: missingTimestamp,
      missingClientIPOrProject: missingGrouping,
    },
    deduplication: {
      episodeType: "real",
      groupBy: ["clientIP", "project"],
      windowMinutes: 60,
      rule: "Count the earliest record, then records at least one hour after the last counted record in each group.",
      onlineTimestamp: "serverDatetime",
      offlineTimestamp: "offlineTimestamp",
    },
  };
}

/**
 * Read only the metadata needed for counts and deduplication, using the
 * existing SELECT-only user. One query keeps all counts on the same snapshot.
 * MySQL interprets DATETIME values in its session timezone, avoiding an
 * additional dependency on the Node process timezone.
 */
async function getUsageStats() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: "localhost",
      user: process.env.app_select_user,
      password: process.env.app_select_key,
      database: config.api.database.name,
    });
    const [rows] = await connection.execute(`
      SELECT episodeType, clientIP, project,
        CASE
          WHEN serverCalculations = 1
            THEN UNIX_TIMESTAMP(serverDatetime) * 1000
          WHEN serverCalculations = 0 THEN
            CASE
              WHEN CAST(offlineTimestamp AS CHAR) REGEXP '^[0-9]{13}$'
                THEN CAST(offlineTimestamp AS UNSIGNED)
              ELSE UNIX_TIMESTAMP(offlineTimestamp) * 1000
            END
          ELSE NULL
        END AS episodeTimestamp
      FROM ${config.api.database.tables.calculate}
    `);
    return summariseUsage(rows);
  } finally {
    if (connection) await connection.end();
  }
}

module.exports = { getUsageStats, summariseUsage };
