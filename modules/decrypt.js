/**
 * Decryption module for retrieving sensitive data from encrypted storage.
 *
 * @module decrypt
 * @summary Provides decryption of AES-encrypted data using RSA for AES key decryption.
 *
 * @description This module decrypts data encrypted using AES-256-GCM. The AES key itself is decrypted using an RSA private key.
 *
 * @requires crypto - Node.js built-in module for cryptographic operations.
 * @requires mysql2/promise - MySQL client for executing database queries.
 * @requires process.env.rsaPrivateKey - Environment variable containing the RSA private key in base64 format.
 *
 * @exports decrypt - Function that retrieves and decrypts data based on a given decryptID.
 */
const mysql = require("mysql2/promise");
const crypto = require("crypto");
const config = require("../config");

// Load RSA Private Key (for decrypting AES keys)
const rsaPrivateKey = crypto.createPrivateKey({
  key: Buffer.from(process.env.rsaPrivateKey, "base64").toString("utf-8"),
  format: "pem",
});

/**
 * Decrypts AES-encrypted data using the decrypted AES key.
 *
 * @param {string} encryptedAESKey - The RSA-encrypted AES key.
 * @param {string} encryptedData - The AES-encrypted data.
 * @param {string} iv - The initialization vector used in AES encryption.
 * @param {string} authTag - The authentication tag used in AES-GCM.
 * @returns {object|null} - The decrypted data as an object, or null if decryption fails.
 */
function decryptData(encryptedAESKey, encryptedData, iv, authTag) {
  try {
    // Step 1: Decrypt the AES Key using RSA private key
    const decryptedAESKey = crypto.privateDecrypt(
      {
        key: rsaPrivateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(encryptedAESKey, "base64")
    );

    // Step 2: Decrypt the data using AES-256-GCM
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      decryptedAESKey,
      Buffer.from(iv, "hex")
    );

    // Step 3: Set the authentication tag
    decipher.setAuthTag(Buffer.from(authTag, "hex"));

    // Step 4: Decrypt the data
    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return JSON.parse(decrypted); // Return decrypted object
  } catch (error) {
    console.error("Decryption failed:", error.message);
    return null;
  }
}

/**
 * Retrieves encrypted data from the database and decrypts it.
 *
 * @param {string} decryptID - The audit ID of the data to decrypt, or "all" to decrypt all records.
 * @returns {Promise<void>} - Resolves when decryption and storage are complete.
 */
async function decryptTable(decryptID) {
  const connection = await mysql.createConnection({
    host: "localhost",
    user: process.env.selectUser,
    password: process.env.selectKey,
    database: "dkacalcu_dka_database",
  });

  // Fetch encrypted rows
  const query =
    decryptID === "all"
      ? `SELECT id, episodeType, auditID, appVersion, patientHash, legalAgreement, region, centre, clientDatetime, serverDatetime, clientUseragent, clientIP, encryptedData FROM ${config.api.tables.calculate}`
      : `SELECT id, episodeType, auditID, appVersion, patientHash, legalAgreement, region, centre, clientDatetime, serverDatetime, clientUseragent, clientIP, encryptedData FROM ${config.api.tables.calculate} WHERE auditID = ?`;

  const [rows] = await connection.execute(
    query,
    decryptID === "all" ? [] : [decryptID]
  );

  for (const row of rows) {
    const {
      id,
      episodeType,
      auditID,
      appVersion,
      patientHash,
      legalAgreement,
      region,
      centre,
      clientDatetime,
      serverDatetime,
      clientUseragent,
      clientIP,
      encryptedData,
    } = row;

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

    // Decrypt the data
    const decryptedObject = decryptData(encryptedKey, encData, iv, authTag);

    if (!decryptedObject) {
      console.error(`Skipping row ID ${id}: Decryption failed.`);
      continue;
    }

    // Insert decrypted data into tbl_decrypt
    await connection.execute(
      `INSERT INTO ${config.api.tables.decrypt} (id, episodeType, auditID, appVersion, patientHash, legalAgreement, region, centre, clientDatetime, serverDatetime, clientUseragent, clientIP, decryptedData) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        episodeType,
        auditID,
        appVersion,
        patientHash,
        legalAgreement,
        region,
        centre,
        clientDatetime,
        serverDatetime,
        clientUseragent,
        clientIP,
        decryptedObject,
      ]
    );

    console.log(`Successfully decrypted and stored data for row ID ${id}`);
  }

  await connection.end();
}

/**
 * Handles the decryption process by calling decryptTable.
 *
 * @param {string} decryptID - The audit ID to decrypt, or "all" for all records.
 * @throws {Error} If no decryptID is provided.
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
