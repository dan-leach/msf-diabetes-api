# MSF Diabetes API

A Node.js / Express REST API that performs clinical calculations for the management of paediatric diabetic ketoacidosis (DKA), based on the 2024 MSF paediatric guidelines. It is the backend counterpart to the [MSF Diabetes Calculator](https://github.com/dan-leach/msf-diabetes) Vue client.

📖 [Documentation wiki](wiki.md)

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Framework | Express 4 |
| Validation | express-validator 7 |
| Encryption | Node.js `crypto` (AES-256-GCM + RSA-OAEP) |
| Database | MySQL 2 (`mysql2/promise`) |
| Email | Nodemailer 6 |

---

## Getting started

```bash
npm install
```

The following environment variables must be set before the server starts:

| Variable | Description |
|---|---|
| `rsaPublicKey` | Base64-encoded RSA public key (PEM) — used to encrypt patient data before storage |
| `rsaPrivateKey` | Base64-encoded RSA private key (PEM) — used by the `/decrypt` route |
| `app_insert_key` | MySQL password for the insert-only database user |
| `app_select_key` | MySQL password for the select-only database user |

Optional variables:

| Variable | Description |
|---|---|
| `apiVersion` | Reported in `/config` response and stamped on each episode record |
| `clientVersion` | Reported in `/config` response |
| `lastUpdated` | Reported in `/config` response |
| `emailKey` | SMTP password — required for error notification emails (production only) |
| `emailDkimPrivateKey` | DKIM private key for outbound email signing (production only) |
| `PORT` | Listening port (default: `3000`) |

Start the server:

```bash
node index.js
```

---

## Project structure

```
/
├── index.js                    # Express app — routes, middleware, server startup
├── config.json                 # Clinical constants, validation thresholds, DB config, centile tables
├── tests.json                  # Postman collection for integration testing
├── modules/
│   ├── calculateVariables.js   # All clinical calculations (severity, bolus, deficit, maintenance, insulin)
│   ├── validate.js             # express-validator rule sets and validateRequest middleware
│   ├── checkWeightWithinLimit.js # 2SD weight centile check against WHO/MSF tables
│   ├── generateAuditID.js      # Generates a unique 6-character alphanumeric audit ID
│   ├── insertData.js           # Inserts a completed episode record into the database
│   ├── encrypt.js              # AES-256-GCM encryption + RSA-OAEP key wrapping
│   ├── decrypt.js              # RSA-OAEP key unwrapping + AES-256-GCM decryption
│   └── handleError.js          # Centralised error logging and optional email alert
└── review.md                   # Bugs, vulnerabilities and optimisation notes
```

---

## API routes

### `GET /`

Returns a brief HTML redirect message pointing users to the client application URL.

---

### `GET /config`

Returns the full `config.json` object as JSON, augmented with runtime version variables from environment variables. Used by the client on startup to obtain clinical constants, validation thresholds, and feature flags without hardcoding them in the frontend.

**Response shape (partial):**

```json
{
  "appName": "MSF Diabetes Calculator",
  "api": { "version": "1.0.0", "url": "..." },
  "client": { "version": "1.0.0", "url": "..." },
  "validation": { "weight": { "min": 2, "max": 150 }, "..." },
  "severity": { "severe": { "deficitPercentage": 10 }, "standard": { "deficitPercentage": 7.5 } }
}
```

---

### `POST /calculate`

The primary endpoint. Validates the request, performs all DKA calculations, encrypts sensitive fields, generates an audit ID, writes the episode to the database, and returns the audit ID alongside the full calculation result.

**Request body fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `legalAgreement` | boolean | ✓ | Must be `true` |
| `episodeType` | string | ✓ | `"real"` or `"test"` |
| `patientSex` | string | ✓ | `"male"` or `"female"` |
| `weight` | number | ✓ | kg, 2–150 |
| `patientAge` | number | ✓ | Decimal years, 0–19.01 |
| `useYearsMonths` | boolean | ✓ | Whether age was entered as years + months |
| `operationalCentre` | string | ✓ | MSF operational centre name |
| `project` | string | ✓ | MSF project code |
| `weightLimitOverride` | boolean | ✓ | Allow weight outside 2SD centile range |
| `use2SD` | boolean | ✓ | Whether 2SD lookup was used |
| `bloodGasAvailable` | boolean | ✓ | |
| `bloodKetonesAvailable` | boolean | ✓ | |
| `syringePumpAvailable` | boolean | ✓ | |
| `infusionPumpAvailable` | boolean | ✓ | |
| `dropFactor` | number | If no infusion pump | Drops/mL of giving set |
| `glucoseUnit` | string | ✓ | `"mg/dL"` or `"mmol/L"` |
| `glucose` | number | ✓ | Within unit-specific range |
| `bloodKetones` | number | If no urine ketones | mmol/L, ≥ 3 |
| `urineKetones` | number | If no blood ketones | Integer 2–4 |
| `diagnosticFeatures` | boolean | ✓ | Must be `true` |
| `pH` | number | Optional | 6.0–7.5 |
| `bicarbonate` | number | Optional | 0–30 mmol/L |
| `shockPresent` | boolean | ✓ | |
| `gcs` | number | If not shocked | 3–15 |
| `respiratorySupport` | boolean | Conditional | Required if not shocked and GCS ≥ 12 |
| `appVersion` | object | ✓ | `{ client: "x.x.x", api: "x.x.x" }` |
| `clientUseragent` | string | ✓ | Browser user-agent string |

**Success response — `200`:**

```json
{
  "auditID": "ABC123",
  "calculations": {
    "severity": { "val": "standard", "working": "<html narrative>" },
    "bolus":    { "volume": {}, "duration": {}, "rate": {}, "drops": null },
    "deficit":  { "percentage": {}, "standardSpeedVolume": {}, "standardSpeedRate": {}, "highSpeedVolume": {}, "highSpeedRate": {} },
    "maintenance": { "volume": {}, "rate": {} },
    "bagSpeeds":   { "standardSpeed": {}, "halfStandardSpeed": {}, "hypoSpeed": {} },
    "insulinRate": { "val": 3.0, "working": "<html narrative>" },
    "insulinDose": { "val": 6.0, "working": "<html narrative>" },
    "errors": []
  }
}
```

Each object within `calculations` contains a `val` (the numeric result) and a `working` (an HTML string showing the step-by-step calculation). `bagSpeeds` keys differ by severity — see `calculateVariables.js` for the full shape.

**Error response — `400`:**

```json
{ "errors": [{ "msg": "Human-readable error description" }] }
```

**Error response — `500`:**

```json
{ "errors": [{ "msg": "Failed to perform calculations: <detail>" }] }
```

---

### `GET /decrypt`

Triggers decryption of one or all stored patient records and writes the plaintext results to `tbl_decrypt`.

| Query parameter | Value |
|---|---|
| `decryptID` | An auditID string, or `"all"` to process every record |

> ⚠️ This route has no authentication. See [review.md](review.md) — V1.

---

## Configuration (`config.json`)

The config file is the single source of truth for all clinical constants. Key sections:

| Section | Purpose |
|---|---|
| `validation` | Input ranges for weight, age, glucose, pH, bicarbonate, GCS, ketones |
| `severity` | pH / bicarbonate thresholds and deficit percentages for standard vs severe DKA |
| `caps` | Maximum values for bolus, deficit, maintenance, and insulin calculations |
| `bolus` | mL/kg dose and duration (shocked vs not shocked) |
| `insulin` | Age threshold and rate/dose options for IV and IM insulin |
| `deficitReplacementDuration` | Hours over which deficit is replaced (48) |
| `bagSpeedGlucoseThresholds` | Glucose thresholds for bag-speed transitions (per unit) |
| `weightLimits` | Per-sex 2SD centile arrays indexed by age in months (228 entries each) |
| `operationalCentres` | Allowed MSF operational centres and their project codes |
| `api.database` | Database name, table names, and user names |
| `decimals` | Decimal places for each output field |

---

## Encryption model

Patient-identifiable fields are encrypted before database storage using a two-layer scheme:

1. A random 256-bit AES key is generated per episode.
2. The patient data is encrypted with AES-256-GCM (provides authenticated encryption).
3. The AES key is encrypted with the RSA public key using OAEP/SHA-256 padding.
4. The database stores the RSA-wrapped AES key, the AES ciphertext, IV, and GCM auth tag as a JSON blob in `encryptedData`.

Decryption reverses the process using the RSA private key, accessed only via the `/decrypt` route.

---

## Database

The API targets MySQL. Two database users with least-privilege access are used:

| User | Permission | Used by |
|---|---|---|
| `msfdiabetes_app_select` | SELECT on `tbl_calculate` | `generateAuditID.js` |
| `msfdiabetes_app_insert` | INSERT on `tbl_calculate` | `insertData.js` |

### `tbl_calculate` columns

| Column | Type | Notes |
|---|---|---|
| `id` | INT AUTO_INCREMENT | |
| `auditID` | VARCHAR | 6-character unique identifier |
| `episodeType` | VARCHAR | `"real"` or `"test"` |
| `appVersion` | JSON | Client and API version at time of submission |
| `serverCalculations` | BOOL | Always `true` for server-side episodes |
| `legalAgreement` | BOOL | |
| `operationalCentre` | VARCHAR | |
| `project` | VARCHAR | |
| `clientUseragent` | VARCHAR | |
| `clientIP` | VARCHAR | |
| `encryptedData` | TEXT | JSON blob — see Encryption model |
| `weightLimitOverride` | BOOL | |
| `use2SD` | BOOL | |
| `bloodGasAvailable` | BOOL | |
| `bloodKetonesAvailable` | BOOL | |
| `syringeDriverAvailable` | BOOL | |
| `serverDatetime` | DATETIME | Set by MySQL `DEFAULT CURRENT_TIMESTAMP` |

---

## Testing

`tests.json` is a Postman collection that covers the full range of `GET /config` and `POST /calculate` scenarios (mild, standard, severe DKA; various equipment availability combinations). Import it into [Postman](https://www.postman.com/) and point the collection variables at your target environment.

---

## Error handling

All routes delegate to `handleError(error, statusCode, route, message, res, info[])` in `modules/handleError.js`, which:

1. Logs the error with a timestamp to `console.error`.
2. Sends a JSON response with the appropriate status code.
3. If the status is 500 and `config.underDevelopment` is `false`, sends an alert email to the configured admin address via Nodemailer.

Set `"underDevelopment": true` in `config.json` to suppress email notifications during development.
