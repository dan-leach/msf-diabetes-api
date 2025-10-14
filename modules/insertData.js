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
      user: config.api.database.users.insert,
      password: process.env.app_insert_key,
      database: config.api.database.name,
    });

    // Prepare SQL statement
    const sql = `
      INSERT INTO ${config.api.database.tables.calculate} (
        auditID, episodeType, appVersion, legalAgreement, operationalCentre, project, clientIP, encryptedData, weightLimitOverride, use2SD, bloodGasAvailable, bloodKetonesAvailable, syringeDriverAvailable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // Execute SQL statement
    const [result] = await connection.execute(sql, [
      auditID,
      data.episodeType,
      data.appVersion,
      data.legalAgreement,
      data.operationalCentre,
      data.project,
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

module.exports = {
  insertCalculateData,
};
