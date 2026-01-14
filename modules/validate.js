const { check, body, validationResult } = require("express-validator");
const config = require("../config.json");

/**
 * Validation rules for the calculate route.
 * @type {Array}
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
      "Episode type field must be data type [string], containing only alphabetical characters."
    )
    .bail()
    .custom((value) => config.validation.episodeType.options.includes(value))
    .withMessage("Invalid episode type option provided."),

  check("patientSex")
    .isAlpha()
    .withMessage(
      "Patient sex field must be data type [string], containing only alphabetical characters."
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
      `Weight must be a valid number between ${config.validation.weight.min} and ${config.validation.weight.max}.`
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
      max: config.validation.patientAge.max,
    })
    .withMessage(
      `Patient age must be an decimal in the range ${config.validation.patientAge.min} to ${config.validation.patientAge.max}.`
    ),

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
      "Blood ketones availability field must be data type [boolean]."
    ),

  check("syringePumpAvailable")
    .isBoolean()
    .withMessage(
      "Syringe pump availability field must be data type [boolean]."
    ),

  check("infusionPumpAvailable")
    .isBoolean()
    .withMessage(
      "Infusion pump availability field must be data type [boolean]."
    ),

  check("dropFactor")
    .if(body("infusionPumpAvailable").equals("false"))
    .isIn(config.validation.dropFactor.map((d) => String(d.drops)))
    .withMessage(
      "Drop factor field must match one of the allowed drops/minute values."
    ),

  //clinical details
  check("glucoseUnit")
    .isIn(config.validation.glucose.units)
    .withMessage("Invalid glucose unit option provided."),

  check("glucose")
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
          `Glucose must be in range ${config.validation.glucose.units[unit].min} to ${config.validation.glucose.units[unit].max} ${unit}.`
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
      `If provided, blood ketones must be a decimal at least ${config.validation.bloodKetones.min}mmol/L (the diagnostic threshold for DKA).`
    ),

  check("urineKetones")
    .if(body("bloodKetones").equals(""))
    .isInt({
      min: config.validation.urineKetones.min,
    })
    .withMessage(
      `If provided, urine ketones must be an integer at least ${config.validation.urineKetones.min}+ (the diagnostic threshold for DKA).`
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
      `pH must be a decimal in the range ${config.validation.pH.min} to ${config.validation.pH.max}.`
    ),

  check("bicarbonate")
    .optional()
    .isFloat({
      min: config.validation.bicarbonate.min,
      max: config.validation.bicarbonate.max,
    })
    .withMessage(
      `Bicarbonate must be a decimal in the range ${config.validation.bicarbonate.min} to ${config.validation.bicarbonate.max}.`
    ),

  check("shockPresent")
    .isBoolean()
    .withMessage("Clinical shock status field must be data type [boolean]."),

  check("gcs")
    .if(body("shockPresent").equals("false")) //optional if shockPresent is true
    .isFloat({
      min: config.validation.gcs.min,
      max: config.validation.gcs.max,
    })
    .withMessage(
      `GCS must be an integer in the range ${config.validation.gcs.min} to ${config.validation.gcs.max}.`
    ),

  check("respiratorySupport")
    //optional if shockPresent is true or if gcs is <13
    .if(body("shockPresent").equals("false"))
    .if(body("gcs").isFloat({ min: config.validation.gcs.severeThreshold }))
    .isBoolean()
    .withMessage(
      "Respiratory support status field must be data type [boolean]."
    ),

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

  check("clientUseragent")
    .isString()
    .withMessage("Client useragent field must be data type [string].")
    .escape(),
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
  validateRequest,
};
