/**
 * @module DKA_Calculator_API The DKA Calculator API application setup and routing.
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
const {
  validateRequest,
  updateRules,
  calculateRules,
  sodiumOsmoRules,
} = require("./modules/validate");
const { handleError } = require("./modules/handleError");
const app = express();
app.use(cors());
app.use(bodyParser.json());

//required to get the client IP address as server behind proxy
app.set("trust proxy", 3);

/**
 * Rehashes the patient hash with salt.
 * @param {string} patientHash - The original patient hash.
 * @returns {string} - The rehashed patient hash.
 */
const rehashPatientHash = (patientHash) =>
  crypto
    .createHash("sha256")
    .update(patientHash + process.env.salt)
    .digest("hex");

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
    "Please go to <a href='https://dka-calculator.co.uk/'>https://dka-calculator.co.uk</a> instead."
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
    const config = require("./config.json");
    config.organisations.bsped.icpVersion = process.env.icpVersion;
    config.api.version = process.env.apiVersion;
    config.client.version = process.env.clientVersion;
    config.lastUpdated = process.env.lastUpdated;
    res.json(config);
  } catch (error) {
    handleError(
      error,
      500,
      "/config",
      "Failed to load configuration file",
      res
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
 * @requires ./modules/getImdDecile - Module to retrieve IMD decile based on patient postcode.
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
    const { getImdDecile } = require("./modules/getImdDecile");
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
        res
      );
    }

    //limit decimal age to 2 decimal places after checkWeighWithinLimit
    data.patientAge = data.patientAge.toFixed(2);

    //get the IP address of the client request
    const clientIP = req.ip;

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
        res
      );
    }

    //set undefined optional values to null
    data.bicarbonate = data.bicarbonate || null;
    data.glucose = data.glucose || null;
    data.ketones = data.ketones || null;

    //perform the 2nd stage hashing with salt
    const patientHash = data.patientHash
      ? rehashPatientHash(data.patientHash)
      : null;

    //get the imdDecile from the postcode
    const imdDecile = data.patientPostcode
      ? await getImdDecile(data.patientPostcode)
      : null;

    //generate a new unique auditID
    const auditID = await generateAuditID();

    //encrypt the data
    const encryptedData = encrypt({
      protocolStartDatetime: data.protocolStartDatetime,
      patientAge: data.patientAge,
      patientSex: data.patientSex,
      pH: data.pH,
      weight: data.weight,
      calculations: calculations,
      bicarbonate: data.bicarbonate,
      glucose: data.glucose,
      ketones: data.ketones,
      weightLimitOverride: data.weightLimitOverride,
      use2SD: data.use2SD,
      shockPresent: data.shockPresent,
      insulinRate: data.insulinRate,
      preExistingDiabetes: data.preExistingDiabetes,
      insulinDeliveryMethod: data.insulinDeliveryMethod,
      ethnicGroup: data.ethnicGroup,
      ethnicSubgroup: data.ethnicSubgroup,
      preventableFactors: data.preventableFactors,
      imdDecile: imdDecile,
    });

    //insert the data into the database
    await insertCalculateData(
      data,
      encryptedData,
      auditID,
      patientHash,
      clientIP
    );

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
      ]
    );
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
 * @route POST /update
 * @summary Updates episode data with validated fields and verifies patient identity through audit ID and hash matching.
 *
 * @description This endpoint receives a POST request to update patient episode data in the database, with validation
 * of patient identity and additional checks:
 * - Validates request data with `updateRules` and `validateRequest`.
 * - Confirms if the audit ID exists in the database and logs failed attempts if not.
 * - Verifies the patient's NHS number and date of birth through hash matching.
 * - Constructs a cerebral oedema object if applicable and stores the updated data.
 *
 * @requires ./modules/insertData - Module to insert or update data in the database.
 * @requires ./modules/updateCheck - Module to check and retrieve patient data based on audit ID.
 * @requires ./modules/encrypt - Module for encrypting calculated data before storage.
 *
 * @param {object} req - The request object, with validated update data.
 * @param {object} req.body - Contains patient data fields, including audit ID and patient hash.
 * @param {object} res - The response object for sending update results or error messages.
 *
 * @returns {string} 200 - Success message confirming the update.
 * @returns {string} 404 - Error message if audit ID is not found in the database.
 * @returns {string} 406 - Error message if the episode was created without providing an NHS number.
 * @returns {string} 401 - Error message if submitted patient hash does not match the stored patient hash.
 * @returns {object} 500 - Error message if a server error occurs.
 */
