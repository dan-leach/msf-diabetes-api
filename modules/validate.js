/**
 * @module validate
 * @memberof module:msf-diabetes-api
 * @summary Defines express-validator rule sets and the shared validation middleware.
 *
 * @description
 * Exports three arrays of express-validator `check` / `body` rules — one per API route
 * that accepts a request body — plus the `validateRequest` middleware that converts any
 * accumulated validation errors into a 400 JSON response.
 *
 * Rule sets exported:
 *  - `calculateRules`        — `POST /calculate`
 *  - `syncOfflineDataRules`  — `POST /sync-offline-data`
 *  - `feedbackRules`         — `POST /feedback`
 *
 * All numeric thresholds and enumerated options are read from `config.json` so the
 * validation stays in sync with the clinical constants without code changes.
 *
 * @requires express-validator
 * @requires ../config.json
 */

const { check, body, validationResult } = require("express-validator");
const config = require("../config.json");

/**
 * Validation rules for the `POST /calculate` route.
 *
 * Validates and sanitises every field that the calculation engine and database
 * insertion require. Optional fields (pH, bicarbonate, bloodKetones, urineKetones,
 * gcs, respiratorySupport) use conditional checks so that they are only required
 * when clinically appropriate.
 *
 * @type {import("express-validator").ValidationChain[]}
 */
const calculateRules = [
  //legal disclaimer
  check("legalAgreement")
    .isBoolean()
    .withMessage("Legal agreement field must be data type [boolean].")
    .bail() // Stop running validations if any of the previous ones have failed.
    .equals("true")
    .withMessage("You must agree to the legal disclaimer."),

  //patient details
  check("episodeType")
    .isAlpha()
    .withMessage(
      "Episode type field must be data type [string], containing only alphabetical characters.",
    )
    .bail()
    .custom((value) => config.validation.episodeType.options.includes(value))
    .withMessage("Invalid episode type option provided."),

  check("patientSex")
    .isAlpha()
    .withMessage(
      "Patient sex field must be data type [string], containing only alphabetical characters.",
    )
    .bail()
    .custom((value) => config.validation.patientSex.options.includes(value))
    .withMessage("Invalid patient sex option provided."),

  check("weight")
    .isFloat({
      min: config.validation.weight.min,
      max: config.validation.weight.max,
    })
    .withMessage(
      `Weight must be a valid number between ${config.validation.weight.min} and ${config.validation.weight.max}.`,
    ),

  check("operationalCentre")
    .isString()
    .withMessage("Operational centre field must be data type [string].")
    .escape(),

  check("project")
    .isString()
    .withMessage("Project field must be data type [string].")
    .escape(),

  check("patientAge")
    .isFloat({
      min: config.validation.patientAge.min,
    })
    .withMessage(
      `Patient age must be an decimal in the range ${config.validation.patientAge.min} to <${config.validation.patientAge.max} years.`,
    )
    .bail()
    .custom((value) => {
      // Not using max in isFloat as need to allow up to max but not including max.
      if (value >= config.validation.patientAge.max) {
        throw new Error(
          `Patient age must be less than ${config.validation.patientAge.max} years.`,
        );
      }
      return true;
    }),

  check("useYearsMonths")
    .isBoolean()
    .withMessage("Used years/months field must be data type [boolean]."),

  check("weightLimitOverride")
    .isBoolean()
    .withMessage("Weight limit override field must be data type [boolean]."),

  check("use2SD")
    .isBoolean()
    .withMessage("Used 2SD weight function field must be data type [boolean]."),

  //equipment availability
  check("bloodGasAvailable")
    .isBoolean()
    .withMessage("Blood gas availability field must be data type [boolean]."),

  check("bloodKetonesAvailable")
    .isBoolean()
    .withMessage(
      "Blood ketones availability field must be data type [boolean].",
    ),

  check("syringePumpAvailable")
    .isBoolean()
    .withMessage(
      "Syringe pump availability field must be data type [boolean].",
    ),

  check("infusionPumpAvailable")
    .isBoolean()
    .withMessage(
      "Infusion pump availability field must be data type [boolean].",
    ),

  // dropFactor is only required when no infusion pump is available.
  check("dropFactor")
    .if(body("infusionPumpAvailable").equals("false"))
    .isIn(config.validation.dropFactor.map((d) => String(d.drops)))
    .withMessage(
      "Drop factor field must match one of the allowed drops/minute values.",
    ),

  //clinical details
  check("glucoseUnit")
    .if((value, { req }) => {
      const glucoseHigh = req.body.glucoseHigh;
      return (
        glucoseHigh === "false" ||
        glucoseHigh === undefined ||
        glucoseHigh === null
      );
    })
    .isIn(config.validation.glucose.units)
    .withMessage("Invalid glucose unit option provided."),

  check("glucose")
    .if((value, { req }) => {
      const glucoseHigh = req.body.glucoseHigh;
      return (
        glucoseHigh === "false" ||
        glucoseHigh === undefined ||
        glucoseHigh === null
      );
    })
    .isFloat()
    .withMessage("Glucose field must be data type [float].")
    .bail()
    .custom((value, { req }) => {
      const unit = req.body.glucoseUnit;
      if (!config.validation.glucose.units.hasOwnProperty(unit))
        throw new Error("Invalid glucose unit option provided.");

      if (
        value < config.validation.glucose.units[unit].min ||
        value > config.validation.glucose.units[unit].max
      ) {
        throw new Error(
          `Glucose must be in range ${config.validation.glucose.units[unit].min} to ${config.validation.glucose.units[unit].max} ${unit}.`,
        );
      }

      return true;
    }),

  check("bloodKetones")
    .if(body("urineKetones").equals(""))
    .isFloat({
      min: config.validation.bloodKetones.min,
    })
    .withMessage(
      `If provided, blood ketones must be a decimal at least ${config.validation.bloodKetones.min}mmol/L (the diagnostic threshold for DKA).`,
    ),

  check("urineKetones")
    .if(body("bloodKetones").equals(""))
    .isInt({
      min: config.validation.urineKetones.min,
    })
    .withMessage(
      `If provided, urine ketones must be an integer at least ${config.validation.urineKetones.min}+ (the diagnostic threshold for DKA).`,
    ),

  check("diagnosticFeatures")
    .isBoolean()
    .withMessage("Diagnostic features field must be data type [boolean].")
    .bail()
    .equals("true")
    .withMessage("Diagnosis requires clinical features of DKA."),

  check("pH")
    .optional()
    .isFloat({
      min: config.validation.pH.min,
      max: config.validation.pH.max,
    })
    .withMessage(
      `pH must be a decimal in the range ${config.validation.pH.min} to ${config.validation.pH.max}.`,
    ),

  check("bicarbonate")
    .optional()
    .isFloat({
      min: config.validation.bicarbonate.min,
      max: config.validation.bicarbonate.max,
    })
    .withMessage(
      `Bicarbonate must be a decimal in the range ${config.validation.bicarbonate.min} to ${config.validation.bicarbonate.max}.`,
    ),

  check("shockPresent")
    .isBoolean()
    .withMessage("Clinical shock status field must be data type [boolean]."),

  // GCS is optional when shock is present (clinical severity then drives the protocol).
  check("gcs")
    .if(body("shockPresent").equals("false"))
    .isFloat({
      min: config.validation.gcs.min,
      max: config.validation.gcs.max,
    })
    .withMessage(
      `GCS must be an integer in the range ${config.validation.gcs.min} to ${config.validation.gcs.max}.`,
    ),

  // Respiratory support is optional when shocked or when GCS indicates severe impairment.
  check("respiratorySupport")
    .if(body("shockPresent").equals("false"))
    .if(body("gcs").isFloat({ min: config.validation.gcs.severeThreshold }))
    .isBoolean()
    .withMessage(
      "Respiratory support status field must be data type [boolean].",
    ),

  check("appVersion")
    .isObject()
    .withMessage("App version field must be data type [object].")
    .bail()
    .custom((obj) =>
      Object.values(obj).every(
        (value) => typeof value === "string" && /^[a-zA-Z0-9 .]+$/.test(value),
      ),
    )
    .withMessage(
      "Each app version property value must be data type [string], containing stop and alphanumeric characters only.",
    ),

  check("clientUseragent")
    .isString()
    .withMessage("Client useragent field must be data type [string].")
    .escape(),
];

