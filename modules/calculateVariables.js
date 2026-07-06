/**
 * @module calculateVariables
 * @memberof module:msf-diabetes-api
 * @summary Performs all clinical calculations required by the DKA management protocol.
 *
 * @description
 * Given validated patient data, this module calculates every variable needed to manage
 * a paediatric DKA episode according to the MSF 2024 guidelines:
 *
 *  - Severity classification (standard / severe) from pH, bicarbonate, or clinical indicators
 *  - Resuscitation bolus volume, duration, and rate (with no-bolus and cap logic)
 *  - Fluid deficit volume and replacement rate for standard and high-speed regimes
 *  - Daily maintenance volume and rate (Holliday-Segar method)
 *  - Combined bag speeds (standard, half-standard, high, half-high, hypo) with optional drops/min
 *  - IV insulin rate (Units/hour) and IM insulin dose (Units), both age-banded and capped
 *
 * Each calculated value is returned alongside a `working` string containing an
 * HTML narrative of the calculation steps, intended for display in the client.
 *
 * All clinical thresholds, caps, and decimal-place settings are read from `config.json`
 * so that the calculation logic remains decoupled from the specific numeric constants.
 *
 * @requires ../config.json
 */

const config = require("../config.json");

/**
 * Performs calculations based on patient data to determine protocol parameters.
 *
 * @param {Object}  data                      - Validated patient and episode data.
 * @param {number}  data.weight               - Patient weight in kg.
 * @param {number}  data.patientAge           - Patient age in decimal years.
 * @param {string}  data.patientSex           - "male" or "female".
 * @param {number}  [data.pH]                 - Arterial pH (optional).
 * @param {number}  [data.bicarbonate]        - Bicarbonate in mmol/L (optional).
 * @param {number}  [data.bloodKetones]       - Blood ketones in mmol/L (optional).
 * @param {number}  [data.urineKetones]       - Urine ketones (semi-quantitative, optional).
 * @param {boolean} data.shockPresent         - Whether clinical shock is present.
 * @param {number}  [data.gcs]                - Glasgow Coma Scale score (optional when shocked).
 * @param {boolean} [data.respiratorySupport] - Whether supplementary O₂ / respiratory support is in use.
 * @param {boolean} data.infusionPumpAvailable - Whether an infusion pump is available.
 * @param {number}  [data.dropFactor]         - Drops/mL of giving set (required when no infusion pump).
 *
 * @returns {Object} result
 * @returns {Object} result.severity    - `{ val: "standard"|"severe", working: string }`
 * @returns {Object} result.bolus       - Bolus volume, duration, rate and optional drops.
 * @returns {Object} result.deficit     - Deficit percentage, volumes and rates.
 * @returns {Object} result.maintenance - Maintenance volume and rate.
 * @returns {Object} result.bagSpeeds   - Combined infusion speeds relevant to the severity.
 * @returns {Object} result.insulinRate - IV insulin rate in Units/hour.
 * @returns {Object} result.insulinDose - IM insulin dose in Units.
 * @returns {Array}  result.errors      - Array of error messages encountered during calculation.
 */
