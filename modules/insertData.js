const mysql = require("mysql2/promise");
const config = require("../config");

/**
 * Inserts audit data into the database.
 * @param {Object} data - The submitted data to be inserted.
 * @param {Object} encryptedData - The encrypted data and decryption variables.
 * @param {string} auditID - Audit ID.
 * @param {string} clientIP - Client IP address.
 * @throws {Error} If an error occurs during the database operation.
 */
async function insertCalculateData(data, encryptedData, auditID, clientIP) {
  try {
    const connection = await mysql.createConnection({
      host: "localhost",
      user: process.env.app_insert_user,
      password: process.env.app_insert_key,
      database: config.api.database.name,
    });

    // Prepare SQL statement
    const sql = `
      INSERT INTO ${config.api.database.tables.calculate} (
        auditID, episodeType, appVersion, serverCalculations, legalAgreement, operationalCentre, project, clientUseragent, clientIP, encryptedData, weightLimitOverride, use2SD, useYearsMonths, bloodGasAvailable, bloodKetonesAvailable, syringePumpAvailable, infusionPumpAvailable, dropFactor, offlineTimestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    data.offlineTimestamp = data.offlineTimestamp
      ? data.offlineTimestamp
      : null;

    const paramNames = [
      "auditID",
      "episodeType",
      "appVersion",
      "serverCalculations",
      "legalAgreement",
      "operationalCentre",
      "project",
      "clientUseragent",
      "clientIP",
      "encryptedData",
      "weightLimitOverride",
      "use2SD",
      "useYearsMonths",
      "bloodGasAvailable",
      "bloodKetonesAvailable",
      "syringePumpAvailable",
      "infusionPumpAvailable",
      "dropFactor",
      "offlineTimestamp",
    ];

    const params = [
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
      data.useYearsMonths,
      data.bloodGasAvailable,
      data.bloodKetonesAvailable,
      data.syringePumpAvailable,
      data.infusionPumpAvailable,
      data.dropFactor,
      data.offlineTimestamp,
    ];

    const bad = paramNames
      .map((name, i) => ({ name, value: params[i] }))
      .filter((x) => x.value === undefined);

    if (bad.length) {
      throw new Error(
        `Undefined bind params for insertCalculateData: ${bad.map((x) => x.name).join(", ")}`,
      );
    }

    // Execute SQL statement
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
      data.useYearsMonths,
      data.bloodGasAvailable,
      data.bloodKetonesAvailable,
      data.syringePumpAvailable,
      data.infusionPumpAvailable,
      data.dropFactor,
      data.offlineTimestamp,
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
 * Inserts feedback into the database.
 * @param {string} feedbackText - The submitted feedback text to be inserted.
 * @param {string} auditID - Audit ID.
 * @throws {Error} If an error occurs during the database operation.
 */
async function insertFeedback(feedbackText, auditID) {
  try {
    const connection = await mysql.createConnection({
      host: "localhost",
      user: process.env.app_insert_user,
      password: process.env.app_insert_key,
      database: config.api.database.name,
    });

    // Prepare SQL statement
    const sql = `
      INSERT INTO ${config.api.database.tables.feedback} (auditID, feedbackText) VALUES (?, ?)
    `;

    const paramNames = ["auditID", "feedbackText"];

    const params = [auditID, feedbackText];

    // Execute SQL statement
    const [result] = await connection.execute(sql, [auditID, feedbackText]);

    if (result.affectedRows === 0) {
      throw new Error("Feedback data could not be logged: No rows affected");
    }
  } catch (error) {
    throw new Error(`Feedback data could not be logged: ${error.message}`);
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