/**
 * Validation rules for the `POST /sync-offline-data` route.
 *
 * Used when the client pushes an episode that was calculated offline and stored
 * in localStorage. Validates the auditID, raw data object, and encrypted data object.
 *
 * @type {import("express-validator").ValidationChain[]}
 */
const syncOfflineDataRules = [
  check("auditID")
    .isString()
    .withMessage("Audit ID field must be data type [string].")
    .escape(),

  check("data")
    .isObject()
    .withMessage("Data field must be data type [object].")
    .bail()
    .custom((obj) => {
      if (Object.keys(obj).length === 0) {
        throw new Error("Data field must not be an empty object.");
      }
      return true;
    }),

  check("encryptedData")
    .isObject()
    .withMessage("Encrypted data field must be data type [object].")
    .bail()
    .custom((obj) => {
      if (Object.keys(obj).length === 0) {
        throw new Error("Encrypted data field must not be an empty object.");
      }
      return true;
    }),
];

/**
 * Validation rules for the `POST /feedback` route.
 *
 * Validates the auditID (linking feedback to an episode) and the free-text feedback string.
 *
 * @type {import("express-validator").ValidationChain[]}
 */
const feedbackRules = [
  check("auditID")
    .isString()
    .withMessage("Audit ID field must be data type [string].")
    .escape(),

  check("feedbackText")
    .isString()
    .withMessage("Feedback field must be data type [string].")
    .escape(),
];

/**
 * Express middleware that collects the results of any preceding validation chains
 * and, if errors exist, terminates the request with a 400 response containing the
 * error array. If validation passes, control is passed to the next handler.
 *
 * @param {import("express").Request}  req  - Express request object.
 * @param {import("express").Response} res  - Express response object.
 * @param {import("express").NextFunction} next - Express next middleware function.
 * @returns {void}
 */
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

module.exports = {
  calculateRules,
  syncOfflineDataRules,
  feedbackRules,
  validateRequest,
};
