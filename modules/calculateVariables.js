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
          `pH of ${data.pH} and bicarbonate of ${data.bicarbonate}mmol/L does not meet the diagnostic threshold for DKA.`
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

    /**
     * Generates a string showing the working used to find the severity level.
     * @returns {string} - The generated string.
     */
    const working = () => {
      if (!val) return false;
      let working;
      if (data.pH) {
        working = `Since pH ${
          data.bicarbonate ? "and bicarbonate have " : "has "
        }been provided use these (rather than clinical severity indicators) to select severity.<br>`;
        if (data.pH >= config.severity.standard.pHRange.upper) {
          //pH too high,therefore check bicarb
          if (data.bicarbonate < config.severity.standard.bicarbonateBelow) {
            //Bicarb diagnostic
            working += `pH of ${data.pH} is above upper limit of ${config.severity.standard.pHRange.upper}, but bicarbonate of ${data.bicarbonate}mmol/L is below upper limit of ${config.severity.standard.bicarbonateBelow} mmol/L.<br>Therefore, severity is ${val}.`;
          } else {
            //pH and bicarb too high
            throw new Error("Unable to generate working for severity.");
          }
        } else if (
          data.pH < config.severity.standard.pHRange.upper &&
          data.pH >= config.severity.standard.pHRange.lower
        ) {
          //pH in standard range
          working += `pH of <strong>${data.pH}</strong> is within the range ${config.severity.standard.pHRange.lower} to <${config.severity.standard.pHRange.upper}.<br>Therefore, severity is <strong>${val}</strong>.`;
        } else if (
          data.pH < config.severity.severe.pHRange.upper &&
          data.pH >= config.severity.severe.pHRange.lower
        ) {
          //pH in severe range
          working += `pH of <strong>${data.pH}</strong> is within the range ${config.severity.severe.pHRange.lower} to <${config.severity.severe.pHRange.upper}.<br>Therefore, severity is <strong>${val}</strong>.`;
        } else {
          //pH not in expected range
          throw new Error("Unable to generate working for severity.");
        }
      } else {
        working = `In the absence of blood gas data, severity is decided using clinical indicators.<br><br>DKA is severe if any of these features are present, or standard if all are absent:<ul><li>Shock (provided value: <strong>${
          data.shockPresent
        }</strong>)</li><li>GCS <${
          config.validation.gcs.severeThreshold + 1
        } (provided value: <strong>${
          data.gcs
        }</strong>)</li><li>On supplementary O<sub>2</sub> or respiratory support (provided value: <strong>${
          data.respiratorySupport
        }</strong>)</li></ul>Therefore, severity is <strong>${val}</strong>.`;
      }
      return working;
    };

    return {
      val,
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
      const mlsPerKg = config.bolus.mlsPerKg;
      const cap = config.caps.bolus;

      // Calculate the uncapped bolus volume based on mL/kg.
      const raw = weight * mlsPerKg;

      // Determines if no bolus should be given based on GCS and shock presence.
      const noBolus =
        data.gcs <= config.validation.gcs.noBolusThreshold &&
        !data.shockPresent;

      // Checks if the uncapped bolus volume exceeds the cap.
      const isCapped = raw > cap;

      // Select the bolus volume to use between capped or uncapped volumes.
      let val = isCapped ? cap : raw;

      // Override bolus volume to 0 if no bolus criteria are met.
      if (noBolus) val = 0;

      // Generate string showing working calculation for the bolus volume.
      let working = `
        The default bolus is ${mlsPerKg}mL/kg x weight in kilograms (provided value: <strong>${weight}kg</strong>) = ${raw.toFixed(
        1
      )}mL<br><br>
        The default bolus is overriden in the following circumstances:
        <ul><li>No bolus is given if GCS <=${
          config.validation.gcs.noBolusThreshold
        } (provided value: <strong>${
        data.gcs
      }</strong>) and the patient is not shocked (provided value: <strong>${
        data.shockPresent ? "shocked" : "not shocked"
      }</strong>)</li>
        <li>The bolus is capped if it exceeds the limit of ${cap}mL (based on ${mlsPerKg}mL/kg for ${
        config.caps.weight
      }kg patient)</li></ul>
        The calculated bolus is therefore <strong>${val.toFixed(1)}mL</strong>.
      `;

      return {
        val,
        working,
      };
    };
    const volume = calculateVolume();

    const calculateDuration = () => {
      // Get the bolus duration in hours based on shock status.
      const val = data.shockPresent
        ? config.bolus.duration.shock
        : config.bolus.duration.noShock;

      const working = `Bolus duration is linked to the presence of shock:<ul><li>Shocked = ${
        config.bolus.duration.shock * 60
      } minutes</li><li>Not shocked = ${
        config.bolus.duration.noShock * 60
      } minutes</li></ul>Patient is <strong>${
        data.shockPresent ? "shocked" : "not shocked"
      }</strong>, therefore bolus duration is <strong>${
        val * 60
      }</strong> minutes.`;

      return {
        val,
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

      // Generate string showing working calculation for the bolus rate.
      const working = `
        Bolus rate is calculated by dividing the bolus volume (calculated value: <strong>${volume.val.toFixed(
          1
        )}mL</strong>) by the bolus duration (in hours) (calculated value: <strong>${
        duration.val
      }</strong> hours).<br><br>
        [${volume.val.toFixed(1)}mL] ÷ [${
        duration.val
      } hours] = <strong>${val.toFixed(1)}mL/hour</strong>`;

      return {
        val,
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
      const val = config.severity[severity.val].deficitPercentage;

      const working = `Deficit percentage is linked to severity:<ul><li>Standard DKA = ${config.severity.standard.deficitPercentage}% deficit</li><li>Severe DKA = ${config.severity.severe.deficitPercentage}% deficit</li></ul>Calculated severity is <strong>${severity.val}</strong>, therefore deficit is <strong>${val}%</strong>.`;

      return {
        val,
        working,
      };
    };
    const percentage = calculatePercentage();

    /**
     * Calculates the deficit volume based on the deficit percentage and patient weight.
     * @returns {Object} - An object containing deficit volume, formula, limit, working calculation, and capped status.
     */
    const calculateStandardSpeedVolume = () => {
      // Calculate the uncapped deficit volume.
      const raw = config.severity.standard.deficitPercentage * weight * 10;

      const cap = config.caps.deficitStandard;

      // Check if the uncapped deficit volume exceeds the cap.
      const isCapped = raw > cap;

      // Calculate the deficit volume to use, selecting between capped or uncapped volumes.
      const val = isCapped ? cap : raw;

      /**
       * Shows the working calculation for the deficit volume.
       * @returns {string} - A string showing the detailed calculation.
       */
      const working = `
        The deficit volume is calculated by multiplying the deficit percentage (calculated value: <strong>${
          config.severity.standard.deficitPercentage
        }%</strong>) by patient weight (provided value: <strong>${weight}kg</strong>) by a factor of 10.<br><br>
        [${config.severity.standard.deficitPercentage}%] x [${weight.toFixed(
        1
      )}kg] x 10 = ${raw.toFixed(1)}mL<br><br>
        The volume is capped if it exceeds the limit of ${cap}mL (based on deficit volume for ${
        config.caps.weight
      }kg patient).<br><br>
        The calculated deficit volume is therefore <strong>${val.toFixed(
          1
        )}mL</strong>.`;

      return {
        val,
        working,
      };
    };
    const standardSpeedVolume = calculateStandardSpeedVolume();

    /**
     * FOR HIGH-SPEED HYPOGLYCAMIA REGIME: Calculates the deficit volume based on the deficit percentage and patient weight.
     * @returns {Object} - An object containing deficit volume, formula, limit, working calculation, and capped status.
     */
    const calculateHighSpeedVolume = () => {
      // Calculate the uncapped deficit volume.
      const raw = config.severity.severe.deficitPercentage * weight * 10;

      const cap = config.caps.deficitSevere;

      // Check if the uncapped deficit volume exceeds the cap.
      const isCapped = raw > cap;

      // Calculate the deficit volume to use, selecting between capped or uncapped volumes.
      const val = isCapped ? cap : raw;

      const working = `
        The deficit volume is volume is calculated by multiplying the deficit percentage (calculated value: <strong>${
          config.severity.severe.deficitPercentage
        }%</strong>) by patient weight (provided value: <strong>${weight}kg</strong>) by a factor of 10.<br><br>
        [${config.severity.severe.deficitPercentage}%] x [${weight.toFixed(
        1
      )}kg] x 10 = ${raw.toFixed(1)}mL<br><br>
        The volume is capped if it exceeds the limit of ${cap}mL (based on deficit volume for ${
        config.caps.weight
      }kg patient).<br><br>
        The calculated deficit volume is therefore <strong>${val.toFixed(
          1
        )}mL</strong>.`;

      return {
        val,
        working,
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

      // Generate string showing the working calculation for the fluid replacement rate.
      const working = `
        The deficit replacement rate is calculated by dividing the deficit volume (calculated value: <strong>${vol.toFixed(
          1
        )}mL</strong>) by the deficit replacement duration of ${replacementDuration} hours.<br><br>
        [${vol.toFixed(
          0
        )}mL] ÷ [${replacementDuration} hours] = <strong>${val.toFixed(
        1
      )}mL/hour</strong>`;

      return {
        val,
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
      const calculateRaw = () => {
        if (weight < 10) return weight * 100;
        if (weight < 20) return (weight - 10) * 50 + 1000;
        return (weight - 20) * 20 + 1500;
      };
      const raw = calculateRaw();

      // Check if the uncapped maintenance volume exceeds the cap.
      const isCapped = raw > cap;

      // Calculate the maintenance volume to use, selecting between capped or uncapped volumes.
      const val = isCapped ? cap : raw;

      /**
       * Shows the working calculation for the maintenance volume.
       * @returns {string} - A string showing the detailed calculation.
       */
      let working = `
        The daily maintenance volume is based on the patient weight (provided value: <strong>${weight}kg</strong>):
        <ul><li>100mL/kg for the first 10kg,</li>
        <li>then 50mL/kg for the second 10kg,</li>
        <li>then 20mL/kg for the remainder</li></ul>
      `;
      if (weight > 20) {
        working += `
          100mL/kg x 10kg = 1000.0mL<br>
          50mL/kg x 10kg = 500.0mL<br>
          20mL/kg x ${weight - 20}kg = ${((weight - 20) * 20).toFixed(
          1
        )}mL<br><br>
        1000 + 500 + ${((weight - 20) * 20).toFixed(
          1
        )}kg = <strong>${val.toFixed(1)}mL</strong>
        `;
      } else if (weight > 10) {
        working += `
          100mL/kg x 10kg = 1000.0mL<br>
          50mL/kg x ${weight - 10}kg = ${((weight - 10) * 50).toFixed(
          1
        )}mL<br><br>
          1000 + ${((weight - 10) * 50).toFixed(1)}kg = <strong>${val.toFixed(
          1
        )}mL</strong>
        `;
      } else if (weight > config.validation.weight.min) {
        working += `100mL/kg x ${weight}kg = <strong>${val.toFixed(
          1
        )}mL</strong>`;
      } else {
        throw new Error("Unable to generate maintenance volume working.");
      }

      working += `<br><br>
        The volume is capped if it exceeds the limit of ${cap}mL (based on maintenance volume for ${
        config.caps.weight
      }kg patient).<br><br>
        The calculated daily maintenance volume is therefore <strong>${val.toFixed(
          1
        )}mL</strong>.`;

      return {
        val,
        working,
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

      // Generate string showing the working calculation for the daily maintenance fluid rate.
      const working = `
        The daily maintenance rate is calculated by dividing the daily maintenance volume (calculated value: <strong>${volume.val.toFixed(
          1
        )}mL</strong>) by 24 hours.<br><br>
        [${volume.val.toFixed(0)}mL] ÷ 24 hours = <strong>${val.toFixed(
        1
      )}mL/hour</strong>`;

      return {
        val,
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
    const calculateSpeed = (deficitRate, maintenanceRate) => {
      // Calculate the speed fluid rate in mL/hour.
      const val = deficitRate + maintenanceRate;

      // Generate string showing the working calculation for the fluid rate.
      const working = `
        The bag speed is calculated by summing the relevant deficit rate (calculated value: <strong>${deficitRate.toFixed(
          1
        )}mL/hour</strong>) with the daily maintenance rate (calculated value: <strong>${maintenanceRate.toFixed(
        1
      )}mL/hour</strong>).<br><br>
        [${deficitRate.toFixed(1)}mL/hour] + [${maintenanceRate.toFixed(
        1
      )}mL/hour] = <strong>${val.toFixed(1)}mL/hour</strong>`;

      return {
        val,
        working,
      };
    };

    // Calculate the half-speed fluid rate by dividing by 2.
    const calculateHalfSpeed = (rate) => {
      // Calculate the speed fluid rate in mL/hour.
      const val = rate / 2;

      // Generate string showing the working calculation for the halffluid rate.
      const working = `
        The half bag speed is calculated by dividing the relevant rate (calculated value: <strong>${rate.toFixed(
          1
        )}mL/hour</strong>) by 2.<br><br>
        [${rate.toFixed(1)}mL/hour] ÷ 2 = <strong>${val.toFixed(
        1
      )}mL/hour</strong>`;

      return {
        val,
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

    const hypoSpeed = highSpeed;
    hypoSpeed.working =
      `For managing hypoglycaemia the relevant deficit rate is as for severe DKA (i.e. using a deficit percentage of ${config.severity.severe.deficitPercentage}%). Therefore, if the actual DKA severity is standard the hypoglycaemia high-speed bag rate is faster than the standard-speed bag rate.<br><br>` +
      hypoSpeed.working;

    return {
      standardSpeed: severity.val === "severe" ? null : standardSpeed,
      halfStandardSpeed:
        severity.val === "severe"
          ? null
          : calculateHalfSpeed(standardSpeed.val),
      highSpeed: severity.val === "severe" ? highSpeed : null,
      halfHighSpeed:
        severity.val === "severe" ? calculateHalfSpeed(highSpeed.val) : null,
      hypoSpeed,
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
    const cap =
      data.patientAge < config.insulin.ageThreshold
        ? config.caps.insulinRate005
        : config.caps.insulinRate01;

    // Calculate the uncapped insulin rate (in units/hr) based on patient weight and insulin rate in units/kg/hr.
    const raw = rateUnitsPerKgPerHour * weight;

    // Check if the uncapped insulin rate exceeds the cap.
    const isCapped = raw > cap;

    // Calculate the insulin rate to use, selecting between capped or uncapped rates.
    const val = isCapped ? cap : raw;

    // Generate string showing the working calculation for the insulin rate.
    const working = `
      The insulin rate (in Units/hour) is calculated by multiplying the weight-based rate (in Units/kg/hour) by the patient weight (provided value: <strong>${weight.toFixed(
        1
      )}kg</strong>).<br><br> The relevant weight-based rate is based on the patient age (provided value: ${
      data.patientAge
    } years):
      <ul><li>Age <${config.insulin.ageThreshold} years = ${
      config.insulin.rateOptions[0]
    } Units/kg/hour</li>
      <li>Age >=${config.insulin.ageThreshold} years = ${
      config.insulin.rateOptions[0]
    } Units/kg/hour</li></ul>
      
      [${rateUnitsPerKgPerHour} Units/kg/hour] x [${weight.toFixed(
      1
    )}kg] = <strong>${raw.toFixed(2)} Units/hour</strong><br><br>
      
      The rate is capped if it exceeds the limit of ${cap} Units/hour (based on ${rateUnitsPerKgPerHour} Units/kg/hour for ${
      config.caps.weight
    }kg patient).<br><br>
        The calculated rate is therefore <strong>${val.toFixed(2)}mL</strong>.
      `;

    return {
      val,
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
    const cap =
      data.patientAge < config.insulin.ageThreshold
        ? config.caps.insulinDose01
        : config.caps.insulinDose02;

    // Calculate the uncapped insulin dose (in units) based on patient weight and insulin dose in units/kg.
    const raw = doseUnitsPerKg * weight;

    const double = raw * 2;

    const roundedDouble = Math.round(double);

    const rounded = roundedDouble / 2;

    // Check if the uncapped insulin dose exceeds the cap.
    const isCapped = rounded > cap;

    // Calculate the insulin dose to use, selecting between capped or uncapped doses.
    const val = isCapped ? cap : rounded;

    // Generate string showing the working calculation for the insulin dose.
    const working = `
      The insulin dose is calculated by multiplying the weight-based dose (in Units/kg) by the patient weight (provided value: <strong>${weight.toFixed(
        1
      )}kg</strong>).<br><br>
      The relevant weight-based dose is based on the patient age (provided value: <strong>${
        data.patientAge
      } years</strong>):
      <ul><li>Age <${config.insulin.ageThreshold} years = ${
      config.insulin.doseOptions[0]
    } Units/kg</li>
      <li>Age >=${config.insulin.ageThreshold} years = ${
      config.insulin.doseOptions[1]
    } Units/kg</li></ul>
      
      [${doseUnitsPerKg} Units/kg] x [${weight.toFixed(
      1
    )}kg] = <strong>${raw.toFixed(2)} Units/hour</strong><br><br>
      The dose is rounded to the nearest half-unit.<br><br>
      The dose is capped if it exceeds the limit of ${cap} Units (based on ${doseUnitsPerKg} Units/kg for ${
      config.caps.weight
    }kg patient).<br><br>
        The calculated dose is therefore <strong>${val.toFixed(
          1
        )} Units</strong>.
      `;

    return {
      val,
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
