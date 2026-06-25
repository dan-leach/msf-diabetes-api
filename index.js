/**
 * @module dka-calculator-api
 * @summary MSF Diabetes Calculator API — application entry point, middleware setup, and route definitions.
 *
 * @description
 * Bootstraps the Express server and registers all API routes:
 *
 *  - `GET  /`                  — Browser redirect to the client application.
 *  - `GET  /config`            — Returns `config.json` augmented with runtime environment values.
 *  - `POST /calculate`         — Main clinical endpoint; validates, calculates, encrypts, and stores an episode.
 *  - `POST /sync-offline-data` — Accepts an episode calculated offline by the client and persists it.
 *  - `POST /feedback`          — Stores free-text clinician feedback linked to an audit ID.
 *  - `GET  /decrypt`           — Admin route to decrypt stored patient records by audit ID.
 *
 * All routes delegate error handling to `handleError` in `./modules/handleError`.
 * Input validation is performed by rule sets defined in `./modules/validate`.
 *
 * @requires express
 * @requires cors
 * @requires body-parser
 * @requires express-validator
 * @requires ./modules/validate
 * @requires ./modules/handleError
 * @requires ./config.json
 * @requires express-rate-limit
 */

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const rateLimit = require("express-rate-limit");
const { matchedData } = require("express-validator");
const config = require("./config.json");
const {
  validateRequest,
  calculateRules,
  syncOfflineDataRules,
  feedbackRules,
} = require("./modules/validate");
const { handleError } = require("./modules/handleError");

const app = express();
app.use(cors());
app.use(bodyParser.json());

/**
 * Rate limiter for GET /config.
 * Higher allowance: the PWA fetches config on startup, SW revalidation, and on
 * navigation to /privacy-policy, so several hits per session per user are normal.
 */
const configLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { errors: [{ msg: "Too many requests, please try again later." }] },
});

/**
 * Rate limiter for POST /calculate and POST /sync-offline-data.
 * Each call triggers RSA encryption and a database write, making these the most
 * expensive endpoints to abuse. 60/hour = 1,440/day, roughly 14× the expected
 * peak of ~100 real episodes per day per IP.
 */
const calculateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { errors: [{ msg: "Too many requests, please try again later." }] },
});

/**
 * Rate limiter for POST /feedback.
 * Naturally infrequent; 20/hour is still very generous for legitimate use.
 */
const feedbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { errors: [{ msg: "Too many requests, please try again later." }] },
});

/**
 * Rate limiter for GET /decrypt.
 * Admin-only route; 60/hour matches the calculate limiter and gives ample
 * headroom for bulk decryption runs.
 */
const decryptLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { errors: [{ msg: "Too many requests, please try again later." }] },
});

//required to get the client IP address as server is behind a proxy
app.set("trust proxy", 3);

/**
 * @route GET /
 * @summary Redirects browser users to the client application.
 *
 * @description
 * Returns a short HTML response pointing users to the client URL defined in
 * `config.client.url`. Intended for anyone who navigates to the API root directly
 * in a browser rather than via the client application.
 *
 * @returns {string} 200 - HTML string containing a link to the client URL.
 */
app.get("/", (req, res) => {
  res.send(
    `Please go to <a href='${config.client.url}'>${config.client.url}</a> instead.`,
  );
});

/**
 * @route GET /config
 * @summary Returns the application configuration to the client.
 *
 * @description
 * Sends `config.json` as a JSON response, augmented with runtime values injected
 * from environment variables: the API version, last-updated date, deployment mode
 * (`underDevelopment`), and the RSA public key (decoded from base64 PEM so the
 * client can use it for offline encryption without a separate key-distribution step).
 *
 * The client fetches this endpoint on startup and caches the result; all clinical
 * constants, validation thresholds, and feature flags are therefore controlled
 * server-side without requiring a client deployment.
 *
 * @returns {Object} 200 - The full config object with runtime fields added.
 * @returns {Object} 500 - JSON error object if the config cannot be assembled.
 */
app.get("/config", configLimiter, (req, res) => {
  try {
    config.api.version = process.env.version;
    config.api.lastUpdated = process.env.lastUpdated;
    // Drive the underDevelopment flag from NODE_ENV so staging and production
    // behave differently without requiring a config.json edit.
    config.api.underDevelopment =
      process.env.NODE_ENV === "development" ? true : false;
    config.fetchDatetime = new Date().toISOString();
    // Decode the base64 PEM so the client receives a usable key string.
    config.api.rsaPublicKey = Buffer.from(
      process.env.rsaPublicKey,
      "base64",
    ).toString("utf-8");
    res.json(config);
  } catch (error) {
    handleError(
      error,
      500,
      "/config",
      "Failed to load configuration file",
      res,
    );
  }
});

