const config = require("../config");
const { dbRun } = require("./db");

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
    const sql = `
      INSERT INTO ${config.api.database.tables.calculate} (
        auditID, episodeType, appVersion, serverCalculations, legalAgreement, operationalCentre, project, clientUseragent, clientIP, encryptedData, weightLimitOverride, use2SD, bloodGasAvailable, bloodKetonesAvailable, syringeDriverAvailable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await dbRun(sql, [
      auditID,
      data.episodeType,
      JSON.stringify(data.appVersion),
      data.serverCalculations ? 1 : 0,
      data.legalAgreement ? 1 : 0,
      data.operationalCentre,
      data.project,
      data.clientUseragent,
      clientIP,
      JSON.stringify(encryptedData),
      data.weightLimitOverride ? 1 : 0,
      data.use2SD ? 1 : 0,
      data.bloodGasAvailable ? 1 : 0,
      data.bloodKetonesAvailable ? 1 : 0,
      data.syringeDriverAvailable ? 1 : 0,
    ]);

    if (result.changes === 0) {
      throw new Error("Audit data could not be logged: No rows affected");
    }
  } catch (error) {
    throw new Error(`Audit data could not be logged: ${error.message}`);
  }
}

module.exports = {
  insertCalculateData,
};
