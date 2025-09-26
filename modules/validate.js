const { check, body, validationResult } = require("express-validator");
const config = require("../config.json");

/**
 * Validation rules for the calculate route.
 * @type {Array}
 */
const calculateRules = [
  check("legalAgreement")
    .isBoolean()
    .withMessage("Legal agreement field must be data type [boolean].")
    .bail() // Stop running validations if any of the previous ones have failed.
    .equals("true")
    .withMessage("You must agree to the legal disclaimer."),

  check("patientAge")
    .custom((value) => {
      //use custom validator as isFloat will accept numbers with string datatype
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error("Patient age field must be data type [number].");
      }
      return true;
    })
    .bail()
    .isFloat({
      min: config.validation.patientAge.min,
      max: config.validation.patientAge.max,
    })
    .withMessage(
      `Patient age must be an decimal in the range ${config.validation.patientAge.min} to ${config.validation.patientAge.max}.`
    ),

  check("patientSex")
    .isString()
    .withMessage("Patient sex field must be data type [string].")
    .bail()
    .custom((value) => ["male", "female"].includes(value))
    .withMessage("Patient sex must be male or female."),

  check("protocolStartDatetime")
    .isISO8601() // Validates the input as an ISO 8601 date
    .withMessage("Protocol start datetime must be ISO8601 date format.")
    .bail()
    .custom((value) => {
      const datetime = new Date(value);
      const now = new Date();
      const minDatetime = new Date(
        now.getTime() -
          config.validation.protocolStartDatetime.withinPastHours *
            60 *
            60 *
            1000 - //minus 10 minutes to allow for time taken to fill in form
          10 * 60 * 1000
      );

      if (datetime < minDatetime) {
        throw new Error(
          `Protocol start datetime must be within the last ${config.validation.protocolStartDatetime.withinPastHours} hours.`
        );
      }

      const maxDatetime = new Date(
        now.getTime() +
          config.validation.protocolStartDatetime.withinFutureHours *
            60 *
            60 *
            1000
      );

      if (datetime > maxDatetime) {
        throw new Error(
          `Protocol start datetime must no more than ${
            config.validation.protocolStartDatetime.withinFutureHours
          } ${
            config.validation.protocolStartDatetime.withinFutureHours === 1
              ? "hour"
              : "hours"
          } in the future.`
        );
      }

      return true;
    }),

  check("pH")
    .optional()
    .custom((value) => {
      //use custom validator as isFloat will accept numbers with string datatype
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error("pH field must be data type [float].");
      }
      return true;
    })
    .bail()
    .isFloat({
      min: config.validation.pH.min,
      max: config.validation.pH.max,
    })
    .withMessage(
      `pH must be in range ${config.validation.pH.min} to ${config.validation.pH.max}.`
    ),

  check("bicarbonate")
    .optional()
    .custom((value) => {
      //use custom validator as isFloat will accept numbers with string datatype
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error("Bicarbonate field must be data type [float].");
      }
      return true;
    })
    .bail()
    .isFloat({
      min: config.validation.bicarbonate.min,
      max: config.validation.bicarbonate.max,
    })
    .withMessage(
      `Bicarbonate must be in range ${config.validation.bicarbonate.min} to ${config.validation.bicarbonate.max}.`
    ),

  check("gcs")
    .custom((value) => {
      const num = Number(value);

      if (!Number.isInteger(num)) {
        throw new Error("GCS field must be data type [integer].");
      }

      return true;
    })
    .bail()
    .isFloat({
      min: config.validation.gcs.min,
      max: config.validation.gcs.max,
    })
    .withMessage(
      `GCS must be in range ${config.validation.gcs.min} to ${config.validation.gcs.max}.`
    ),

  check("glucose")
    .custom((value) => {
      //use custom validator as isFloat will accept numbers with string datatype
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(
          "If provided, glucose field must be data type [float]."
        );
      }
      return true;
    })
    .bail()
    .isFloat({
      min: config.validation.glucose.min,
      max: config.validation.glucose.max,
    })
    .withMessage(
      `If provided, glucose must be in range ${config.validation.glucose.min} to ${config.validation.glucose.max}.`
    ),

  check("bloodKetones")
    .if(body("urineKetones").equals(""))
    .custom((value) => {
      //use custom validator as isFloat will accept numbers with string datatype
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(
          "If provided, blood ketones field must be data type [float]."
        );
      }
      return true;
    })
    .bail()
    .isFloat({
      min: config.validation.bloodKetones.min,
    })
    .withMessage(
      `If provided, blood ketones must be at least ${config.validation.bloodKetones.min}mmol/L (the diagnostic threshold for DKA).`
    ),

  check("urineKetones")
    .if(body("bloodKetones").equals(""))
    .custom((value) => {
      //use custom validator as isFloat will accept numbers with string datatype
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(
          "If provided, urine ketones field must be data type [integer]."
        );
      }
      return true;
    })
    .bail()
    .isFloat({
      min: config.validation.urineKetones.min,
    })
    .withMessage(
      `If provided, urine ketones must be at least ${config.validation.urineKetones.min}+ (the diagnostic threshold for DKA).`
    ),

  check("weight")
    .isFloat({
      min: config.validation.weight.min,
      max: config.validation.weight.max,
    })
    .withMessage(
      `Weight must be a valid number between ${config.validation.weight.min} and ${config.validation.weight.max}.`
    ),

  check("weightLimitOverride")
    .isBoolean()
    .withMessage("Weight limit override field must be data type [boolean]."),

  check("use2SD")
    .isBoolean()
    .withMessage("Used 2SD weight function field must be data type [boolean]."),

  check("shockPresent")
    .isBoolean()
    .withMessage("Clinical shock status field must be data type [boolean]."),

  check("insulinRate")
    .isFloat()
    .withMessage("Insulin rate field must be data type [float].")
    .bail()
    .custom((value) => config.validation.insulinRate.options.includes(value))
    .withMessage("Invalid insulin rate option provided."),

  check("preExistingDiabetes")
    .isBoolean()
    .withMessage(
      "Pre-existing diabetes status field must be data type [boolean]."
    ),

  check("underFollowUp")
    .if(body("preExistingDiabetes").equals("true"))
    .isBoolean()
    .withMessage("Under follow up field must be data type [boolean]."),

  check("episodeType")
    .isAlpha()
    .withMessage(
      "Episode type field must be data type [string], containing only alpha characters."
    )
    .bail()
    .custom((value) => config.validation.episodeType.options.includes(value))
    .withMessage("Invalid episode type option provided."),

  check("operationalCentre")
    .isString()
    .withMessage("Operational centre field must be data type [string].")
    .escape(),

  check("project")
    .isString()
    .withMessage("Project field must be data type [string].")
    .escape(),

  check("appVersion")
    .isObject()
    .withMessage("App version field must be data type [object].")
    .bail()
    .custom((obj) =>
      Object.values(obj).every(
        (value) => typeof value === "string" && /^[a-zA-Z0-9 .]+$/.test(value)
      )
    )
    .withMessage(
      "Each app version property value must be data type [string], containing stop and alphanumeric characters only."
    ),

  check("clientDatetime")
    .isISO8601() // Validates the input as an ISO 8601 date
    .withMessage("Client datetime must be ISO8601 date format."),

  check("clientUseragent")
    .isString()
    .withMessage("Client useragent field must be data type [string].")
    .escape(),
];

