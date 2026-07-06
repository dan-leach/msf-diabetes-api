/**
 * @module generateAuditID
 * @memberof module:msf-diabetes-api
 * @summary Generates a unique 6-character audit ID for each DKA episode.
 *
 * @description
 * Audit IDs are used to identify individual episodes in the database and to provide
 * clinicians with a short, human-readable reference they can quote when discussing
 * a case with the project team.
 *
 * The ID is drawn from a 31-character alphabet (`permittedChars`) that excludes
 * visually ambiguous characters (0/O, 1/I/L) to reduce transcription errors.
 * With 31⁶ ≈ 887 million possible values, collision probability is negligible at
 * current scale, but the uniqueness loop has no maximum retry guard — see
 * review.md — O2 for the recommended improvement.
 *
 * Uniqueness is verified against `tbl_calculate` using the select-only database
 * user. A new connection is opened per call — see review.md — O1 for the
 * connection-pooling optimisation that would replace this pattern.
 *
 * @requires mysql2/promise
 * @requires ../config.json
 */

const mysql = require("mysql2/promise");
const config = require("../config");

/**
 * Characters permitted in an audit ID.
 * Excludes 0, 1, I, L, O to prevent visual ambiguity when the ID is read aloud
 * or handwritten.
 *
 * @constant {string}
 */
const permittedChars = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * Generates a globally unique 6-character audit ID.
 *
 * Opens a MySQL connection with SELECT-only privileges, generates random candidate
 * IDs, and queries the database until a value that does not already exist in
 * `tbl_calculate` is found. Returns the unique ID.
 *
 * @async
 * @returns {Promise<string>} A unique 6-character audit ID drawn from {@link permittedChars}.
 * @throws {Error} If the database connection cannot be established or the query fails.
 */
async function generateAuditID() {
  let auditID;
  let isUnique = false;
  let connection;
  try {
    // Use the select-only database user — this function never needs to write.
    connection = await mysql.createConnection({
      host: "localhost",
      user: process.env.app_select_user,
      password: process.env.app_select_key,
      database: config.api.database.name,
    });
    while (!isUnique) {
      auditID = generateRandomID(6, permittedChars);

      // Check whether this candidate ID already exists in the episode table.
      const [rows] = await connection.execute(
        `SELECT auditID FROM ${config.api.database.tables.calculate} WHERE auditID = ?`,
        [auditID],
      );

      if (rows.length === 0) {
        isUnique = true;
      }
    }
  } catch (error) {
    throw new Error(
      `Unable to generate audit ID: ${error.message}${error.code}`,
    );
  } finally {
    try {
      await connection.end();
    } catch {
      //no connection to close
    }
  }
  return auditID;
}

/**
 * Generates a random string of a given length using a supplied character set.
 *
 * Uses `Math.random()` for index selection, which is sufficient for audit ID
 * generation (collision avoidance rather than cryptographic uniqueness).
 *
 * @param {number} length         - Number of characters in the generated string.
 * @param {string} permittedChars - String of characters to draw from.
 * @returns {string} A random string of the requested length.
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
