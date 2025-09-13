/**
 * Calculates the corrected sodium level based on sodium and glucose levels.
 * This is used to adjust sodium concentration when glucose is elevated.
 *
 * @param {number} sodium - The current sodium level (mmol/L).
 * @param {number} glucose - The current glucose level (mmol/L).
 * @returns {{ val: string, formula: string, working: string }} An object containing the corrected sodium value (mmol/L), formula, and working.
 */
function calculateCorrectedSodium(sodium, glucose) {
  let val = (sodium + (glucose - 5.6) / 3.5).toFixed(1);
  const formula = "[sodium (mmol/L)] + ( ( [glucose (mmol/L)] - 5.6 ) / 3.5 )";
  const working = `[${sodium}mmol/L] + ( ( [${glucose} mmol/L] - 5.6 ) / 3.5 )`;
  return { val, formula, working };
}

/**
 * Calculates the effective osmolality based on sodium and glucose levels.
 * Effective osmolality is an important measurement for assessing hydration status.
 *
 * @param {number} sodium - The sodium level (mmol/L).
 * @param {number} glucose - The glucose level (mmol/L).
 * @returns {{ val: string, formula: string, working: string }} An object containing the effective osmolality value (mOsm/kg), formula, and calculation steps.
 */
function calculateEffectiveOsmolality(sodium, glucose) {
  const val = (2 * sodium + glucose).toFixed(0);
  const formula = "( 2 x [sodium (mmol/L)] ) + [glucose (mmol/L)]";
  const working = `( 2 x [${sodium}mmol/L] ) + [${glucose}mmol/L]`;
  return { val, formula, working };
}

// Exporting the functions
module.exports = { calculateCorrectedSodium, calculateEffectiveOsmolality };
