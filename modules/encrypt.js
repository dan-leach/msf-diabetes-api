/**
 * Encryption module for securing sensitive data before storage.
 *
 * @module encrypt
 * @summary Provides AES encryption for data and RSA encryption for AES keys.
 *
 * @requires crypto - Node.js built-in module for cryptographic operations.
 * @requires process.env.rsaPublicKey - Environment variable containing the RSA public key in base64 format.
 *
 * @exports encrypt - Function that encrypts data using AES-256-GCM and secures the AES key with RSA encryption.
 */

const crypto = require("crypto");

/**
 * Lazily loads the RSA public key to avoid crashing at module load time.
 */
function getRsaPublicKey() {
  if (!process.env.rsaPublicKey) {
    throw new Error("rsaPublicKey environment variable is not set.");
  }
  return crypto.createPublicKey({
    key: Buffer.from(process.env.rsaPublicKey, "base64").toString("utf-8"),
    format: "pem",
  });
}

/**
 * Encrypts data using AES-256-GCM.
 */
function encryptDataWithAES(data) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(JSON.stringify(data), "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return { encrypted, key, iv: iv.toString("hex"), authTag };
}

/**
 * Encrypts the AES key using RSA public encryption.
 */
function encryptAESKeyWithRSA(aesKey) {
  const rsaPublicKey = getRsaPublicKey();
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
 */
function encrypt(data) {
  const { encrypted, key, iv, authTag } = encryptDataWithAES(data);
  const encryptedKey = encryptAESKeyWithRSA(key);
  return { encryptedData: encrypted, encryptedKey, iv, authTag };
}

module.exports = { encrypt };
