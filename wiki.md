# MSF Diabetes API

This API is designed to be used with the MSF Diabetes Calculator Client — see the client repository: https://github.com/dan-leach/msf-diabetes.

See updates to this repo in the [changelog](https://github.com/dan-leach/msf-diabetes-api/wiki/Changelog).

## 1. What this project does

The MSF Diabetes API is the server-side component of the MSF Diabetes Calculator — a tool for clinicians in MSF field projects to calculate the fluid and insulin management parameters for a child presenting with diabetic ketoacidosis (DKA).

The API has two core responsibilities:

1. **Calculate** — Accept validated patient data from the web client, apply the MSF 2024 paediatric DKA protocol, and return a structured set of clinical variables (bolus volumes, infusion rates, insulin doses) with step-by-step working for display to the clinician.

2. **Audit** — Encrypt and store a record of every real episode (anonymised but recoverable) to support quality improvement, guideline compliance monitoring, and retrospective analysis.

Clinical decision-making remains entirely the responsibility of the treating clinician. The application is a calculation aid, not a medical device.

---

## 2. System architecture

```
┌─────────────────────────────────────────────────────┐
│                  Client (browser / PWA)             │
│                 Vue 3 — diabetes.msf.net            │
└────────────────────┬────────────────────────────────┘
                     │ HTTPS / JSON
                     ▼
┌──────────────────────────────────────────────────────┐
│               MSF Diabetes API                       │
│         Node.js / Express — port 3000                │
|                api.diabetes.msf.net                  |
│                                                      │
│  Routes:                                             │
│    GET  /config              ← config + env vars     │
│    POST /calculate           ← main clinical endpoint│
│    POST /sync-offline-data   ← sync offline episode  │
│    POST /feedback            ← submit feedback       │
│    GET  /decrypt             ← admin: decrypt records│
│                                                      │
│  Modules:                                            │
│    validate.js           input validation            │
│    checkWeightWithinLimit.js  centile check          │
│    calculateVariables.js      DKA calculations       │
│    encrypt.js / decrypt.js    AES+RSA encryption     │
│    generateAuditID.js         unique ID generation   │
│    insertData.js              database write         │
│    handleError.js             logging + alerts       │
└─────────┬───────────────────────────┬────────────────┘
          │ mysql2                    │ Nodemailer
          ▼                           ▼
   ┌─────────────┐           ┌──────────────┐
   │   MySQL DB  │           │  SMTP server │
   │ msfdiabetes │           │  (alerts)    │
   └─────────────┘           └──────────────┘
```

The client can also operate entirely offline (no API call). In that case the calculation runs in the browser using a mirrored copy of `calculateVariables.js`, and the result is stored in `localStorage` for later sync via `POST /sync-offline-data`.

---

## 3. Data flow — a real episode

```
1. Clinician completes form in browser
2. Client sends POST /calculate with validated JSON
3. API validates input (express-validator rules)
4. API checks weight is within 2SD centile range
5. API calls calculateVariables() → returns all clinical values
6. API encrypts patient-identifiable fields (AES-256-GCM + RSA)
7. API generates unique 6-character auditID
8. API writes encrypted record to tbl_calculate
9. API returns { auditID, calculations } to client
10. Client displays results to clinician
```

Patient-identifiable fields that are encrypted at step 6:
`patientSex`, `weight`, `patientAge`, `glucose`, `glucoseUnit`, `bloodKetones`, `urineKetones`, `diagnosticFeatures`, `pH`, `bicarbonate`, `shockPresent`, `gcs`, `respiratorySupport`

Fields stored in plaintext (low-identifiability):
`auditID`, `episodeType`, `appVersion`, `operationalCentre`, `project`, `clientUseragent`, `clientIP`, `legalAgreement`, `weightLimitOverride`, `use2SD`, `useYearsMonths`, `syringePumpAvailable`, `infusionPumpAvailable`, `dropFactor`, `offlineTimestamp`, `serverDatetime`.

---

## 4. Configuration management

All clinical constants live in `config.json` in the repository root. This is the single source of truth for:

- Validation ranges (weight, age, glucose, pH, bicarbonate, GCS, ketones)
- Severity thresholds and deficit percentages
- Bolus dose and duration
- Insulin age thresholds and dose/rate options
- Weight caps and all other numerical caps
- WHO/MSF 2SD centile tables (228 data points per sex)
- Operational centres and project codes
- Database table names

**Database credentials (user names and passwords) are not stored in `config.json`**. They are injected at runtime via environment variables (`app_select_user`, `app_select_key`, `app_insert_user`, `app_insert_key`). See section 5 for the full environment variable reference.

**Changes to clinical constants require a code review by a clinician and a developer**, not just a developer. The config file is versioned in Git and any change will be visible in the commit history.

The client fetches the config from `GET /config` at startup, so a server-side config change takes effect for all users on their next session without a client deployment.

---

## 5. Encryption and data governance

### Encryption scheme

A hybrid encryption model protects patient-identifiable data:

- **AES-256-GCM** encrypts the patient data payload per-episode with a randomly generated key. GCM provides authenticated encryption — any tampering with the ciphertext is detectable on decryption.
- **RSA-OAEP (SHA-256)** encrypts the AES key using the server's RSA public key. Only the holder of the corresponding RSA private key can recover the AES key and therefore the plaintext.

The database stores: the RSA-wrapped AES key, the AES ciphertext, the initialisation vector (IV), and the GCM authentication tag. The AES key itself is never stored in plaintext.

### Key management

| Key             | Location                                          | Who has access                |
| --------------- | ------------------------------------------------- | ----------------------------- |
| RSA public key  | Environment variable `rsaPublicKey` (base64 PEM)  | API server                    |
| RSA private key | Environment variable `rsaPrivateKey` (base64 PEM) | API server + authorised admin |

The private key must never appear in the codebase, logs, or configuration files. It should be treated with the same care as a signing certificate.

`rsaPrivateKey` is **optional at startup** — the server will start without it. If it is not set, the `/decrypt` route returns `503 Service Unavailable` rather than crashing on module load. This allows the server to run in an audit-only mode (recording encrypted data) without holding the private key in the runtime environment.

### Decryption access

The `/decrypt` endpoint provides a mechanism to recover plaintext patient data for authorised purposes (e.g. clinical audit, data export). Access requires two conditions to be met:

1. The caller must supply an `X-Decrypt-Key` header whose value matches the `decryptSecret` environment variable. Requests without this header, or with an incorrect value, receive `401 Unauthorised`. If `decryptSecret` is not set on the server, the route is completely disabled.
2. The `rsaPrivateKey` environment variable must be set (see above). If it is not set, the route returns `503`.

Additional restriction at the network layer (e.g. IP allowlist or VPN) is strongly recommended as a second layer of protection.

The endpoint accepts a `decryptID` query parameter:

- `GET /decrypt?decryptID=<auditID>` — decrypts and re-stores a single record by audit ID.
- `GET /decrypt?decryptID=all` — decrypts and re-stores all records in `tbl_calculate`.

Decrypted records are written to `tbl_decrypt`. The original encrypted records in `tbl_calculate` are not modified.

### Data minimisation

The API stores the minimum data required for audit purposes. Equipment availability flags and episode metadata are stored in plaintext because they are not identifiable in isolation. Clinical values (weight, age, biochemistry) are encrypted. The client IP address is stored in plaintext for abuse monitoring purposes.

### Retention

No automated retention/deletion policy is currently implemented at the application layer. A data retention schedule should be agreed with the MSF data protection officer and implemented as a scheduled database job.

---

## 6. Audit IDs

Each episode is assigned a 6-character audit ID drawn from a 31-character alphabet (digits 2–9 and uppercase letters, excluding characters that are visually ambiguous: 0/O, 1/I/L). This gives 31⁶ ≈ 887 million possible values.

The ID is generated by the server (not the client) to guarantee uniqueness against the database. It is returned to the client and displayed to the clinician, who can quote it to the project team if they need to retrieve or discuss a specific episode.

Offline episodes (calculated in the browser without API access) use a client-generated ID of the same format. When the episode is later synced to the API via `POST /sync-offline-data`, the client-generated ID is preserved.

---

## 7. Versioning

Three version strings are in use:

| Variable                    | Meaning                                       |
| --------------------------- | --------------------------------------------- |
| `process.env.apiVersion`    | API application version                       |
| `process.env.clientVersion` | Client application version at time of request |
| `process.env.lastUpdated`   | Date of last deployment                       |

These are injected at runtime via environment variables and returned by `GET /config`. They are also stamped on each episode record (`appVersion` column) to allow retrospective identification of which version of the calculation logic was used for any given episode — important if a guideline change or bug fix affects outputs.

---

## 8. Operational centres and projects

Valid operational centres and their associated project codes are defined in `config.json` under `operationalCentres`. The client uses this list to populate form dropdowns. Adding or removing a project requires a config change and a server restart.

The `operationalCentre` and `project` fields in episode records are stored in plaintext, which allows aggregate reporting by centre and project without decryption.

---

## 9. Testing

`tests.json` is a Postman collection that provides integration test coverage for the `/config` and `/calculate` endpoints. It covers:

- Mild, standard, and severe DKA scenarios
- Blood gas present and absent
- Different equipment availability combinations (infusion pump, syringe pump, drop factor)
- Edge-case weight and age values

Tests are run manually against the target environment. There is currently no CI/CD pipeline that runs the collection automatically. Automating this with Newman (Postman's CLI runner) and a CI system would reduce the risk of regressions.

---

## 10. Deployment

The application is a standard Node.js process with no build step. Deployment consists of:

1. Pulling the latest code to the server.
2. Running `npm install` if `package.json` has changed.
3. Ensuring all required environment variables are set (the server performs a startup check and will refuse to start if any required variables are missing).
4. Restarting the Node process (e.g. via PM2 or systemd).

The server listens on `process.env.PORT` (default `3000`) and is expected to sit behind a reverse proxy (Nginx) that handles TLS termination.

### Required environment variables

| Variable          | Notes                                                  |
| ----------------- | ------------------------------------------------------ |
| `app_select_user` | MySQL username with SELECT-only privileges             |
| `app_select_key`  | Password for `app_select_user`                         |
| `app_insert_user` | MySQL username with INSERT-only privileges             |
| `app_insert_key`  | Password for `app_insert_user`                         |
| `rsaPublicKey`    | Base64-encoded RSA public key (PEM)                    |
| `corsOrigin`      | Allowed CORS origin (must match the client URL)        |
| `decryptSecret`   | Shared secret for `X-Decrypt-Key` header on `/decrypt` |
| `emailUser`       | SMTP username for error alert emails                   |
| `emailPassword`   | SMTP password for error alert emails                   |
| `emailRecipient`  | Address to receive error alerts                        |

### Optional environment variables

| Variable        | Notes                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| `rsaPrivateKey` | Base64-encoded RSA private key (PEM). If omitted, the server starts normally but `/decrypt` returns `503`. |
| `PORT`          | Port to listen on (default `3000`)                                                                         |
| `apiVersion`    | Stamped on episode records                                                                                 |
| `clientVersion` | Stamped on episode records                                                                                 |
| `lastUpdated`   | Returned by `/config`                                                                                      |

### Environment separation

| Environment           | `underDevelopment` in config.json | Email alerts |
| --------------------- | --------------------------------- | ------------ |
| Production            | `false`                           | Enabled      |
| Development / staging | `true`                            | Suppressed   |

The `underDevelopment` flag also causes the client to target the development API URL rather than the production URL.

---

## 11. Known issues and technical debt

All bugs and vulnerabilities identified in the initial code review have been resolved. The following optimisations remain open for future consideration:

| Ref | Impact | Summary                                                                                                                       |
| --- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| O1  | HIGH   | Per-request MySQL connections — a connection pool would reduce latency and DB load                                            |
| O2  | MEDIUM | `generateAuditID` uniqueness loop has no maximum retry guard                                                                  |
| O3  | LOW    | `config.json` is loaded inconsistently across modules (top-level vs. inside function body)                                    |
| O4  | LOW    | Clinical calculation logic is tightly coupled to HTML presentation strings, making unit testing harder                        |
| O5  | LOW    | `errors` array in `calculateVariables` is initialised but never populated — the check in `index.js` is therefore always false |

---

## 12. Relationship to the client repository

| Concern               | API repo                          | Client repo                      |
| --------------------- | --------------------------------- | -------------------------------- |
| Clinical calculations | Primary (server-side)             | Mirror (offline fallback)        |
| Validation rules      | Primary (source in `config.json`) | Derived (fetched from `/config`) |
| Weight centile tables | Primary (in `config.json`)        | Mirror (fetched from `/config`)  |
| Audit storage         | ✓                                 | —                                |
| Offline support       | —                                 | ✓ (localStorage + sync)          |
| PDF output            | —                                 | ✓ (pdfmake)                      |

The calculation logic in `modules/calculateVariables.js` and the validation logic in `modules/validate.js` have counterparts in the client's `src/assets/offlineCalculator/` directory. **Any change to the clinical logic must be applied to both repositories and released together**, otherwise online and offline calculations may diverge.

---

## 13. Governance checklist for clinical changes

Before merging any change that affects clinical outputs:

- [ ] Change has been reviewed and approved by a clinician with relevant expertise
- [ ] The affected `config.json` constants or `calculateVariables.js` logic have been updated in **both** the API and client repositories
- [ ] The Postman test collection has been updated to cover the change
- [ ] Tests have been run against the staging environment
- [ ] `apiVersion` has been incremented
- [ ] A changelog entry has been added to the GitHub wiki
- [ ] The MSF clinical lead has been notified of the deployment date

---

## 14. Replit import — code review findings and migration artifact corrections

The codebase was imported into Replit for a code review and documentation pass (branch `development-replit`). During import, Replit's platform automation applied an unsolicited SQLite migration commit, then a revert commit. **The revert was incomplete**, leaving several regressions against the true MSF baseline. All were identified and corrected before the branch was merged. This section documents what was found for team awareness.

### What the automated migration changed

Replit's tooling rewrote the database layer to use SQLite. A revert was then applied, but it restored some files to an older BSPED upstream state rather than to the MSF baseline, and left broken configuration references throughout.

### Regressions corrected

#### Database credentials (`modules/generateAuditID.js`, `modules/insertData.js`, `modules/decrypt.js`)

The revert replaced `process.env.app_select_user` / `app_insert_user` with references to `config.api.database.users.select` / `.insert` — a path that does not exist in `config.json` and would have thrown a `TypeError` at the first database call. All three modules were restored to use the correct environment variables.

This also clarifies a point of possible confusion: **database user credentials are not stored in `config.json`**. Table names are (`config.api.database.tables.*`), but user names and passwords are environment variables only.

#### `tbl_calculate` INSERT schema (`modules/insertData.js`)

The revert restored an older, shorter INSERT column list that omitted five fields added for the MSF deployment:

| Field removed by revert | Type     | Restored                                                          |
| ----------------------- | -------- | ----------------------------------------------------------------- |
| `useYearsMonths`        | BOOL     | ✓                                                                 |
| `syringePumpAvailable`  | BOOL     | ✓ (revert had left `syringeDriverAvailable` — the old BSPED name) |
| `infusionPumpAvailable` | BOOL     | ✓                                                                 |
| `dropFactor`            | INT      | ✓                                                                 |
| `offlineTimestamp`      | DATETIME | ✓                                                                 |

The `offlineTimestamp` null-normalisation (undefined → null for online episodes) and an undefined-bind-parameter guard (surfaces the offending field name rather than an opaque mysql2 error) were also restored.

#### `tbl_calculate` SELECT and `tbl_decrypt` INSERT (`modules/decrypt.js`)

The revert reinstated the old BSPED version of `decrypt.js` in its entirety. Two classes of error resulted:

1. `config.api.tables.calculate` / `config.api.tables.decrypt` — this path is `undefined` in `config.json` (the correct path is `config.api.database.tables.*`). Every call to `/decrypt` would have thrown at query time.
2. The SELECT and INSERT column lists referenced legacy BSPED fields (`patientHash`, `region`, `centre`, `clientDatetime`) that do not exist in the MSF `tbl_calculate` schema.

Both were corrected: the config path was fixed and the column lists were restored to the full MSF set consistent with the restored `insertData.js` schema.

#### `patientAge` exclusive maximum (`modules/validate.js`)

During the documentation pass, a comparison in the `patientAge` custom validator was inadvertently changed from `>=` to `>`, making the configured maximum age (16 years) inclusive when it should be exclusive (age must be strictly less than 16). This was independently spotted during review and corrected: the comparison is `>=`, an explanatory comment explaining why the upper bound is enforced in a custom validator rather than in `isFloat()` was restored, and the validation message was restored to show both bounds.

### How to identify this class of problem in future imports

If the codebase is re-imported into a platform that applies automated DB-layer migrations, the safest way to find leftover artifacts is:

```
git rev-list --parents -n 1 <migration-sha>
# → last SHA printed is the true pre-migration parent

git diff <pre-migration-parent> <revert-sha> --stat
# → any non-empty diff is a file the revert failed to fully restore
```

Cross-check every file in that diff against the pre-migration parent. Pay particular attention to: database connection credential references, column lists in INSERT/SELECT statements, and config path expressions.