/**
 * @route POST /calculate
 * @summary Validates patient data, runs all DKA calculations, and persists the episode.
 *
 * @description
 * The primary clinical endpoint. Processing steps:
 *  1. Input is validated and sanitised by `calculateRules` + `validateRequest` middleware.
 *  2. Patient weight is checked against 2SD centile limits for the patient's sex and age.
 *  3. All clinical variables are calculated by `calculateVariables`.
 *  4. Patient-identifiable fields are encrypted (AES-256-GCM + RSA-OAEP).
 *  5. A unique audit ID is generated and the episode is written to the database.
 *  6. The audit ID and full calculation result are returned to the client.
 *
 * @requires ./modules/calculateVariables
 * @requires ./modules/generateAuditID
 * @requires ./modules/insertData
 * @requires ./modules/checkWeightWithinLimit
 * @requires ./modules/encrypt
 *
 * @param {Object} req       - Express request object containing validated patient data.
 * @param {Object} req.body  - Patient and episode fields (see validate.js — calculateRules).
 * @param {Object} res       - Express response object.
 *
 * @returns {Object} 200 - `{ auditID: string, calculations: Object }`.
 * @returns {Object} 400 - `{ errors: [{ msg: string }] }` for validation or clinical check failures.
 * @returns {Object} 500 - `{ errors: [{ msg: string }] }` for unexpected server errors.
 */
app.post("/calculate", calculateLimiter, calculateRules, validateRequest, async (req, res) => {
  try {
    const { calculateVariables } = require("./modules/calculateVariables");
    const { generateAuditID } = require("./modules/generateAuditID");
    const { insertCalculateData } = require("./modules/insertData");
    const {
      checkWeightWithinLimit,
    } = require("./modules/checkWeightWithinLimit");
    const { encrypt } = require("./modules/encrypt");

    //get the validated data
    const data = matchedData(req);

    //check the weight is within limits or override is true
    const check = checkWeightWithinLimit(data);
    try {
      if (!check.pass) {
        throw new Error(check.error);
      }
    } catch (error) {
      handleError(
        error,
        400,
        "/calculate",
        "Check weight within limit failed",
        res,
      );
      return false;
    }

    //limit decimal age to 2 decimal places after checkWeightWithinLimit
    data.patientAge = data.patientAge.toFixed(2);

    //perform the calculations and check for errors
    const calculations = calculateVariables(data);
    try {
      if (calculations.errors.length) {
        throw new Error(calculations.errors.join(", "));
      }
    } catch (error) {
      handleError(
        error,
        400,
        "/calculate",
        "Failed to perform calculations",
        res,
      );
      return false;
    }

    //set undefined optional values to null
    data.pH = data.pH || null;
    data.glucoseUnit = data.glucoseUnit || null;
    data.glucose = data.glucose || null;
    data.glucoseHigh = data.glucoseHigh || false;
    data.bicarbonate = data.bicarbonate || null;
    data.bloodKetones = data.bloodKetones || null;
    data.urineKetones = data.urineKetones || null;
    data.gcs = data.gcs || null;
    data.respiratorySupport = data.respiratorySupport || null;
    data.dropFactor = data.dropFactor || null;

    //generate a new unique auditID
    const auditID = await generateAuditID();

    //get the IP address of the client request
    const clientIP = req.ip;

    data.appVersion.api = process.env.version;
    data.appVersion.apiMode = process.env.NODE_ENV;

    data.serverCalculations = true;

    //encrypt the patient-identifiable fields before database storage
    const encryptedData = encrypt({
      patientSex: data.patientSex,
      weight: data.weight,
      patientAge: data.patientAge,
      glucose: data.glucose,
      glucoseUnit: data.glucoseUnit,
      glucoseHigh: data.glucoseHigh,
      bloodKetones: data.bloodKetones,
      urineKetones: data.urineKetones,
      diagnosticFeatures: data.diagnosticFeatures,
      pH: data.pH,
      bicarbonate: data.bicarbonate,
      shockPresent: data.shockPresent,
      gcs: data.gcs,
      respiratorySupport: data.respiratorySupport,
      calculations: calculations,
    });

    //insert the data into the database
    await insertCalculateData(data, encryptedData, auditID, clientIP);

    //respond to the client with the auditID and the calculations
    res.json({
      auditID,
      calculations,
    });
  } catch (error) {
    handleError(
      error,
      500,
      "/calculate",
      "Failed to perform calculations",
      res,
      [
        "episodeType: " + req.body.episodeType,
        req.body.centre + " (" + req.body.region + ")",
        "clientDatetime: " + req.body.clientDatetime,
        req.ip,
      ],
    );
  }
});

/**
 * @route POST /sync-offline-data
 * @summary Persists an episode that was calculated offline by the client.
 *
 * @description
 * When the client application operates without API connectivity, it runs the
 * calculation locally and stores the result in localStorage. On reconnection,
 * this endpoint receives the stored episode data (already validated and encrypted
 * by the client's offline calculator) and writes it to the database.
 *
 * The episode retains its client-generated audit ID. `serverCalculations` is set
 * to `false` to distinguish these records from server-calculated episodes.
 *
 * @requires ./modules/insertData
 *
 * @param {Object} req                   - Express request object.
 * @param {Object} req.body              - Contains `auditID`, `data`, and `encryptedData`.
 * @param {string} req.body.auditID      - The client-generated audit ID for the episode.
 * @param {Object} req.body.data         - The full episode data object as submitted by the client.
 * @param {Object} req.body.encryptedData - The client-encrypted patient data object.
 * @param {Object} res                   - Express response object.
 *
 * @returns {Object} 200 - `{ message: "Offline data synced successfully" }`.
 * @returns {Object} 500 - `{ errors: [{ msg: string }] }` if the insert fails.
 */
