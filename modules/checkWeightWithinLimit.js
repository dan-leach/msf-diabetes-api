/**
 * @module checkWeightWithinLimit
 * @memberof module:dka-calculator-api
 * @summary Validates that a patient's weight lies within the expected centile range for their age and sex.
 *
 * @description
 * Compares the supplied weight against the lower and upper 2-standard-deviation (2SD) limits
 * stored in `config.weightLimits`, indexed by sex and age in whole months.
 *
 * The upper limit is additionally capped at `config.weightLimits.max` (the absolute maximum
 * weight the protocol supports) regardless of the centile table value.
 *
 * If `data.weightLimitOverride` is `true`, all centile checks are bypassed and the function
 * returns a passing result immediately. The hard maximum weight enforced during input
 * validation (`config.validation.weight.max`) still applies in that case.
 *
 * @requires ../config.json
 */

const config = require("../config.json");

/**
 * Checks whether a patient's weight is within the acceptable 2SD limits for their sex and age.
 *
 * @param {Object}  data                    - Validated patient data.
 * @param {boolean} data.weightLimitOverride - When `true`, centile checks are skipped.
 * @param {string}  data.patientSex          - "male" or "female" — selects the centile table.
 * @param {number}  data.patientAge          - Age in decimal years; converted to whole months internally.
 * @param {number}  data.weight              - Patient weight in kg.
 *
 * @returns {{ pass: true } | { pass: false, error: string }}
 *   An object with `pass: true` on success, or `pass: false` and a descriptive `error`
 *   string when the weight is outside the expected range.
 */
function checkWeightWithinLimit(data) {
  try {
    // Skip centile checks when the clinician has explicitly overridden the weight limit.
    if (data.weightLimitOverride)
      return {
        pass: true,
      };

    // Convert decimal age to whole months for look-up in the centile arrays.
    const ageInMonths = (data.patientAge * 12).toFixed(0);

    const limit = {
      /**
       * Returns the lower 2SD weight limit for the patient's sex and age in months.
       *
       * @returns {number} Lower weight limit in kg.
       */
      lower() {
        return config.weightLimits[data.patientSex].lower[ageInMonths];
      },
      /**
       * Returns the upper 2SD weight limit for the patient's sex and age in months,
       * capped at the protocol maximum (`config.weightLimits.max`).
       *
       * @returns {number} Upper weight limit in kg.
       */
      upper() {
        let upper = config.weightLimits[data.patientSex].upper[ageInMonths];
        if (upper > config.weightLimits.max) upper = config.weightLimits.max;
        return upper;
      },
    };

    const weight = data.weight;

    // Fail if the weight is below the lower limit or above the upper limit.
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
