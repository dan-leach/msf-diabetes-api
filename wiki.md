# MSF Diabetes API — Project Wiki

This document is intended for the project team: developers, clinical leads, and project managers. It covers architecture, data governance, security, deployment, and operational considerations.

---

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
│                  Client (browser / PWA)              │
│           Vue 3 — msf.dka-calculator.co.uk          │
└────────────────────┬────────────────────────────────┘
                     │ HTTPS / JSON
                     ▼
┌─────────────────────────────────────────────────────┐
│               MSF Diabetes API                       │
│         Node.js / Express — port 3000               │
│                                                      │
│  Routes:                                             │
│    GET  /config          ← config.json + env vars   │
│    POST /calculate       ← main clinical endpoint   │
│    GET  /decrypt         ← admin: decrypt records   │
│                                                      │
│  Modules:                                            │
│    validate.js           input validation            │
│    checkWeightWithinLimit.js  centile check         │
│    calculateVariables.js      DKA calculations      │
│    encrypt.js / decrypt.js    AES+RSA encryption    │
│    generateAuditID.js         unique ID generation  │
│    insertData.js              database write         │
│    handleError.js             logging + alerts      │
└─────────┬───────────────────────────┬───────────────┘
          │ mysql2                    │ Nodemailer
          ▼                          ▼
   ┌─────────────┐           ┌──────────────┐
   │   MySQL DB  │           │  SMTP server │
   │ msfdiabetes │           │  (alerts)    │
   └─────────────┘           └──────────────┘
```

The client can also operate entirely offline (no API call). In that case the calculation runs in the browser using a mirrored copy of `calculateVariables.js`, and the result is stored in `localStorage` for later sync.

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
`auditID`, `episodeType`, `appVersion`, `operationalCentre`, `project`, `clientUseragent`, `clientIP`, `legalAgreement`, `weightLimitOverride`, timestamps, equipment availability flags.

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
- Database table and user names

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

| Key | Location | Who has access |
|---|---|---|
| RSA public key | Environment variable `rsaPublicKey` (base64 PEM) | API server |
| RSA private key | Environment variable `rsaPrivateKey` (base64 PEM) | API server + authorised admin |

The private key must never appear in the codebase, logs, or configuration files. It should be treated with the same care as a signing certificate.

### Decryption access

The `/decrypt` endpoint provides a mechanism to recover plaintext patient data for authorised purposes (e.g. clinical audit, data export). **This endpoint currently has no authentication.** Access should be restricted at the network/infrastructure layer (e.g. IP allowlist, VPN requirement) until application-layer authentication is implemented. See [review.md](review.md) — V1.

### Data minimisation

The API stores the minimum data required for audit purposes. Equipment availability flags and episode metadata are stored in plaintext because they are not identifiable in isolation. Clinical values (weight, age, biochemistry) are encrypted. The client IP address is stored in plaintext for abuse monitoring purposes.

### Retention

No automated retention/deletion policy is currently implemented at the application layer. A data retention schedule should be agreed with the MSF data protection officer and implemented as a scheduled database job.

---

## 6. Audit IDs

Each episode is assigned a 6-character audit ID drawn from a 31-character alphabet (digits 2–9 and uppercase letters, excluding characters that are visually ambiguous: 0/O, 1/I/L). This gives 31⁶ ≈ 887 million possible values.

The ID is generated by the server (not the client) to guarantee uniqueness against the database. It is returned to the client and displayed to the clinician, who can quote it to the project team if they need to retrieve or discuss a specific episode.

Offline episodes (calculated in the browser without API access) use a client-generated ID of the same format. When the episode is later synced to the API, the client-generated ID is preserved.

---

## 7. Versioning

Three version strings are in use:

| Variable | Meaning |
|---|---|
| `process.env.apiVersion` | API application version |
| `process.env.clientVersion` | Client application version at time of request |
| `process.env.lastUpdated` | Date of last deployment |

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
3. Ensuring all required environment variables are set.
4. Restarting the Node process (e.g. via PM2 or systemd).

The server listens on `process.env.PORT` (default `3000`) and is expected to sit behind a reverse proxy (Nginx) that handles TLS termination.

### Environment separation

| Environment | `underDevelopment` in config.json | Email alerts |
|---|---|---|
| Production | `false` | Enabled |
| Development / staging | `true` | Suppressed |

The `underDevelopment` flag also causes the client to target the development API URL rather than the production URL.

---

## 11. Known issues and technical debt

See [review.md](review.md) for the full list. The most significant items for project planning are:

| Ref | Severity | Summary |
|---|---|---|
| B1 | HIGH | Double HTTP response possible on validation failure in `/calculate` |
| V1 | HIGH | `/decrypt` has no authentication |
| V2 | HIGH | No rate limiting on any endpoint |
| O1 | HIGH | Per-request DB connections — connection pooling not implemented |
| V4 | MEDIUM | CORS open to all origins |
| B3 | MEDIUM | `hypoSpeed` mutates `highSpeed` by reference |

---

## 12. Relationship to the client repository

| Concern | API repo | Client repo |
|---|---|---|
| Clinical calculations | Primary (server-side) | Mirror (offline fallback) |
| Validation rules | Primary (source in `config.json`) | Derived (fetched from `/config`) |
| Weight centile tables | Primary (in `config.json`) | Mirror (fetched from `/config`) |
| Audit storage | ✓ | — |
| Offline support | — | ✓ (localStorage + sync) |
| PDF output | — | ✓ (pdfmake) |

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