const calculateVariables = (data) => {
  const errors = [];
  const weight = data.weight;

  /**
   * Converts a volume to a rate over a given time period.
   *
   * @param {number} volume   - Total volume in mL.
   * @param {number} unitTime - Time period in hours.
   * @returns {number} Rate in mL/hour.
   */
  const volumeToRate = (volume, unitTime) => volume / unitTime;

  /**
   * Converts an mL/hour infusion rate to drops per minute.
   *
   * @param {number} rate       - Infusion rate in mL/hour.
   * @param {number} dropFactor - Giving-set drop factor in drops/mL.
   * @returns {number} Drop rate in drops/minute.
   */
  const rateToDrops = (rate, dropFactor) => (rate / 60) * dropFactor;

  /**
   * Determines DKA severity (standard / severe) from blood-gas values or, when those are
   * unavailable, from clinical indicators (shock, GCS, respiratory support).
   *
   * Priority:
   *  1. If pH is provided (with ketones present), pH drives severity.
   *  2. If pH is absent but ketones are present, clinical indicators drive severity.
   *  3. If neither pH nor ketones are present an error is thrown.
   *
   * @returns {{ val: string, working: string }} Severity value and HTML working narrative.
   * @throws {Error} If the supplied values are insufficient or contradictory.
   */
  const calculateSeverity = () => {
    /**
     * Derives the severity value from available data.
     *
     * @returns {"standard"|"severe"} The severity classification.
     * @throws {Error} If pH/bicarbonate values do not meet any DKA diagnostic threshold,
     *                 or if insufficient data is available.
     */
    const calculateVal = () => {
      if (data.pH && (data.bloodKetones || data.urineKetones)) {
        // Blood gas available — use pH (and bicarbonate if present) to classify severity.
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
        // pH and bicarbonate are above all diagnostic thresholds — values do not confirm DKA.
        throw new Error(
          `pH of ${data.pH} and bicarbonate of ${data.bicarbonate}mmol/L does not meet the diagnostic threshold for DKA.`,
        );
      } else if (data.bloodKetones || data.urineKetones) {
        // No blood gas — fall back to clinical severity indicators.
        if (
          data.gcs <= config.validation.gcs.severeThreshold ||
          data.shockPresent ||
          data.respiratorySupport
        )
          return "severe";
        return "standard";
      } else {
        throw new Error(
          "Insufficient data to determine DKA severity: pH, blood ketones or urine ketones required.",
        );
      }
    };
    const val = calculateVal();

    /**
     * Generates an HTML string explaining how the severity was determined.
     *
     * @returns {string|false} HTML narrative, or false if severity could not be established.
     * @throws {Error} If pH values are in an unexpected range (should not occur after calculateVal).
     */
    const working = () => {
      if (!val) return false;
      let working;
      if (data.pH) {
        working = `Since pH ${
          data.bicarbonate ? "and bicarbonate have " : "has "
        }been provided use these (rather than clinical severity indicators) to select severity.<br>`;
        if (data.pH >= config.severity.standard.pHRange.upper) {
          //pH too high, therefore check bicarb
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
   * Calculates the resuscitation bolus volume, duration, and rate.
   *
   * Bolus volume is 10 mL/kg, capped at {@link config.caps.bolus} mL.
   * No bolus is given if GCS ≤ {@link config.validation.gcs.noBolusThreshold} and shock is absent.
   * Duration is 15 min if shocked, 60 min otherwise.
   *
   * @returns {{ volume: Object, duration: Object, rate: Object, drops: Object|null }}
   */
  const calculateBolus = () => {
    /**
     * Calculates the bolus volume, applying the no-bolus and cap rules.
     *
     * @returns {{ val: number, working: string }}
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
          config.decimals.bolusVolume,
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
        The calculated bolus is therefore <strong>${val.toFixed(
          config.decimals.bolusVolume,
        )}mL</strong>.
      `;

      return {
        val,
        working,
      };
    };
    const volume = calculateVolume();

    /**
     * Determines the bolus infusion duration in minutes based on shock status.
     *
     * @returns {{ val: number, working: string }}
     */
    const calculateDuration = () => {
      // Get the bolus duration in hours based on shock status.
      const val = data.shockPresent
        ? config.bolus.duration.shock
        : config.bolus.duration.noShock;

      const working = `Bolus duration is linked to the presence of shock:<ul><li>Shocked = ${
        config.bolus.duration.shock
      } minutes</li><li>Not shocked = ${
        config.bolus.duration.noShock
      } minutes</li></ul>Patient is <strong>${
        data.shockPresent ? "shocked" : "not shocked"
      }</strong>, therefore bolus duration is <strong>${val}</strong> minutes.`;

      return {
        val,
        working,
      };
    };
    const duration = calculateDuration();

    /**
     * Calculates the bolus infusion rate in mL/hour from volume and duration.
     *
     * @returns {{ val: number, working: string }}
     */
    const calculateRate = () => {
      // Convert duration from minutes to hours before computing rate.
      const val = volumeToRate(volume.val, duration.val / 60);

      // Generate string showing working calculation for the bolus rate.
      const working = `
        Bolus rate is calculated by dividing the bolus volume (calculated value: <strong>${volume.val.toFixed(
          config.decimals.bolusVolume,
        )}mL</strong>) by the bolus duration (in hours) (calculated value: <strong>${
          duration.val / 60
        }</strong> hours).<br><br>
        [${volume.val.toFixed(config.decimals.bolusVolume)}mL] ÷ [${
          duration.val / 60
        } hours] = <strong>${val.toFixed(
          config.decimals.bolusRate,
        )}mL/hour</strong>`;

      return {
        val,
        working,
      };
    };
    const rate = calculateRate();

    /**
     * Converts the bolus rate to drops/minute using the giving-set drop factor.
     * Only called when `data.dropFactor` is present (i.e. no infusion pump available).
     *
     * @returns {{ val: number, working: string }}
     */
    const calculateDrops = () => {
      const val = rateToDrops(rate.val, data.dropFactor);

      const working = `
        Drop rate is calculated by dividing the rate (in mL/hour) by 60 (to give a rate in mL/minute) and then multiplying by the drop factor (provided value: <strong>${
          data.dropFactor
        }</strong> drops/mL).<br><br>
        ([${rate.val.toFixed(
          config.decimals.bolusRate,
        )}mL/hour] ÷ [60 minutes]) x ${
          data.dropFactor
        } drops/mL = <strong>${val.toFixed(
          config.decimals.drops,
        )} drops/minute</strong>`;

      return {
        val,
        working,
      };
    };

    return {
      volume,
      duration,
      rate,
      drops: data.dropFactor ? calculateDrops() : null,
    };
  };

  /**
   * Calculates the fluid deficit volume and replacement rate.
   *
   * Two volumes are always computed:
   *  - Standard-speed: uses the standard DKA deficit percentage.
   *  - High-speed: uses the severe DKA deficit percentage (also used for the hypo regime).
   *
   * Both are capped at their respective limits from `config.caps`.
   *
   * @returns {{ percentage: Object, standardSpeedVolume: Object, standardSpeedRate: Object,
   *             highSpeedVolume: Object, highSpeedRate: Object }}
   */
  const calculateDeficit = () => {
    /**
     * Determines the deficit percentage from the calculated severity.
     *
     * @returns {{ val: number, working: string }}
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
     * Calculates the deficit replacement volume for the standard-speed regime
     * (using the standard DKA deficit percentage), capped at {@link config.caps.deficitStandard}.
     *
     * @returns {{ val: number, working: string }}
     */
    const calculateStandardSpeedVolume = () => {
      // Calculate the uncapped deficit volume.
      const raw = config.severity.standard.deficitPercentage * weight * 10;

      const cap = config.caps.deficitStandard;

      // Check if the uncapped deficit volume exceeds the cap.
      const isCapped = raw > cap;

      // Calculate the deficit volume to use, selecting between capped or uncapped volumes.
      const val = isCapped ? cap : raw;

      const working = `
        The deficit volume is calculated by multiplying the deficit percentage (calculated value: <strong>${
          config.severity.standard.deficitPercentage
        }%</strong>) by patient weight (provided value: <strong>${weight}kg</strong>) by a factor of 10.<br><br>
        [${config.severity.standard.deficitPercentage}%] x [${weight.toFixed(
          config.decimals.weight,
        )}kg] x 10 = ${raw.toFixed(config.decimals.deficitVolume)}mL<br><br>
        The volume is capped if it exceeds the limit of ${cap}mL (based on deficit volume for ${
          config.caps.weight
        }kg patient).<br><br>
        The calculated deficit volume is therefore <strong>${val.toFixed(
          config.decimals.deficitVolume,
        )}mL</strong>.`;

      return {
        val,
        working,
      };
    };
    const standardSpeedVolume = calculateStandardSpeedVolume();

    /**
     * Calculates the deficit replacement volume for the high-speed (hypoglycaemia) regime,
     * using the severe DKA deficit percentage regardless of actual severity.
     * Capped at {@link config.caps.deficitSevere}.
     *
     * @returns {{ val: number, working: string }}
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
        The deficit volume is calculated by multiplying the deficit percentage (calculated value: <strong>${
          config.severity.severe.deficitPercentage
        }%</strong>) by patient weight (provided value: <strong>${weight}kg</strong>) by a factor of 10.<br><br>
        [${config.severity.severe.deficitPercentage}%] x [${weight.toFixed(
          config.decimals.weight,
        )}kg] x 10 = ${raw.toFixed(config.decimals.deficitVolume)}mL<br><br>
        The volume is capped if it exceeds the limit of ${cap}mL (based on deficit volume for ${
          config.caps.weight
        }kg patient).<br><br>
        The calculated deficit volume is therefore <strong>${val.toFixed(
          config.decimals.deficitVolume,
        )}mL</strong>.`;

      return {
        val,
        working,
      };
    };
    const highSpeedVolume = calculateHighSpeedVolume();

    /**
     * Calculates the hourly rate at which a given deficit volume should be replaced
     * over the standard {@link config.deficitReplacementDuration}-hour period.
     *
     * @param {number} vol - Deficit volume in mL.
     * @returns {{ val: number, working: string }}
     */
    const calculateRate = (vol) => {
      const replacementDuration = config.deficitReplacementDuration;
      //Calculate the fluid replacement rate in mL/hour.
      const val = volumeToRate(vol, replacementDuration);

      // Generate string showing the working calculation for the fluid replacement rate.
      const working = `
        The deficit replacement rate is calculated by dividing the deficit volume by the deficit replacement duration of ${replacementDuration} hours.<br><br>
        [${vol.toFixed(
          config.decimals.deficitVolume,
        )}mL] ÷ [${replacementDuration} hours] = <strong>${val.toFixed(
          config.decimals.deficitRate,
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
   * Calculates daily maintenance fluid volume and hourly rate using the
   * Holliday-Segar method:
   *  - 100 mL/kg for the first 10 kg
   *  - 50 mL/kg for the next 10 kg
   *  - 20 mL/kg for every kg above 20 kg
   *
   * Capped at {@link config.caps.maintenance} mL/day.
   *
   * @returns {{ volume: Object, rate: Object }}
   */
  const calculateMaintenance = () => {
    /**
     * Calculates the daily maintenance volume by the Holliday-Segar stepped formula.
     *
     * @returns {{ val: number, working: string }}
     * @throws {Error} If weight is below the minimum validation threshold.
     */
    const calculateVolume = () => {
      const cap = config.caps.maintenance;
      /**
       * Applies the Holliday-Segar formula to compute the uncapped daily maintenance volume.
       *
       * @returns {number} Uncapped maintenance volume in mL/day.
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

      let working = `
        The daily maintenance volume is based on the patient weight (provided value: <strong>${weight}kg</strong>):
        <ul><li>100mL/kg for the first 10kg</li>
        <li>then 50mL/kg for the second 10kg</li>
        <li>then 20mL/kg for the remainder</li></ul>
      `;
      if (weight > 20) {
        working += `
          100mL/kg x 10kg = 1000mL<br>
          50mL/kg x 10kg = 500mL<br>
          20mL/kg x ${weight - 20}kg = ${((weight - 20) * 20).toFixed(
            config.decimals.maintenanceVolume,
          )}mL<br><br>
        1000mL + 500mL + ${((weight - 20) * 20).toFixed(
          config.decimals.maintenanceVolume,
        )}mL = <strong>${val.toFixed(
          config.decimals.maintenanceVolume,
        )}mL</strong>
        `;
      } else if (weight > 10) {
        working += `
          100mL/kg x 10kg = 1000mL<br>
          50mL/kg x ${weight - 10}kg = ${((weight - 10) * 50).toFixed(
            config.decimals.maintenanceVolume,
          )}mL<br><br>
          1000mL + ${((weight - 10) * 50).toFixed(
            config.decimals.maintenanceVolume,
          )}mL = <strong>${val.toFixed(
            config.decimals.maintenanceVolume,
          )}mL</strong>
        `;
      } else if (weight > config.validation.weight.min) {
        working += `100mL/kg x ${weight}kg = <strong>${val.toFixed(
          config.decimals.maintenanceVolume,
        )}mL</strong>`;
      } else {
        throw new Error("Unable to generate maintenance volume working.");
      }

      working += `<br><br>
        The volume is capped if it exceeds the limit of ${cap}mL (based on maintenance volume for ${
          config.caps.weight
        }kg patient).<br><br>
        The calculated daily maintenance volume is therefore <strong>${val.toFixed(
          config.decimals.maintenanceVolume,
        )}mL</strong>.`;

      return {
        val,
        working,
      };
    };
    const volume = calculateVolume();

    /**
     * Derives the hourly maintenance rate by dividing the daily volume by 24.
     *
     * @returns {{ val: number, working: string }}
     */
    const calculateRate = () => {
      // Calculate the daily maintenance fluid rate in mL/hour.
      const val = volume.val / 24;

      // Generate string showing the working calculation for the daily maintenance fluid rate.
      const working = `
        The daily maintenance rate is calculated by dividing the daily maintenance volume by 24 hours.<br><br>
        [${volume.val.toFixed(
          config.decimals.maintenanceVolume,
        )}mL] ÷ 24 hours = <strong>${val.toFixed(
          config.decimals.maintenanceRate,
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
   * Calculates the set of combined bag speeds (deficit + maintenance) appropriate for
   * the patient's severity, plus the hypoglycaemia high-speed option.
   *
   * Standard severity returns: standardSpeed, halfStandardSpeed, hypoSpeed (and drops variants).
   * Severe severity returns: highSpeed, halfHighSpeed (and drops variants).
   *
   * @returns {Object} An object whose keys depend on severity (see above).
   * @throws {Error} If severity is neither "standard" nor "severe".
   */
  const calculateBagSpeeds = () => {
    /**
     * Sums the deficit and maintenance rates to produce a combined bag speed.
     *
     * @param {Object} deficitVolume    - Deficit volume object with `val` and `working`.
     * @param {Object} deficitRate      - Deficit rate object with `val` and `working`.
     * @param {Object} maintenanceVolume - Maintenance volume object with `val` and `working`.
     * @param {Object} maintenanceRate  - Maintenance rate object with `val` and `working`.
     * @returns {{ val: number, working: string }}
     */
    const calculateSpeed = (
      deficitVolume,
      deficitRate,
      maintenanceVolume,
      maintenanceRate,
    ) => {
      // Calculate the speed fluid rate in mL/hour.
      const val = deficitRate.val + maintenanceRate.val;

      // Generate string showing the working calculation for the fluid rate.
      const working = `
        <div class="card mb-2">
          <div class="card-header">
            1. Calculate deficit replacement rate
          </div>
          <div class="card-body">
            ${deficitVolume.working}<br><br>
            ${deficitRate.working}
          </div>
        </div>
        <div class="card mb-2">
          <div class="card-header">
            2. Calculate maintenance rate
          </div>
          <div class="card-body">
            ${maintenanceVolume.working}<br><br>
            ${maintenanceRate.working}
          </div>
        </div>
        <div class="card mb-2">
          <div class="card-header">
            3. Calculate bag speed
          </div>
          <div class="card-body">
            The bag speed is calculated by summing the deficit rate with the daily maintenance rate.<br><br>
            [${deficitRate.val.toFixed(
              config.decimals.deficitRate,
            )}mL/hour] + [${maintenanceRate.val.toFixed(
              config.decimals.maintenanceRate,
            )}mL/hour] = <strong>${val.toFixed(
              config.decimals.bagSpeed,
            )}mL/hour</strong>
          </div>
        </div>
      `;

      return {
        val,
        working,
      };
    };

    /**
     * Divides a bag speed by 2 to produce the half-speed value used when stepping
     * down the infusion rate.
     *
     * @param {number} rate - Full bag speed in mL/hour.
     * @returns {{ val: number, working: string }}
     */
    const calculateHalfSpeed = (rate) => {
      const val = rate / 2;

      const working = `
        The half bag speed is calculated by dividing the relevant rate (calculated value: <strong>${rate.toFixed(
          config.decimals.bagSpeed,
        )}mL/hour</strong>) by 2.<br><br>
        [${rate.toFixed(
          config.decimals.bagSpeed,
        )}mL/hour] ÷ 2 = <strong>${val.toFixed(
          config.decimals.bagSpeed,
        )}mL/hour</strong>`;

      return {
        val,
        working,
      };
    };

    /**
     * Converts a bag speed object's mL/hour rate to drops/minute.
     * Only used when `data.dropFactor` is set.
     *
     * @param {{ val: number, working: string }} rateObj - Bag speed object.
     * @returns {{ val: number, working: string }}
     */
    const calculateDrops = (rate) => {
      // Calculate the drop rate in drops/minute.
      const val = rateToDrops(rate.val, data.dropFactor);

      // Generate string showing working calculation for the bolus rate.
      const working = `
        Drop rate is calculated by dividing the rate (in mL/hour) by 60 (to give a rate in mL/minute) and then multiplying by the drop factor (provided value: <strong>${
          data.dropFactor
        }</strong> drops/mL).<br><br>
        ([${rate.val.toFixed(
          config.decimals.bagSpeed,
        )}mL/hour] ÷ [60 minutes]) x ${
          data.dropFactor
        } drops/mL = <strong>${val.toFixed(
          config.decimals.drops,
        )} drops/minute</strong>`;

      return {
        val,
        working,
      };
    };

    const standardSpeed = calculateSpeed(
      deficit.standardSpeedVolume,
      deficit.standardSpeedRate,
      maintenance.volume,
      maintenance.rate,
      config.severity.standard.deficitPercentage,
    );

    const halfStandardSpeed =
      severity.val === "standard"
        ? calculateHalfSpeed(standardSpeed.val)
        : null;

    const highSpeed = calculateSpeed(
      deficit.highSpeedVolume,
      deficit.highSpeedRate,
      maintenance.volume,
      maintenance.rate,
      config.severity.severe.deficitPercentage,
    );

    const halfHighSpeed =
      severity.val === "severe" ? calculateHalfSpeed(highSpeed.val) : null;

    // The hypo speed uses the high-speed calculation but with an additional explanatory prefix.
    // Note: a new object is constructed to avoid mutating highSpeed.working in place.
    const hypoSpeed = {
      val: highSpeed.val,
      working:
        `For managing hypoglycaemia the relevant deficit rate is as for severe DKA (i.e. using a deficit percentage of ${config.severity.severe.deficitPercentage}%). Therefore, if the actual DKA severity is standard the hypoglycaemia high-speed bag rate is faster than the standard-speed bag rate.<br><br>` +
        highSpeed.working,
    };

    if (severity.val === "standard") {
      const standardSpeedDrops = data.dropFactor
        ? calculateDrops(standardSpeed)
        : null;
      const halfStandardSpeedDrops = data.dropFactor
        ? calculateDrops(halfStandardSpeed)
        : null;
      const hypoSpeedDrops = data.dropFactor ? calculateDrops(hypoSpeed) : null;
      return {
        standardSpeed,
        standardSpeedDrops,
        halfStandardSpeed,
        halfStandardSpeedDrops,
        hypoSpeed,
        hypoSpeedDrops,
      };
    } else if (severity.val === "severe") {
      const highSpeedDrops = data.dropFactor ? calculateDrops(highSpeed) : null;
      const halfHighSpeedDrops = data.dropFactor
        ? calculateDrops(halfHighSpeed)
        : null;
      return {
        highSpeed,
        highSpeedDrops,
        halfHighSpeed,
        halfHighSpeedDrops,
      };
    } else {
      throw new Error("Unable to select bag speed options as severity");
    }
  };

  /**
   * Calculates the continuous IV insulin infusion rate in Units/hour.
   *
   * Rate is age-banded (< {@link config.insulin.ageThreshold} years uses the lower option)
   * and capped at the age-appropriate limit from `config.caps`.
   *
   * @returns {{ val: number, working: string }}
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
        config.decimals.weight,
      )}kg</strong>).<br><br> The relevant weight-based rate is based on the patient age (provided value: ${
        data.patientAge
      } years):
      <ul><li>Age <${config.insulin.ageThreshold} years = ${
        config.insulin.rateOptions[0]
      } Units/kg/hour</li>
      <li>Age >=${config.insulin.ageThreshold} years = ${
        config.insulin.rateOptions[1]
      } Units/kg/hour</li></ul>
      
      [${rateUnitsPerKgPerHour} Units/kg/hour] x [${weight.toFixed(
        config.decimals.weight,
      )}kg] = <strong>${raw.toFixed(
        config.decimals.ivInsulinRate,
      )} Units/hour</strong><br><br>
      
      The rate is capped if it exceeds the limit of ${cap} Units/hour (based on ${rateUnitsPerKgPerHour} Units/kg/hour for ${
        config.caps.weight
      }kg patient).<br><br>
        The calculated rate is therefore <strong>${val.toFixed(
          config.decimals.ivInsulinRate,
        )}mL</strong>.
      `;

    return {
      val,
      working,
    };
  };

  /**
   * Calculates the IM (intramuscular) insulin dose in Units.
   *
   * Dose is age-banded (< {@link config.insulin.ageThreshold} years uses the lower option),
   * rounded to the nearest 0.5 Unit, and capped at the age-appropriate limit from `config.caps`.
   *
   * @returns {{ val: number, working: string }}
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

    // Round to the nearest 0.5 Unit: double, round to nearest integer, then halve.
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
        config.decimals.weight,
      )}kg</strong>).<br><br>
      The relevant weight-based dose is based on the patient age (provided value: <strong>${parseFloat(
        data.patientAge,
      ).toFixed(config.decimals.age)} years</strong>):
      <ul><li>Age <${config.insulin.ageThreshold} years = ${
        config.insulin.doseOptions[0]
      } Units/kg</li>
      <li>Age >=${config.insulin.ageThreshold} years = ${
        config.insulin.doseOptions[1]
      } Units/kg</li></ul>
      
      [${doseUnitsPerKg} Units/kg] x [${weight.toFixed(
        config.decimals.weight,
      )}kg] = <strong>${raw.toFixed(
        config.decimals.imInsulinDose,
      )} Units</strong><br><br>
      The dose is rounded to the nearest half-unit.<br><br>
      The dose is capped if it exceeds the limit of ${cap} Units (based on ${doseUnitsPerKg} Units/kg for ${
        config.caps.weight
      }kg patient).<br><br>
        The calculated dose is therefore <strong>${val.toFixed(
          config.decimals.imInsulinDose,
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
