/**
 * Encryption module for securing sensitive data before storage.
 *
 * @module encrypt
 * @summary Provides AES encryption for data and RSA encryption for AES keys.
 *
 * @description This module encrypts sensitive data using AES-256-GCM and securely encrypts the AES key using an RSA public key.
 *
 * @requires crypto - Node.js built-in module for cryptographic operations.
 * @requires process.env.rsaPublicKey - Environment variable containing the RSA public key in base64 format.
 *
 * @exports encrypt - Function that encrypts data using AES-256-GCM and secures the AES key with RSA encryption.
 */
const crypto = require("crypto");

// Load RSA Public Key (for encrypting AES keys)
const rsaPublicKey = crypto.createPublicKey({
  key: Buffer.from(process.env.rsaPublicKey, "base64").toString("utf-8"),
  format: "pem",
});

/**
 * Encrypts data using AES-256-GCM.
 *
 * @param {object} data - The data to be encrypted.
 * @returns {object} - The encrypted data, AES key, IV, and authentication tag.
 */
function encryptDataWithAES(data) {
  const key = crypto.randomBytes(32); // 256-bit AES key
  const iv = crypto.randomBytes(16); // Initialization Vector
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(JSON.stringify(data), "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return { encrypted, key, iv: iv.toString("hex"), authTag };
}

/**
 * Encrypts the AES key using RSA public encryption.
 *
 * @param {Buffer} aesKey - The AES key to be encrypted.
 * @returns {string} - The RSA-encrypted AES key in base64 format.
 */
function encryptAESKeyWithRSA(aesKey) {
  return crypto
    .publicEncrypt(
      {
        key: rsaPublicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      aesKey
    )
    .toString("base64");
}

/**
 * Encrypts data and secures the AES key using RSA encryption.
 *
 * @param {object} data - The data to be encrypted.
 * @returns {object} - Object containing encrypted data, encrypted AES key, IV, and authentication tag.
 */
function encrypt(data) {
  const { encrypted, key, iv, authTag } = encryptDataWithAES(data);
  const encryptedKey = encryptAESKeyWithRSA(key);
  return { encryptedData: encrypted, encryptedKey, iv, authTag };
}

module.exports = { encrypt };
