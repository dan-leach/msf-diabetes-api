const mysql = require("mysql2/promise");
const config = require("../config");

/**
 * Fetches the auditID and patientHash from the database.
 * @param {string} auditID - The audit ID to search for.
 * @returns {Promise<Object>} - The fetched data containing auditID and patientHash.
 */
async function updateCheck(auditID) {
  try {
    const connection = await mysql.createConnection({
      host: "localhost",
      user: process.env.selectUser,
      password: process.env.selectKey,
      database: "dkacalcu_dka_database",
    });
    const sql = `SELECT auditID, patientHash FROM ${config.api.tables.calculate} WHERE auditID = ?`;

    const [rows] = await connection.execute(sql, [auditID]);

    if (rows.length === 0) {
      return false;
    }

    return rows[0];
  } catch (error) {
    console.error(error);
    throw new Error(`Audit data could not be updated: ${error.message}`);
  } finally {
    try {
      await connection.end();
    } catch {
      //no connection to close
    }
  }
}

module.exports = {
  updateCheck,
};
