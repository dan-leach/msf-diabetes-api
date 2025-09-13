const config = require("../config.json");

/**
 * Checks if the patient's weight is within the acceptable limits based on their sex and age.
 * If the `weightLimitOverride` flag is set, the function will skip the checks and return `true` (Hard maximum is already checked in validateAndSanitize).
 *
 * @param {Object} data - The input data object containing patient information and configuration settings.
 * @param {boolean} data.weightLimitOverride - Flag to bypass weight limit checks.
 * @param {string} data.patientSex - The sex of the patient, used to determine weight limits.
 * @param {number} data.patientAge - The age of the patient in years.
 * @param {number} data.weight - The weight of the patient.
 * @returns {Object} An object containing the result of the check.
 * @returns {boolean} returns.pass - Indicates if the weight is within the limit.
 * @returns {string} returns.error - Error message if the check fails.
 */
function checkWeightWithinLimit(data) {
  try {
    //skip checks if weightLimitOverride is true
    if (data.weightLimitOverride)
      return {
        pass: true,
      };

    const ageInMonths = (data.patientAge * 12).toFixed(0);

    const limit = {
      /**
       * Returns the lower weight limit based on patient sex and age in months.
       * @returns {number} - The lower weight limit.
       */
      lower() {
        return config.weightLimits[data.patientSex].lower[ageInMonths];
      },
      /**
       * Returns the upper weight limit based on patient sex and age in months, capped by the maximum allowed weight.
       * @returns {number} - The upper weight limit.
       */
      upper() {
        let upper = config.weightLimits[data.patientSex].upper[ageInMonths];
        if (upper > config.weightLimits.max) upper = config.weightLimits.max;
        return upper;
      },
    };

    const weight = data.weight;
    //check the weight is within range
    if (
      weight < limit.lower().toFixed(2) ||
      weight > limit.upper().toFixed(2)
    ) {
      throw `If weight limit override is not selected, weight must be within 2 standard deviations of the mean for age (upper limit ${
        config.weightLimits.max
      }kg) (range ${limit.lower().toFixed(2)}kg to ${limit
        .upper()
        .toFixed(2)}kg for ${data.patientSex} patient aged ${Math.floor(
        data.patientAge
      )} years and ${ageInMonths - Math.floor(data.patientAge) * 12} months).`;
    }
    return {
      pass: true,
    };
  } catch (error) {
    return {
      pass: false,
      error: error.toString(),
    };
  }
}

module.exports = { checkWeightWithinLimit };
