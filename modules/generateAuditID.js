const config = require("../config");
const { dbGet } = require("./db");

const permittedChars = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * Generates a unique audit ID.
 * @returns {Promise<string>} The unique audit ID.
 */
async function generateAuditID() {
  let auditID;
  let isUnique = false;
  try {
    while (!isUnique) {
      auditID = generateRandomID(6, permittedChars);
      const row = await dbGet(
        `SELECT auditID FROM ${config.api.database.tables.calculate} WHERE auditID = ?`,
        [auditID]
      );

      if (!row) {
        isUnique = true;
      }
    }
  } catch (error) {
    throw new Error(`Unable to generate audit ID: ${error.message}`);
  }
  return auditID;
}

/**
 * Generates a random ID of specified length using permitted characters.
 *
 * @param {number} length - The length of the random ID to generate.
 * @param {string} permittedChars - A string containing the characters that are permitted in the ID.
 * @returns {string} - The generated random ID.
 */
function generateRandomID(length, permittedChars) {
  let result = "";
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * permittedChars.length);
    result += permittedChars[randomIndex];
  }
  return result;
}

module.exports = { generateAuditID };
