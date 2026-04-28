/**
 * @module MSF_Diabetes_Calculator_API The MSF Diabetes Calculator API application setup and routing.
 *
 * @description This Express server provides various API endpoints including the main calculate route, and the secondary update and sodium-osmo routes.
 *
 * @requires express
 * @requires cors - To prevent CORS block
 * @requires body-parser - Library to parse request body from JSON
 * @requires crypto - Library to perform hashing
 * @requires express-validator - Library to perform validation
 * @requires ./modules/validate - Rules for validating requests
 * @requires ./modules/handleError - Error logging and notifications
 */

const express = require("express");
var cors = require("cors");
const bodyParser = require("body-parser");
const crypto = require("crypto");
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

const path = require("path");

//required to get the client IP address as server behind proxy
app.set("trust proxy", 3);

/**
 * @route GET /
 * @summary Redirects users to the main website.
 *
 * @description This route handles any GET requests made to the API root. Instead of providing an API response,
 * it advises users to visit the main website. The response includes HTML content with a clickable link to the website.
 * This is useful for guiding users who may be accessing the API directly in a browser.
 *
 * @returns {string} 200 - HTML content that redirects the user to an external website.
 */
app.get("/", (req, res) => {
  res.send(
    `Please go to <a href='${config.client.url}'>${config.client.url}</a> instead.`,
  );
});

/**
 * @route GET /config
 * @summary Provides the configuration settings to the client.
 *
 * @description This route sends the contents of the server's config file to the client as a JSON response after
 * adding the version data from environment variables. The config file contains various settings that the client
 * might need, such as API endpoints or feature flags.
 *
 * @returns {Object} 200 - JSON object containing the server's configuration.
 */
app.get("/config", (req, res) => {
  try {
    config.api.version = process.env.version;
    config.api.lastUpdated = process.env.lastUpdated;
    config.api.underDevelopment =
      process.env.NODE_ENV === "development" ? true : false;
    config.fetchDatetime = new Date().toISOString();
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
 * Primary route for calculating variables and creating new episode entries in the database.
 *
 * @route POST /calculate
 * @summary Processes a calculation request with various checks and inserts a new entry into the database.
 *
 * @description This endpoint receives a POST request with validated patient and episode data, performs necessary
 * calculations, checks data against predefined rules, and saves it in the database. The endpoint:
 * - Validates the request data using `calculateRules` and `validateRequest` middlewares.
 * - Checks if the patient's weight is within limits or if an override is allowed.
 * - Calculates derived values based on input data and checks for errors.
 * - Hashes sensitive patient data and retrieves IMD (Index of Multiple Deprivation) decile data based on postcode.
 * - Generates a unique audit ID and stores the calculated data in the database.
 *
 * @requires ./modules/calculateVariables - Module for calculating variables.
 * @requires ./modules/generateAuditID - Module for generating unique audit IDs.
 * @requires ./modules/insertData - Module for database insertion of calculation data.
 * @requires ./modules/checkWeightWithinLimit - Module to verify if patient weight is within limits.
 * @requires ./modules/encrypt - Module for encrypting calculated data before storage.
 *
 * @param {object} req - The request object, with validated data and IP address.
 * @param {object} req.body - Contains patient data fields.
 * @param {object} res - The response object to send calculation details or errors.
 *
 * @returns {object} 200 - JSON object with `auditID` and calculated `variables`.
 * @returns {object} 400 - JSON object with errors if validation or calculation checks fail.
 * @returns {object} 500 - JSON object with error message if a server error occurs.
 */
app.post("/calculate", calculateRules, validateRequest, async (req, res) => {
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

    //encrypt the data
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
 * Route for adding offline calculation episodes to the database once client back online.
 *
 * @route POST /sync-offline-data
 * @summary
 *
 * @description
 *
 * @requires ./modules/insertData - Module for database insertion of calculation data.
 *
 * @param {object} req - The request object, with validated data and IP address.
 * @param {object} req.body - Contains patient data fields.
 * @param {object} res - The response object to send confirmation or errors.
 *
 * @returns {object} 200 - JSON object with confirmation.
 * @returns {object} 400 - JSON object with errors if sync fails.
 * @returns {object} 500 - JSON object with error message if a server error occurs.
 */
app.post(
  "/sync-offline-data",
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
 * Route for adding feedback to the database.
 *
 * @route POST /feedback
 * @summary
 *
 * @description
 *
 * @requires ./modules/insertData - Module for database insertion of feedback data.
 *
 * @param {object} req - The request object, with validated data.
 * @param {object} req.body - Contains feedback.
 * @param {object} res - The response object to send confirmation or errors.
 *
 * @returns {object} 200 - JSON object with confirmation.
 * @returns {object} 400 - JSON object with errors if sync fails.
 * @returns {object} 500 - JSON object with error message if a server error occurs.
 */
app.post("/feedback", feedbackRules, validateRequest, async (req, res) => {
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
 * Route for decrypting previously stored data.
 *
 * @route GET /decrypt
 * @summary Decrypts stored data based on a provided decrypt ID.
 *
 * @description This endpoint receives a GET request with a `decryptID` query parameter.
 * It uses the decryption module to process the request and return a success response.
 *
 * @requires ./modules/decrypt - Module for decrypting stored data.
 *
 * @param {object} req - The request object containing query parameters.
 * @param {string} req.query.decryptID - The ID of the encrypted data to be decrypted.
 * @param {object} res - The response object to send the decryption status.
 *
 * @returns {object} 200 - JSON object confirming decryption was attempted.
 * @returns {object} 500 - JSON object with error message if decryption fails.
 */
app.get("/decrypt", async (req, res) => {
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
 * @summary Handles incorrect or undefined API routes.
 *
 * @description This middleware is used as a catch-all for undefined routes, returning a 500 status code and an error message indicating that the API route is incorrect.
 * This is useful for guiding clients when they access a non-existent route.
 *
 * @returns {Object} 500 - JSON object containing an error message.
 */
app.use("*", (req, res) => {
  res.status(400).json("Incorrect API route");
});

/**
 * @function listen
 * @summary Starts the Express server.
 *
 * @description This function starts the Express server on the specified port (3000).
 * Once the server is running, it listens for incoming requests and logs a message to the console indicating the server's status.
 *
 * @param {number} 3000 - The port number the server listens on.
 *
 * @returns {void}
 */
app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
