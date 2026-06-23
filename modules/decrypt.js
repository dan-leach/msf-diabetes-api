/**
 * Decryption module for retrieving sensitive data from encrypted storage.
 *
 * @module decrypt
 * @summary Provides decryption of AES-encrypted data using RSA for AES key decryption.
 *
 * @requires crypto - Node.js built-in module for cryptographic operations.
 * @requires process.env.rsaPrivateKey - Environment variable containing the RSA private key in base64 format.
 *
 * @exports decrypt - Function that retrieves and decrypts data based on a given decryptID.
 */
const crypto = require("crypto");
const config = require("../config");
const { dbAll, dbRun } = require("./db");

/**
 * Lazily loads the RSA private key to avoid crashing at module load time.
 */
function getRsaPrivateKey() {
  if (!process.env.rsaPrivateKey) {
    throw new Error("rsaPrivateKey environment variable is not set.");
  }
  return crypto.createPrivateKey({
    key: Buffer.from(process.env.rsaPrivateKey, "base64").toString("utf-8"),
    format: "pem",
  });
}

/**
 * Decrypts AES-encrypted data using the decrypted AES key.
 */
function decryptData(encryptedAESKey, encryptedData, iv, authTag) {
  try {
    const rsaPrivateKey = getRsaPrivateKey();

    const decryptedAESKey = crypto.privateDecrypt(
      {
        key: rsaPrivateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(encryptedAESKey, "base64")
    );

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      decryptedAESKey,
      Buffer.from(iv, "hex")
    );

    decipher.setAuthTag(Buffer.from(authTag, "hex"));

    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return JSON.parse(decrypted);
  } catch (error) {
    console.error("Decryption failed:", error.message);
    return null;
  }
}

/**
 * Retrieves encrypted data from the database and decrypts it.
 */
async function decryptTable(decryptID) {
  const query =
    decryptID === "all"
      ? `SELECT id, auditID, encryptedData FROM ${config.api.database.tables.calculate}`
      : `SELECT id, auditID, encryptedData FROM ${config.api.database.tables.calculate} WHERE auditID = ?`;

  const rows = await dbAll(query, decryptID === "all" ? [] : [decryptID]);

  for (const row of rows) {
    const { id, auditID, encryptedData } = row;

    if (!encryptedData) {
      console.error(`Skipping row ID ${id}: No encrypted data found.`);
      continue;
    }

    let parsedData;
    try {
      parsedData = JSON.parse(encryptedData);
    } catch (error) {
      console.error(
        `Failed to parse encryptedData for row ID ${id}:`,
        error.message
      );
      continue;
    }

    const { encryptedKey, encryptedData: encData, iv, authTag } = parsedData;

    const decryptedObject = decryptData(encryptedKey, encData, iv, authTag);

    if (!decryptedObject) {
      console.error(`Skipping row ID ${id}: Decryption failed.`);
      continue;
    }

    await dbRun(
      `INSERT OR REPLACE INTO ${config.api.database.tables.decrypt} (id, auditID, decryptedData) VALUES (?, ?, ?)`,
      [id, auditID, JSON.stringify(decryptedObject)]
    );

    console.log(`Successfully decrypted and stored data for row ID ${id}`);
  }
}

/**
 * Handles the decryption process by calling decryptTable.
 */
async function decrypt(decryptID) {
  if (!decryptID) {
    throw new Error("No decryptID provided.");
  }
  const errorTime = new Date().toISOString();
  console.error(errorTime, "Decrypt.js running...");
  decryptTable(decryptID);
}

module.exports = { decrypt };
