const sqlite3 = require("sqlite3").verbose();
const path = require("path");

/**
 * Sanitizes and formats the postcode, then queries the database for IMD data.
 * @param {Object} data - The data object containing the patient postcode.
 * @returns {Promise<number|null>} - The IMD decile or null if not found.
 */
async function getImdDecile(unformattedPostcode) {
  const formatPostcode = (postcode) => {
    postcode = postcode.replace(/\s+/g, "").toUpperCase();
    return postcode.slice(0, -3) + " " + postcode.slice(-3);
  };

  const postcode = formatPostcode(unformattedPostcode);

  return new Promise((resolve, reject) => {
    // Open the database connection
    const db = new sqlite3.Database(
      path.join(__dirname, "./imd.sqlite3"),
      sqlite3.OPEN_READONLY,
      (err) => {
        if (err) {
          return reject("Connection failed: " + err.message);
        }
      }
    );

    // Prepare the query
    const query = `
      SELECT
        onspd.pcds,
        imd.lsoa_name_11,
        imd.imd_rank,
        imd.imd_decile
      FROM
        imd19 AS imd
      INNER JOIN
        onspd_aug19 AS onspd ON imd.lsoa_code_11 = onspd.lsoa11
      WHERE
        onspd.pcds = ?
      LIMIT 1
    `;

    // Execute the query
    db.get(query, [postcode], (err, row) => {
      if (err) {
        db.close(() => reject("Query failed: " + err.message));
      } else {
        const imdDecile = row ? parseInt(row.imd_decile, 10) : null;
        db.close(() => resolve(imdDecile));
      }
    });
  });
}

module.exports = { getImdDecile };
