/**
 * @module insertData
 * @memberof module:dka-calculator-api
 * @summary Handles all database write operations for the API.
 *
 * @description
 * Exports two functions that insert records into the MySQL database:
 *
 *  - `insertCalculateData` — writes a completed episode record (encrypted patient data,
 *    episode metadata, and audit ID) to `tbl_calculate` after a successful `/calculate`
 *    or `/sync-offline-data` request.
 *  - `insertFeedback` — writes a free-text feedback entry linked to an audit ID
 *    to `tbl_feedback` after a successful `/feedback` request.
 *
 * Each function opens a short-lived MySQL connection using the appropriate
 * least-privilege database user, executes a single parameterised statement, then
 * closes the connection in a `finally` block. See review.md — O1 for the
 * connection-pooling optimisation that would replace this pattern.
 *
 * @requires mysql2/promise
 * @requires ../config.json
 */

const mysql = require("mysql2/promise");
const config = require("../config");

/**
 * Inserts a completed DKA episode record into the `tbl_calculate` table.
 *
 * The function uses the insert-only database user (`config.api.database.users.insert`)
 * authenticated with the `app_insert_key` environment variable, ensuring the
 * connection has no SELECT, UPDATE, or DELETE privileges.
 *
 * @async
 * @param {Object}  data                         - Validated and processed episode data.
 * @param {string}  data.episodeType             - `"real"` or `"test"`.
 * @param {Object}  data.appVersion              - `{ client, api, apiMode }` version strings.
 * @param {boolean} data.serverCalculations      - `true` for online episodes; `false` for synced offline episodes.
 * @param {boolean} data.legalAgreement          - Whether the clinician accepted the disclaimer.
 * @param {string}  data.operationalCentre       - MSF operational centre name.
 * @param {string}  data.project                 - MSF project code.
 * @param {string}  data.clientUseragent         - Browser user-agent string from the client.
 * @param {boolean} data.weightLimitOverride     - Whether the 2SD weight limit was overridden.
 * @param {boolean} data.use2SD                  - Whether the 2SD weight lookup was used.
 * @param {boolean} data.bloodGasAvailable       - Equipment availability flag.
 * @param {boolean} data.bloodKetonesAvailable   - Equipment availability flag.
 * @param {boolean} data.syringeDriverAvailable  - Equipment availability flag.
 * @param {Object}  encryptedData                - Output of `encrypt()`: `{ encryptedData, encryptedKey, iv, authTag }`.
 * @param {string}  auditID                      - Unique 6-character episode identifier.
 * @param {string}  clientIP                     - Client IP address from the request.
 *
 * @returns {Promise<void>} Resolves when the row has been successfully inserted.
 * @throws {Error} If the connection cannot be established, the INSERT fails, or no rows are affected.
 */
async function insertCalculateData(data, encryptedData, auditID, clientIP) {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: "localhost",
      user: config.api.database.users.insert,
      password: process.env.app_insert_key,
      database: config.api.database.name,
    });

    // Parameterised INSERT — all values passed separately to prevent SQL injection.
    const sql = `
      INSERT INTO ${config.api.database.tables.calculate} (
        auditID, episodeType, appVersion, serverCalculations, legalAgreement, operationalCentre, project, clientUseragent, clientIP, encryptedData, weightLimitOverride, use2SD, bloodGasAvailable, bloodKetonesAvailable, syringeDriverAvailable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await connection.execute(sql, [
      auditID,
      data.episodeType,
      data.appVersion,
      data.serverCalculations,
      data.legalAgreement,
      data.operationalCentre,
      data.project,
      data.clientUseragent,
      clientIP,
      encryptedData,
      data.weightLimitOverride,
      data.use2SD,
      data.bloodGasAvailable,
      data.bloodKetonesAvailable,
      data.syringeDriverAvailable,
    ]);

    if (result.affectedRows === 0) {
      throw new Error("Audit data could not be logged: No rows affected");
    }
  } catch (error) {
    throw new Error(`Audit data could not be logged: ${error.message}`);
  } finally {
    try {
      await connection.end();
    } catch {
      //no connection to close
    }
  }
}

/**
 * Inserts a clinician feedback entry into the `tbl_feedback` table.
 *
 * Feedback is linked to a specific episode via its `auditID`, allowing the project
 * team to correlate comments with the corresponding clinical record if needed.
 *
 * @async
 * @param {string} feedbackText - Free-text feedback string (sanitised by express-validator before this call).
 * @param {string} auditID      - The audit ID of the episode the feedback relates to.
 *
 * @returns {Promise<void>} Resolves when the feedback row has been successfully inserted.
 * @throws {Error} If the connection cannot be established or the INSERT fails.
 */
async function insertFeedback(feedbackText, auditID) {
  try {
    const connection = await mysql.createConnection({
      host: "localhost",
      user: config.api.database.users.insert,
      password: process.env.app_insert_key,
      database: config.api.database.name,
    });

    const sql = `
      INSERT INTO ${config.api.database.tables.feedback} (auditID, feedbackText) VALUES (?, ?)
    `;

    await connection.execute(sql, [auditID, feedbackText]);
  } catch (error) {
    throw new Error(`Feedback could not be logged: ${error.message}`);
  } finally {
    try {
      await connection.end();
    } catch {
      //no connection to close
    }
  }
}

module.exports = {
  insertCalculateData,
  insertFeedback,
};
