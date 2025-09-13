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
   * Determines the severity of the condition based on pH and bicarbonate levels.
   * @returns {string|boolean} - Severity level ("severe", "moderate", "mild") or false if no valid severity is found.
   */
  const calculateSeverity = () => {
    /**
     * Gets the severity based on pH and bicarbonate.
     * @returns {string} - The severity grade if matched, otherwise false.
     */
    const calculateVal = () => {
      /**
       * Checks if the given pH and bicarbonate values fall within the range for a specific severity level.
       * @param {Object} levelConfig - Configuration for the severity level.
       * @returns {string|false} - Severity level if matched, otherwise false.
       */
      const checkSeverityLevel = (levelConfig) => {
        const { pHRange, bicarbonateBelow } = levelConfig;

        if (
          (data.pH < pHRange.upper && data.pH >= pHRange.lower) ||
          (typeof data.bicarbonate !== undefined &&
            data.bicarbonate < bicarbonateBelow)
        ) {
          return levelConfig.severity;
        }

        return false;
      };

      // Severity levels configuration
      const severityLevels = [
        { severity: "severe", ...config.severity.severe },
        { severity: "moderate", ...config.severity.moderate },
        { severity: "mild", ...config.severity.mild },
      ];

      // Check each severity level
      for (const levelConfig of severityLevels) {
        const result = checkSeverityLevel(levelConfig);
        if (result) {
          return result;
        }
      }

      // Log error if no valid severity is found
      throw new Error(
        `pH of ${data.pH} and bicarbonate of ${data.bicarbonate} mmol/L does not meet the diagnostic threshold for DKA.`
      );
    };
    const val = calculateVal();

    const formula = `pH [>=${config.severity.mild.pHRange.lower} and <${config.severity.mild.pHRange.upper}] or bicarbonate [<${config.severity.mild.bicarbonateBelow}mmol/L] ==> mild<br>pH [>=${config.severity.moderate.pHRange.lower} and <${config.severity.moderate.pHRange.upper}] or bicarbonate [<${config.severity.moderate.bicarbonateBelow}mmol/L] ==> moderate<br>pH [>=${config.severity.severe.pHRange.lower} and <${config.severity.severe.pHRange.upper}] or bicarbonate [<${config.severity.severe.bicarbonateBelow}mmol/L] ==> severe<br>(if bicarbonate and pH return different severity levels, most severe option is used)`;

    /**
     * Generates a string showing the working used to find the severity level.
     * @returns {string} - The generated string.
     */
    const working = () => {
      if (!val) return false;
      let working = `pH [${data.pH}] is [>=${config.severity[val].pHRange.lower} and <${config.severity[val].pHRange.upper}] `;
      if (data.bicarbonate)
        working += `or bicarbonate [${data.bicarbonate}] is [<${config.severity[val].bicarbonateBelow}mmol/L] `;
      working += `==> ${val}`;
      return working;
    };

    return {
      val,
      formula,
      working: working(),
    };
  };
  const severity = calculateSeverity();

  /**
   * Calculates the bolus volume based on patient weight and a given mL/kg rate.
   * @returns {Object} - An object containing the bolus volume, formula, limit, and other details.
   */
  const calculateBolusVolume = () => {
    const weight = data.weight;
    const mlsPerKg = config.mlsPerKg.bolus;
    const cap = config.caps.bolus;

    // Calculate the uncapped bolus volume based on mL/kg.
    const uncapped = weight * mlsPerKg;

    // Checks if the uncapped bolus volume exceeds the cap.
    const isCapped = uncapped > cap;

    // Select the bolus volume to use between capped or uncapped volumes.
    const val = isCapped ? cap : uncapped;

    // Generate string showing formula used to calculate the bolus volume.
    const formula = `[${mlsPerKg}mL/kg] x [Patient weight (kg)]`;

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
  const bolusVolume = calculateBolusVolume();

  /**
   * Calculates the fluid deficit based on the severity of the condition and patient data.
   * @returns {Object} - An object containing deficit percentage, volume, and rate calculations.
   */
  const calculateDeficit = () => {
    const pH = data.pH;
    const bicarbonate = data.bicarbonate;
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
          moderate: config.severity.moderate.deficitPercentage,
          mild: config.severity.mild.deficitPercentage,
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
        `Severity [mild] ==> ${config.severity.mild.deficitPercentage}%<br>Severity [moderate] ==> ${config.severity.moderate.deficitPercentage}%<br>Severity [severe] ==> ${config.severity.severe.deficitPercentage}%`;

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
    const calculateVolume = () => {
      const capsMap = {
        5: config.caps.deficit5,
        10: config.caps.deficit10,
      };

      // Calculate the uncapped deficit volume.
      const uncapped = percentage.val * weight * 10;

      /**
       * Provides the capped deficit volume limit.
       * @returns {number|boolean} - The capped deficit volume in mL or false if unable to select the cap.
       */
      const calculateCapped = () => {
        if (capsMap.hasOwnProperty(percentage.val)) {
          return capsMap[percentage.val];
        } else {
          throw new Error(
            `Unable to select deficit volume cap using deficit percentage [${percentage.val}].`
          );
        }
      };
      const capped = calculateCapped();

      // Check if the uncapped deficit volume exceeds the cap.
      const isCapped = uncapped > capped;

      // Calculate the deficit volume to use, selecting between capped or uncapped volumes.
      const val = isCapped ? capped : uncapped;

      // Generate string showing formula used to calculate the deficit volume.
      const formula = "[Deficit percentage] x [Patient weight] x 10";

      /**
       * Generate string showing deficit volume limit based on percentage.
       * @returns {string} - The deficit volume limit in mL.
       */
      const calculateLimit = () => {
        if (capsMap.hasOwnProperty(percentage.val)) {
          return `${capsMap[percentage.val]} mL (for ${
            percentage.val
          }% deficit)`;
        } else {
          throw new Error(
            `Unable to generate deficit volume limit string using deficit percentage [${percentage.val}].`
          );
        }
      };

      /**
       * Shows the working calculation for the deficit volume.
       * @returns {string} - A string showing the detailed calculation.
       */
      const working = `[${percentage.val}%] x [${weight.toFixed(
        1
      )} kg] x 10 = ${isCapped ? "<s>" : ""}${uncapped.toFixed(0)}mL${
        isCapped ? "</s>" : ""
      } ${isCapped ? "(exceeds limit)" : ""}`;

      return {
        val,
        formula,
        limit: calculateLimit(),
        working: working,
        isCapped: isCapped,
      };
    };
    const volume = calculateVolume();

    /**
     * Calculates the deficit volume less the bolus volume.
     * @returns {Object} - An object containing the volume less bolus, bolus to subtract, formula, and working calculation.
     */
    const calculateVolumeLessBolus = () => {
      // Calculate the bolus volume to subtract based on clinical shock status.
      const bolusToSubtract = data.shockPresent ? 0 : bolusVolume.val;

      // Provides the deficit volume less bolus.
      const val = volume.val - bolusToSubtract;

      // Generate string showing formula used to calculate the volume less bolus.
      const formula = `[Deficit volume] - [${config.mlsPerKg.bolus}mL/kg bolus (only for non-shocked patients)]`;

      /**
       * Shows the working calculation for the volume less bolus.
       * @returns {string} - A string showing the detailed calculation.
       */
      const working = `[${volume.val.toFixed(
        0
      )}mL] - [${bolusToSubtract.toFixed(0)}mL] = ${val.toFixed(0)}mL`;

      return {
        bolusToSubtract,
        val,
        formula,
        working,
      };
    };
    const volumeLessBolus = calculateVolumeLessBolus();

    /**
     * Calculates the rate at which the fluid deficit should be replaced.
     * @returns {Object} - An object containing the rate, formula, and working calculation.
     */
    const calculateRate = () => {
      const replacementDuration = config.deficitReplacementDuration;
      //Calculate the fluid replacement rate in mL/hour.
      const val = volumeToRate(volumeLessBolus.val, replacementDuration);

      // Generate string showing the formula used to calculate the fluid replacement rate.
      const formula =
        "[Deficit volume less bolus] ÷ [deficit replacement duration in hours]";

      // Generate string showing the working calculation for the fluid replacement rate.
      const working = `[${volumeLessBolus.val.toFixed(
        0
      )}mL] ÷ [${replacementDuration} hours] = ${val.toFixed(1)}mL/hour`;

      return {
        val,
        formula,
        working,
      };
    };

    return {
      percentage: percentage,
      volume: volume,
      volumeLessBolus: volumeLessBolus,
      rate: calculateRate(),
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
      volume: volume,
      rate: calculateRate(),
    };
  };
  const maintenance = calculateMaintenance();

  /**
   * Calculates the starting fluid rate by summing deficit and maintenance rates.
   * @returns {Object} - An object containing the calculated rate value, formula, and working calculation.
   */
  const calculateStartingFluidRate = () => {
    // Calculate the total starting fluid rate.
    const val = deficit.rate.val + maintenance.rate.val;

    // Generate string showing the formula used to calculate the starting fluid rate.
    const formula = "[Deficit replacement rate] + [Maintenance rate]";

    // Generate string showing the working calculation for the starting fluid rate.
    const working = `[${deficit.rate.val.toFixed(
      1
    )}mL/hour] + [${maintenance.rate.val.toFixed(1)}mL/hour] = ${val.toFixed(
      1
    )}mL/hour`;

    return {
      val,
      formula,
      working,
    };
  };

  /**
   * Calculates the insulin rate based on patient weight and selected insulin rate.
   * @returns {Object} - An object containing the calculated insulin rate, formula, limit, and working calculation.
   */
  const calculateInsulinRate = () => {
    const insulinCapsMap = {
      0.05: config.caps.insulin005,
      0.1: config.caps.insulin01,
    };

    // Calculate the uncapped insulin rate based on patient weight and insulin rate.
    const uncapped = data.insulinRate * weight;

    /**
     * Determines the capped insulin rate based on the selected insulin rate option.
     * @returns {number} - The capped insulin rate in Units/hour.
     */
    const calculateCapped = () => {
      if (insulinCapsMap.hasOwnProperty(data.insulinRate)) {
        return insulinCapsMap[data.insulinRate];
      } else {
        throw new Error(
          `Unable to select insulin rate capped using insulin rate [${data.insulinRate}].`
        );
      }
    };
    const capped = calculateCapped();

    // Check if the uncapped insulin rate exceeds the cap.
    const isCapped = uncapped > capped;

    // Calculate the insulin rate to use, selecting between capped or uncapped rates.
    const val = isCapped ? capped : uncapped;

    // Generate string showing the formula used to calculate the insulin rate.
    const formula = "[Insulin rate (Units/kg/hour)] x [Patient weight]";

    // Generate string showing the limit for the insulin rate based on the selected option.
    const limit = `${capped} Units/hour (for ${data.insulinRate} Units/kg/hour)`;

    // Generate string showing the working calculation for the insulin rate.
    const working = `[${data.insulinRate} Units/kg/hour] x [${weight.toFixed(
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
   * Calculates the glucose bolus volume based on patient weight and a given mL/kg.
   * @returns {Object} - An object containing the calculated volume, formula, limit, and working calculation.
   */
  const calculateGlucoseBolusVolume = () => {
    const mlsPerKg = config.mlsPerKg.glucose;
    const cap = config.caps.glucoseBolus;

    // Calculate the uncapped glucose bolus volume based on mL/kg.
    const uncapped = weight * mlsPerKg;

    // Check if the uncapped glucose bolus volume exceeds the cap.
    const isCapped = uncapped > cap;

    // Calculate the glucose bolus volume to use, selecting between capped or uncapped volumes.
    const val = isCapped ? cap : uncapped;

    // Generate string showing the formula used to calculate the glucose bolus volume.
    const formula = `[${mlsPerKg}mL/kg] x [Patient weight (kg)]`;

    // Generate string showing the glucose bolus volume limit.
    const limit = `${cap}mL`;

    // Generate string showing the working calculation for the glucose bolus volume.
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

  /**
   * Calculates the HHS bolus volume based on patient weight and a given mL/kg.
   * @returns {Object} - An object containing the calculated volume, formula, limit, and working calculation.
   */
  const calculateHhsBolusVolume = () => {
    const mlsPerKg = config.mlsPerKg.hhs;
    const cap = config.caps.hhsBolus;

    // Calculate the uncapped HHS bolus volume based on mL/kg.
    const uncapped = weight * mlsPerKg;

    // Check if the uncapped HHS bolus volume exceeds the cap.
    const isCapped = uncapped > cap;

    // Calculate the HHS bolus volume to use, selecting between capped or uncapped volumes.
    const val = isCapped ? cap : uncapped;

    // Generate string showing the formula used to calculate the HHS bolus volume.
    const formula = `[${mlsPerKg}mL/kg] x [Patient weight (kg)]`;

    // Generate string showing the HHS bolus volume limit.
    const limit = `${cap}mL`;

    // Shows the working calculation for the HHS bolus volume.
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

  return {
    severity,
    bolusVolume,
    deficit,
    maintenance,
    startingFluidRate: calculateStartingFluidRate(),
    insulinRate: calculateInsulinRate(),
    glucoseBolusVolume: calculateGlucoseBolusVolume(),
    hhsBolusVolume: calculateHhsBolusVolume(),
    errors: errors,
  };
};

module.exports = { calculateVariables };