const sodiumOsmoRules = [
  check("sodium")
    .custom((value) => {
      //use custom validator as isFloat will accept numbers with string datatype
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error("Sodium value must be data type [float].");
      }
      return true;
    })
    .isFloat({
      min: config.validation.sodium.min,
      max: config.validation.sodium.max,
    })
    .withMessage(
      `Sodium value must be between ${config.validation.sodium.min} and ${config.validation.sodium.max} mmol/L.`
    ),

  check("glucose")
    .custom((value) => {
      //use custom validator as isFloat will accept numbers with string datatype
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error("Glucose value must be data type [float].");
      }
      return true;
    })
    .isFloat({
      min: config.validation.glucose.min,
      max: config.validation.glucose.max,
    })
    .withMessage(
      `Glucose value must be between ${config.validation.glucose.min} and ${config.validation.glucose.max} mmol/L.`
    ),

  check("clientUseragent")
    .isString()
    .withMessage("Client useragent field must be data type [string].")
    .escape(),

  check("appVersion")
    .isObject()
    .withMessage("App version field must be data type [object].")
    .bail()
    .custom((obj) =>
      Object.values(obj).every(
        (value) => typeof value === "string" && /^[a-zA-Z0-9 .]+$/.test(value)
      )
    )
    .withMessage(
      "Each app version property value must be data type [string], containing stop and alphanumeric characters only."
    ),
];

// Middleware function to validate the request
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

module.exports = {
  calculateRules,
  sodiumOsmoRules,
  validateRequest,
};