app.post(
  "/sync-offline-data",
  calculateLimiter,
  syncOfflineDataRules,
  validateRequest,
  async (req, res) => {
    try {
      const { insertCalculateData } = require("./modules/insertData");

      //get the validated data
      const data = matchedData(req);

      //get the IP address of the client request
      const clientIP = req.ip;

      data.data.appVersion.api = process.env.version;
      data.data.appVersion.apiMode = process.env.NODE_ENV;

      // Mark as offline-calculated so it can be distinguished in reporting.
      data.data.serverCalculations = false;

      //insert the data into the database
      await insertCalculateData(
        data.data,
        data.encryptedData,
        data.auditID,
        clientIP,
      );

      //respond to the client with success message
      res.json({
        message: "Offline data synced successfully",
      });
    } catch (error) {
      handleError(
        error,
        500,
        "/sync-offline-data",
        "Failed to sync offline data",
        res,
      );
    }
  },
);

/**
 * @route POST /feedback
 * @summary Stores free-text clinician feedback linked to an episode.
 *
 * @description
 * Accepts a feedback string and the audit ID of the episode it relates to,
 * and writes the entry to `tbl_feedback`. Feedback is intended for quality
 * improvement purposes and is reviewed by the project team.
 *
 * @requires ./modules/insertData
 *
 * @param {Object} req                   - Express request object.
 * @param {Object} req.body              - Contains `auditID` and `feedbackText`.
 * @param {string} req.body.auditID      - The audit ID of the associated episode.
 * @param {string} req.body.feedbackText - The clinician's feedback text (escaped by express-validator).
 * @param {Object} res                   - Express response object.
 *
 * @returns {Object} 200 - `{ message: "Feedback submitted successfully" }`.
 * @returns {Object} 500 - `{ errors: [{ msg: string }] }` if the insert fails.
 */
app.post("/feedback", feedbackLimiter, feedbackRules, validateRequest, async (req, res) => {
  try {
    const { insertFeedback } = require("./modules/insertData");

    //get the validated data
    const data = matchedData(req);

    //insert the feedback into the database
    await insertFeedback(data.feedbackText, data.auditID);

    //respond to the client with success message
    res.status(200).json({
      message: "Feedback submitted successfully",
    });
  } catch (error) {
    handleError(error, 500, "/feedback", "Failed to submit feedback", res);
  }
});

/**
 * @route GET /decrypt
 * @summary Admin route to decrypt and recover stored patient records.
 *
 * @description
 * Accepts a `decryptID` query parameter (a single audit ID or `"all"`) and
 * triggers the decryption pipeline in `./modules/decrypt`. Recovered plaintext
 * records are written to `tbl_decrypt`. The route responds immediately once
 * decryption has been initiated; the process runs asynchronously.
 *
 * ⚠️ This route has no authentication. Access should be restricted at the
 * infrastructure layer until application-level authentication is implemented.
 * See review.md — V1.
 *
 * @requires ./modules/decrypt
 *
 * @param {Object} req                  - Express request object.
 * @param {string} req.query.decryptID  - Audit ID to decrypt, or `"all"`.
 * @param {Object} res                  - Express response object.
 *
 * @returns {string} 200 - Confirmation string `"Decrypt run"`.
 * @returns {Object} 401 - `{ errors: [{ msg: string }] }` if the secret header is missing or incorrect.
 * @returns {Object} 500 - `{ errors: [{ msg: string }] }` if decryption cannot be initiated.
 */
app.get("/decrypt", decryptLimiter, async (req, res) => {
  // Require a matching secret in the X-Decrypt-Key header.
  // Set the decryptSecret environment variable to enable this route.
  const secret = process.env.decryptSecret;
  if (!secret || req.headers["x-decrypt-key"] !== secret) {
    return res.status(401).json({ errors: [{ msg: "Unauthorised" }] });
  }

  try {
    const { decrypt } = require("./modules/decrypt");

    decrypt(req.query.decryptID);

    res.json("Decrypt run");
  } catch (error) {
    handleError(error, 500, "/decrypt", "Failed to decrypt", res);
  }
});

/**
 * @route USE *
 * @summary Catch-all handler for undefined routes.
 *
 * @description
 * Returns a 400 response for any request that does not match a registered route,
 * guiding clients that may have an incorrect API URL.
 *
 * @returns {string} 400 - `"Incorrect API route"`.
 */
app.use("*", (req, res) => {
  res.status(400).json("Incorrect API route");
});

/**
 * Start the Express server on the port defined by the `PORT` environment variable,
 * falling back to `3000` if the variable is not set.
 *
 * Binds to all network interfaces (`0.0.0.0`) so the server is reachable through
 * a reverse proxy or within a containerised environment.
 */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
});
