const config = require("../config.json");

/**
 * Performs calculations based on patient data to determine protocol parameters.
 * @param {Object} data - Patient data including weight, pH, etc.
 * @returns {Object} - An object containing calculated values and any errors encountered.
 */
const calculateVariables = (data) => {
  const errors = [];
  const weight = data.weight;

  /**
   * Utility function: converts a volume into a rate per unit time.
   * @param {number} volume - The total volume.
   * @param {number} unitTime - The time period over which the volume is administered.
   * @returns {number} - The rate of volume per unit time.
   */
  const volumeToRate = (volume, unitTime) => volume / unitTime;

  /**
   * Determines the severity of the condition based onpH, bicarbonate, urine ketones or blood ketones.
   * @returns {string|boolean} - Severity level ("severe", "standard") or false if no valid severity is found.
   */
  const calculateSeverity = () => {
    /**
     * Gets the severity based on pH, bicarbonate, urine ketones or blood ketones.
     * @returns {string} - The severity grade if matched, otherwise false.
     */
    const calculateVal = () => {
      if (data.pH && (data.bloodKetones || data.urineKetones)) {
        // Must check that ketones are also present
        if (data.pH < config.severity.severe.pHRange.upper) {
          return "severe";
        }
        if (
          data.bicarbonate &&
          data.bicarbonate < config.severity.standard.bicarbonateBelow
        ) {
          return "standard";
        }
        if (data.pH < config.severity.standard.pHRange.upper) {
          return "standard";
        }
        // Log error if no valid severity is found
        throw new Error(
          `pH of ${data.pH} and bicarbonate of ${data.bicarbonate} mmol/L does not meet the diagnostic threshold for DKA.`
        );
      } else if (data.bloodKetones || data.urineKetones) {
        if (
          data.gcs <= config.validation.gcs.severeThreshold ||
          data.shockPresent == "true" ||
          data.respiratorySupport == "true"
        )
          return "severe";
        return "standard";
      } else {
        throw new Error(
          "Insufficient data to determine DKA severity: pH, blood ketones or urine ketones required."
        );
      }
    };
    const val = calculateVal();
    const valText = val === "severe" ? "severe" : "standard";

    const formula = `pH [>=${config.severity.standard.pHRange.lower} and <${config.severity.standard.pHRange.upper}] or bicarbonate [<${config.severity.standard.bicarbonateBelow}mmol/L] ==> standard<br>pH [>=${config.severity.severe.pHRange.lower} and <${config.severity.severe.pHRange.upper}] ==> severe<br>GCS [<=${config.validation.gcs.severeThreshold}] or shock present [true] or respiratory support [true] ==> severe<br>GCS [>${config.validation.gcs.severeThreshold}] and shock present [false] and respiratory support [false] ==> standard`;

    /**
     * Generates a string showing the working used to find the severity level.
     * @returns {string} - The generated string.
     */
    const working = () => {
      if (!val) return false;
      let working;
      if (data.pH) {
        working = `pH [${data.pH}] is [>=${config.severity[val].pHRange.lower} and <${config.severity[val].pHRange.upper}] `;
        if (data.bicarbonate)
          working += `or bicarbonate [${data.bicarbonate}] is [<${config.severity[val].bicarbonateBelow}mmol/L] `;
        working += `==> ${valText}`;
      } else {
        if (val === "severe") {
          working = `Shock present [${data.shockPresent}] or GCS [${data.gcs} is <=${config.validation.gcs.severeThreshold}] or respiratory support [${data.respiratorySupport}] ==> ${valText}`;
        } else {
          working = `Shock present [${data.shockPresent}] and GCS [${data.gcs} is >${config.validation.gcs.severeThreshold}] and respiratory support [${data.respiratorySupport}] ==> ${valText}`;
        }
      }
      return working;
    };

    return {
      val,
      valText,
      formula,
      working: working(),
    };
  };
  const severity = calculateSeverity();

  /**
   * Calculates the bolus volume and rate based on patient weight and severity.
   * @returns {Object} - An object containing bolus volume and rate calculations.
   */
  const calculateBolus = () => {
    /**
     * Calculates the bolus volume based on patient weight and a given mL/kg rate.
     * @returns {Object} - An object containing the bolus volume, formula, limit, and other details.
     */
    const calculateVolume = () => {
      const weight = data.weight;
      const mlsPerKg = config.bolus.mlsPerKg;
      const cap = config.caps.bolus;

      // Calculate the uncapped bolus volume based on mL/kg.
      const uncapped = weight * mlsPerKg;

      // Determines if no bolus should be given based on GCS and shock presence.
      const noBolus =
        data.gcs <= config.validation.gcs.noBolusThreshold &&
        !data.shockPresent;

      // Checks if the uncapped bolus volume exceeds the cap.
      const isCapped = uncapped > cap;

      // Select the bolus volume to use between capped or uncapped volumes.
      let val = isCapped ? cap : uncapped;

      // Override bolus volume to 0 if no bolus criteria are met.
      if (noBolus) val = 0;

      // Generate string showing formula used to calculate the bolus volume.
      const formula = `[${mlsPerKg}mL/kg] x [Patient weight (kg)]<br>No bolus if GCS [<=${config.validation.gcs.noBolusThreshold}] and shock not present.`;

      // Generate string showing the bolus volume cap with units.
      const limit = `${cap}mL`;

      // Generate string showing working calculation for the bolus volume.
      const working = `[${mlsPerKg}mL/kg] x [${weight.toFixed(1)}kg] = ${
        isCapped ? "<s>" : ""
      }${uncapped.toFixed(0)}mL${isCapped ? "</s>" : ""} ${
        isCapped ? "(exceeds limit)" : ""
      }`;

      return {
        val,
        mlsPerKg,
        isCapped,
        formula,
        limit,
        working,
      };
    };
    const volume = calculateVolume();

    const calculateDuration = () => {
      // Get the bolus duration in hours based on shock status.
      const val = data.shockPresent
        ? config.bolus.duration.shock
        : config.bolus.duration.noShock;

      const formula = `Shock present [true] ==> ${config.bolus.duration.shock} hours<br>Shock present [false] ==> ${config.bolus.duration.noShock} hours`;

      const working = `Shock present [${data.shockPresent}] ==> ${val} hours`;

      return {
        val,
        formula,
        working,
      };
    };
    const duration = calculateDuration();

    /**
     * Calculates the bolus rate based on the bolus volume and severity.
     * @returns {Object} - An object containing the bolus rate, duration, formula, and working calculation.
     */
    const calculateRate = () => {
      // Calculate the bolus rate in mL/hour.
      const val = volumeToRate(volume.val, duration.val);

      // Generate string showing formula used to calculate the bolus rate.
      const formula = "[Bolus volume] ÷ [Bolus duration in hours]";

      // Generate string showing working calculation for the bolus rate.
      const working = `[${volume.val.toFixed(1)}mL] ÷ [${
        duration.val
      } hours] = ${val.toFixed(1)}mL/hour`;

      return {
        val,
        duration,
        formula,
        working,
      };
    };

    return {
      volume,
      duration,
      rate: calculateRate(),
    };
  };

  /**
   * Calculates the fluid deficit based on the severity of the condition and patient data.
   * @returns {Object} - An object containing deficit percentage, volume, and rate calculations.
   */
  const calculateDeficit = () => {
    /**
     * Determines the deficit percentage based on severity.
     * @returns {Object} - An object containing the deficit percentage, formula, and working calculation.
     */
    const calculatePercentage = () => {
      /**
       * Gets the deficit percentage based on severity.
       * @returns {number} - The deficit percentage.
       */
      const calculateVal = () => {
        const severityMap = {
          severe: config.severity.severe.deficitPercentage,
          standard: config.severity.standard.deficitPercentage,
        };
        if (severityMap.hasOwnProperty(severity.val)) {
          return severityMap[severity.val];
        } else {
          throw new Error(
            `Unable to select deficit percentage using severity rating [${severity.val}]`
          );
        }
      };
      const val = calculateVal();

      /**
       * Provides the formula used to determine the deficit percentage.
       * @returns {string} - The formula for determining deficit percentage.
       */
      const calculateFormula = () =>
        `Severity [standard] ==> ${config.severity.standard.deficitPercentage}%<br>Severity [severe] ==> ${config.severity.severe.deficitPercentage}%`;

      /**
       * Shows the working calculation for the deficit percentage.
       * @returns {string} - A string showing the detailed calculation.
       */
      const calculateWorking = () => {
        return `Severity [${severity.val}] ==> ${val}%`;
      };

      return {
        val: val,
        formula: calculateFormula(),
        working: calculateWorking(),
      };
    };
    const percentage = calculatePercentage();

    /**
     * Calculates the deficit volume based on the deficit percentage and patient weight.
     * @returns {Object} - An object containing deficit volume, formula, limit, working calculation, and capped status.
     */
    const calculateStandardSpeedVolume = () => {
      // Calculate the uncapped deficit volume.
      const uncapped = config.severity.standard.deficitPercentage * weight * 10;

      // Check if the uncapped deficit volume exceeds the cap.
      const isCapped = uncapped > config.caps.deficitStandard;

      // Calculate the deficit volume to use, selecting between capped or uncapped volumes.
      const val = isCapped ? deficitStandard : uncapped;

      // Generate string showing formula used to calculate the deficit volume.
      const formula =
        "[Deficit percentage (for standard DKA)] x [Patient weight] x 10";

      /**
       * Shows the working calculation for the deficit volume.
       * @returns {string} - A string showing the detailed calculation.
       */
      const working = `[${
        config.severity.standard.deficitPercentage
      }%] x [${weight.toFixed(1)} kg] x 10 = ${
        isCapped ? "<s>" : ""
      }${uncapped.toFixed(0)}mL${isCapped ? "</s>" : ""} ${
        isCapped ? "(exceeds limit)" : ""
      }`;

      return {
        val,
        formula,
        limit: config.caps.deficitStandard,
        working: working,
        isCapped: isCapped,
      };
    };
    const standardSpeedVolume = calculateStandardSpeedVolume();

    /**
     * FOR HIGH-SPEED HYPOGLYCAMIA REGIME: Calculates the deficit volume based on the deficit percentage and patient weight.
     * @returns {Object} - An object containing deficit volume, formula, limit, working calculation, and capped status.
     */
    const calculateHighSpeedVolume = () => {
      // Calculate the uncapped deficit volume.
      const uncapped = config.severity.severe.deficitPercentage * weight * 10;

      // Check if the uncapped deficit volume exceeds the cap.
      const isCapped = uncapped > config.caps.deficitSevere;

      // Calculate the deficit volume to use, selecting between capped or uncapped volumes.
      const val = isCapped ? config.caps.deficitSevere : uncapped;

      // Generate string showing formula used to calculate the deficit volume.
      const formula =
        "[Deficit percentage (for severe DKA)] x [Patient weight] x 10";

      /**
       * Shows the working calculation for the deficit volume.
       * @returns {string} - A string showing the detailed calculation.
       */
      const working = `[${
        config.severity.severe.deficitPercentage
      }%] x [${weight.toFixed(1)} kg] x 10 = ${
        isCapped ? "<s>" : ""
      }${uncapped.toFixed(0)}mL${isCapped ? "</s>" : ""} ${
        isCapped ? "(exceeds limit)" : ""
      }`;

      return {
        val,
        formula,
        limit: config.caps.deficitSevere,
        working: working,
        isCapped: isCapped,
      };
    };
    const highSpeedVolume = calculateHighSpeedVolume();

    /**
     * Calculates the rate at which the fluid deficit should be replaced.
     * @returns {Object} - An object containing the rate, formula, and working calculation.
     */
    const calculateRate = (vol) => {
      const replacementDuration = config.deficitReplacementDuration;
      //Calculate the fluid replacement rate in mL/hour.
      const val = volumeToRate(vol, replacementDuration);

      // Generate string showing the formula used to calculate the fluid replacement rate.
      const formula =
        "[Deficit volume] ÷ [deficit replacement duration in hours]";

      // Generate string showing the working calculation for the fluid replacement rate.
      const working = `[${vol.toFixed(
        0
      )}mL] ÷ [${replacementDuration} hours] = ${val.toFixed(1)}mL/hour`;

      return {
        val,
        formula,
        working,
      };
    };

    return {
      percentage,
      standardSpeedVolume,
      standardSpeedRate: calculateRate(standardSpeedVolume.val),
      highSpeedVolume,
      highSpeedRate: calculateRate(highSpeedVolume.val),
    };
  };
  const deficit = calculateDeficit();

  /**
   * Calculates the daily maintenance fluid volume and rate based on patient weight.
   * @returns {Object} - An object containing maintenance volume and rate.
   */
  const calculateMaintenance = () => {
    /**
     * Calculates the daily maintenance volume based on patient weight.
     * @returns {Object} - An object containing the volume, formula, limit, and working calculation.
     */
    const calculateVolume = () => {
      const cap = config.caps.maintenance;
      /**
       * Calculates the uncapped maintenance volume.
       * @returns {number} - The uncapped maintenance volume in mL.
       */
      const calculateUncapped = () => {
        if (weight < 10) return weight * 100;
        if (weight < 20) return (weight - 10) * 50 + 1000;
        return (weight - 20) * 20 + 1500;
      };
      const uncapped = calculateUncapped();

      // Check if the uncapped maintenance volume exceeds the cap.
      const isCapped = uncapped > cap;

      // Calculate the maintenance volume to use, selecting between capped or uncapped volumes.
      const val = isCapped ? cap : uncapped;

      /**
       * Provides the formula used to calculate the maintenance volume.
       * @returns {string} - The formula for calculating the maintenance volume.
       */
      const calculateFormula = () => {
        if (weight < 10) return "[Weight (kg)] x 100";
        if (weight < 20) return "1000 + [(Weight (kg) - 10) x 50]";
        return "1500 + [(Weight (kg) - 20) x 20]";
      };

      // Generate string showing the maintenance volume limit.
      const limit = `${cap} mL`;

      /**
       * Shows the working calculation for the maintenance volume.
       * @returns {string} - A string showing the detailed calculation.
       */
      const calculateWorking = () => {
        const formatResult = (calculation) =>
          `${calculation} = ${isCapped ? "<s>" : ""}${uncapped.toFixed(0)}mL${
            isCapped ? "</s>" : ""
          } ${isCapped ? "(exceeds limit)" : ""}`;

        if (weight < 10) {
          return formatResult(`[${weight.toFixed(1)}kg] x 100`);
        } else if (weight < 20) {
          return formatResult(`1000 + [(${weight.toFixed(1)}kg - 10) x 50]`);
        } else {
          return formatResult(`1500 + [(${weight.toFixed(1)}kg - 20) x 20]`);
        }
      };

      return {
        val,
        formula: calculateFormula(),
        limit,
        working: calculateWorking(),
      };
    };
    const volume = calculateVolume();

    /**
     * Calculates the daily maintenance fluid rate.
     * @returns {Object} - An object containing the rate, formula, and working calculation.
     */
    const calculateRate = () => {
      // Calculate the daily maintenance fluid rate in mL/hour.
      const val = volume.val / 24;

      // Generate string showing the formula used to calculate the daily maintenance fluid rate.
      const formula = "[Daily maintenance volume] ÷ 24 hours";

      // Generate string showing the working calculation for the daily maintenance fluid rate.
      const working = `[${volume.val.toFixed(0)}mL] ÷ 24 hours = ${val.toFixed(
        1
      )}mL/hour`;

      return {
        val,
        formula,
        working,
      };
    };

    return {
      volume,
      rate: calculateRate(),
    };
  };
  const maintenance = calculateMaintenance();

  /**
   * Calculates the starting fluid rate by summing deficit and maintenance rates.
   * @returns {Object} - An object containing the calculated rate value, formula, and working calculation.
   */
  const calculateBagSpeeds = () => {
    // Calculate the speed fluid rate by summing deficit and maintenance rates.
    const calculateSpeed = (
      deficitRate,
      maintenanceRate,
      deficitPercentage
    ) => {
      // Calculate the speed fluid rate in mL/hour.
      const val = deficitRate + maintenanceRate;

      // Generate string showing the formula used to calculate the fluid rate.
      const formula = `[Deficit replacement rate for ${deficitPercentage}% deficit] + [Maintenance rate]`;

      // Generate string showing the working calculation for the fluid rate.
      const working = `[${deficitRate.toFixed(
        1
      )}mL/hour] + [${maintenanceRate.toFixed(1)}mL/hour] = ${val.toFixed(
        1
      )}mL/hour`;

      return {
        val,
        formula,
        working,
      };
    };

    const standardSpeed = calculateSpeed(
      deficit.standardSpeedRate.val,
      maintenance.rate.val,
      config.severity.standard.deficitPercentage
    );

    const highSpeed = calculateSpeed(
      deficit.highSpeedRate.val,
      maintenance.rate.val,
      config.severity.severe.deficitPercentage
    );

    // Calculate the half-speed fluid rate.
    const calculateHalfSpeed = (fullSpeed) => {
      // Calculate the half-speed fluid rate in mL/hour.
      const val = fullSpeed / 2;

      // Generate string showing the formula used to calculate the half-speed fluid rate.
      const formula = "[Full speed rate] ÷ 2";

      // Generate string showing the working calculation for the half-standard-speed fluid rate.
      const working = `[${fullSpeed.toFixed(1)}mL/hour] ÷ 2 = ${val.toFixed(
        1
      )}mL/hour`;
      return {
        val,
        formula,
        working,
      };
    };

    let isSevere;
    if (severity.val === "severe") {
      isSevere = true;
    } else if (severity.val === "standard") {
      isSevere = false;
    } else {
      throw new Error(
        "Unable to select between standard-speed and high-speed fluid regimes: severity undefined."
      );
    }

    return {
      standardSpeed: isSevere ? null : standardSpeed,
      halfStandardSpeed: isSevere
        ? null
        : calculateHalfSpeed(standardSpeed.val),
      highSpeed: isSevere ? highSpeed : null,
      halfHighSpeed: isSevere ? calculateHalfSpeed(highSpeed.val) : null,
      hypoSpeed: highSpeed,
    };
  };

  /**
   * Calculates the IV insulin rate based on patient weight and age.
   * @returns {Object} - An object containing the calculated insulin rate, formula, limit, and working calculation.
   */
  const calculateInsulinRate = () => {
    // Select rate based on patient age.
    const rateUnitsPerKgPerHour =
      data.patientAge < config.insulin.ageThreshold
        ? config.insulin.rateOptions[0]
        : config.insulin.rateOptions[1];

    // Select cap based on patient age.
    const capped =
      data.patientAge < config.insulin.ageThreshold
        ? config.caps.insulinRate005
        : config.caps.insulinRate01;

    // Calculate the uncapped insulin rate (in units/hr) based on patient weight and insulin rate in units/kg/hr.
    const uncapped = rateUnitsPerKgPerHour * weight;

    // Check if the uncapped insulin rate exceeds the cap.
    const isCapped = uncapped > capped;

    // Calculate the insulin rate to use, selecting between capped or uncapped rates.
    const val = isCapped ? capped : uncapped;

    // Generate string showing the formula used to calculate the insulin rate.
    const formula = `[Insulin rate: ${config.insulin.rateOptions[0]} Units/kg/hr if patient age <${config.insulin.ageThreshold}, else ${config.insulin.rateOptions[1]} Units/kg/hr] x [Patient weight]`;

    // Generate string showing the limit for the insulin rate based on the selected option.
    const limit = `${capped} Units/hour (for ${rateUnitsPerKgPerHour} Units/kg/hour)`;

    // Generate string showing the working calculation for the insulin rate.
    const working = `[${rateUnitsPerKgPerHour} Units/kg/hour] x [${weight.toFixed(
      1
    )}kg] = ${isCapped ? "<s>" : ""}${uncapped.toFixed(2)} Units/hour${
      isCapped ? "</s>" : ""
    } ${isCapped ? "(exceeds limit)" : ""}`;

    return {
      val,
      isCapped,
      formula,
      limit,
      working,
    };
  };

  /**
   * Calculates the IV insulin rate based on patient weight and age.
   * @returns {Object} - An object containing the calculated insulin rate, formula, limit, and working calculation.
   */
  const calculateInsulinDose = () => {
    // Select dose based on patient age.
    const doseUnitsPerKg =
      data.patientAge < config.insulin.ageThreshold
        ? config.insulin.doseOptions[0]
        : config.insulin.doseOptions[1];

    // Select cap based on patient age.
    const capped =
      data.patientAge < config.insulin.ageThreshold
        ? config.caps.insulinDose01
        : config.caps.insulinDose02;

    // Calculate the uncapped insulin dose (in units) based on patient weight and insulin dose in units/kg.
    const uncapped = doseUnitsPerKg * weight;

    // Check if the uncapped insulin dose exceeds the cap.
    const isCapped = uncapped > capped;

    // Calculate the insulin dose to use, selecting between capped or uncapped doses.
    const val = isCapped ? capped : uncapped;

    // Generate string showing the formula used to calculate the insulin dose.
    const formula = `[Insulin dose: ${config.insulin.doseOptions[0]} Units/kg if patient age <${config.insulin.ageThreshold}, else ${config.insulin.doseOptions[1]} Units/kg] x [Patient weight]`;

    // Generate string showing the limit for the insulin dose based on the selected option.
    const limit = `${capped} Units (for ${doseUnitsPerKg} Units/kg)`;

    // Generate string showing the working calculation for the insulin dose.
    const working = `[${doseUnitsPerKg} Units/kg] x [${weight.toFixed(
      1
    )}kg] = ${isCapped ? "<s>" : ""}${uncapped.toFixed(2)} Units${
      isCapped ? "</s>" : ""
    } ${isCapped ? "(exceeds limit)" : ""}`;

    return {
      val,
      isCapped,
      formula,
      limit,
      working,
    };
  };

  return {
    severity,
    bolus: calculateBolus(),
    deficit,
    maintenance,
    bagSpeeds: calculateBagSpeeds(),
    insulinRate: calculateInsulinRate(),
    insulinDose: calculateInsulinDose(),
    errors: errors,
  };
};

module.exports = { calculateVariables };