app.post("/update", updateRules, validateRequest, async (req, res) => {
  try {
    const { insertUpdateData } = require("./modules/insertData");
    const { updateCheck } = require("./modules/updateCheck");
    const { encrypt } = require("./modules/encrypt");

    //get the submitted data that passed validation
    const data = matchedData(req);

    //get the patientHash in the database for given audit ID to check correct patient
    const check = await updateCheck(data.auditID);

    //check the updateCheck found a record
    try {
      if (!check) {
        throw new Error(`Audit ID [${data.auditID}] not found in database`);
      }
    } catch (error) {
      handleError(error, 401, "/update", "Failed to perform update", res);
      return false;
    }

    //check the episode has a patientHash
    if (!check.patientHash) {
      res
        .status(406)
        .json(
          `The episode matching the audit ID [${data.auditID}] was created without providing an NHS number. Retrospective audit data updates are therefore not accepted.`
        );
      return;
    }

    //perform the second step hash before checking patientHash matches
    const patientHash = rehashPatientHash(data.patientHash);

    //check the submitted patientHash matches the database patient hash
    if (check.patientHash != patientHash) {
      res
        .status(401)
        .json(
          `Patient NHS number or date of birth do not match for episode with audit ID: ${data.auditID}`
        );
      const logEntry = `Failed update attempt (Hash non-matching) on auditID: ${
        data.auditID
      }, IP: ${req.ip}, Time: ${new Date().toISOString()}\n`;
      const fs = require("fs");
      fs.appendFileSync("./private/update_failed_attempts.txt", logEntry);
      return;
    }

    //get the IP address of the client request
    const clientIP = req.ip;

    const encryptedData = encrypt({
      protocolStartDatetime: data.protocolEndDatetime,
      preExistingDiabetes: data.preExistingDiabetes,
      preventableFactors: data.preventableFactors,
      cerebralOedema: {
        concern: data.cerebralOedemaConcern,
        imaging: data.cerebralOedemaImaging,
        treatment: data.cerebralOedemaTreatment,
      },
    });

    //update the database with new data
    await insertUpdateData(data, encryptedData, clientIP);

    res.json("Audit data update complete");
  } catch (error) {
    handleError(error, 500, "/update", "Failed to perform update", res);
  }
});

/**
 * @route POST /sodium-osmo
 * @summary Calculates and stores sodium and osmolality metrics for patient data.
 *
 * @description This endpoint receives a POST request with sodium and glucose levels, performs calculations,
 * and updates the database with the computed values:
 * - Validates the request data with `sodiumOsmoRules` and `validateRequest`.
 * - Computes corrected sodium and effective osmolality using `calculateCorrectedSodium` and `calculateEffectiveOsmolality`.
 * - Stores the results in the database along with the client IP.
 * - Returns the calculated values to the client.
 *
 * @requires ./modules/sodiumOsmo - Module for corrected sodium and effective osmolality calculations.
 * @requires ./modules/insertData - Module to insert calculated data into the database.
 *
 * @param {object} req - The request object, with validated data.
 * @param {object} req.body - Contains patient data fields including sodium and glucose levels.
 * @param {object} res - The response object to send calculation results or errors.
 *
 * @returns {object} 200 - JSON object with calculated `correctedSodium` and `effectiveOsmolality`.
 * @returns {object} 500 - JSON object with error message if a server error occurs.
 */
app.post("/sodium-osmo", sodiumOsmoRules, validateRequest, async (req, res) => {
  try {
    const {
      calculateCorrectedSodium,
      calculateEffectiveOsmolality,
    } = require("./modules/sodiumOsmo");
    const { insertSodiumOsmoData } = require("./modules/insertData");

    const data = matchedData(req);

    //get the IP address of the client request
    const clientIP = req.ip;

    //perform the calculations
    const calculations = {
      correctedSodium: calculateCorrectedSodium(data.sodium, data.glucose),
      effectiveOsmolality: calculateEffectiveOsmolality(
        data.sodium,
        data.glucose
      ),
    };

    //update the database with new data
    await insertSodiumOsmoData(data, calculations, clientIP);

    //return the calculations to the client
    res.status(200).json(calculations);
  } catch (error) {
    handleError(
      error,
      500,
      "/sodium-osmo",
      "Failed to perform calculations",
      res
    );
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
