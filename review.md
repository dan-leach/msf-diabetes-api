# Code Review — MSF Diabetes API

Findings from a full review of the codebase. Items are grouped by category and ranked by severity within each group.

---

## Bugs

### B1 — Execution continues after error response is sent (HIGH) — fixed
**File:** `index.js` — `POST /calculate`

The weight-limit check and the calculations check both call `handleError` (which sends an HTTP response) inside a `try/catch` block, but neither block contains a `return` statement. Execution therefore falls through to the next line after the error has already been sent, which will eventually trigger Express's "Cannot set headers after they are sent" fatal error.

```js
// Current — handleError sends a response but execution continues
try {
  if (!check.pass) {
    throw new Error(check.error);
  }
} catch (error) {
  handleError(error, 400, "/calculate", "Check weight within limit failed", res);
  // ← execution continues here even after a 400 has been sent
}
data.patientAge = data.patientAge.toFixed(2); // ← runs regardless
```

---

### B2 — Insulin rate working string shows wrong rate for age ≥ 2 (LOW) — fixed
**File:** `modules/calculateVariables.js` — `calculateInsulinRate()`

The HTML working narrative displayed `config.insulin.rateOptions[0]` for both the `< 2 years` and `>= 2 years` bullet points. The `>= 2 years` entry now correctly references `config.insulin.rateOptions[1]`. The *calculation* was always correct; only the displayed explanation was wrong.

---

### B3 — `hypoSpeed` mutated `highSpeed` by reference (MEDIUM) — fixed
**File:** `modules/calculateVariables.js` — `calculateBagSpeeds()`

`const hypoSpeed = highSpeed` copies the object reference, not the value. The subsequent `hypoSpeed.working = ...` permanently overwrites `highSpeed.working`. Any code that reads `highSpeed.working` after this line receives the mutated (hypo-prefixed) string instead of the original.

**Status:** Fixed during the JSDoc review pass — `hypoSpeed` is now constructed as a new object:
```js
const hypoSpeed = { val: highSpeed.val, working: prefix + highSpeed.working };
```

---

### B4 — `checkWeightWithinLimit` throws a primitive string, not an `Error` (LOW) — fixed
**File:** `modules/checkWeightWithinLimit.js`

`` throw `...` `` threw a string literal. The catch block handled it via `.toString()`, so no crash occurred, but stack traces were unavailable and the pattern broke standard error handling conventions. Replaced with `throw new Error(\`...\`)`.

---

### B5 — `connection` potentially out of scope in `finally` block (MEDIUM) — fixed
**Files:** `modules/insertData.js`, `modules/generateAuditID.js`

`connection` was declared with `const` inside the `try` block. If `mysql.createConnection()` rejected before the assignment completed, `connection` was not in scope when the `finally` block ran, causing a `ReferenceError` silently swallowed by the nested `try/catch` — which could obscure the original connection error. Fixed by hoisting to `let connection;` before the `try` block in both files.

---

### B6 — Implicit global variable in `handleError` (LOW) — fixed
**File:** `modules/handleError.js`

The `html` variable on the error-email path was assigned without a declaration keyword, creating an implicit global in non-strict mode. Fixed by adding `const`.

---

## Vulnerabilities

### V1 — No authentication on `/decrypt` endpoint — fixed
**File:** `index.js`

`GET /decrypt?decryptID=<id>` had no authentication. In practice, decryption would fail without the RSA private key present in the environment (where it does not live by default), so the practical exposure was limited. Nonetheless, the endpoint is now protected by a shared-secret header check.

**Implementation:** A `decryptSecret` environment variable must be set on the server. Every request to `/decrypt` must include a matching `X-Decrypt-Key` header; requests without it receive a `401 Unauthorised` response immediately, before any decryption logic runs. If `decryptSecret` is not set, the route is effectively disabled.

```js
const secret = process.env.decryptSecret;
if (!secret || req.headers["x-decrypt-key"] !== secret) {
  return res.status(401).json({ errors: [{ msg: "Unauthorised" }] });
}
```

---

### V2 — No rate limiting (HIGH) — fixed
**File:** `index.js`

All endpoints were publicly accessible with no request throttling. `POST /calculate` performs RSA public-key encryption and a database write on every call, making a sustained flood particularly expensive. Fixed by adding `express-rate-limit` middleware with per-route limits sized to typical usage (~100 real episodes/day/IP) with generous leeway:

| Route | Limit | Window |
|---|---|---|
| `GET /config` | 200 | 1 hour |
| `POST /calculate` | 60 | 1 hour |
| `POST /sync-offline-data` | 60 | 1 hour |
| `POST /feedback` | 20 | 1 hour |
| `GET /decrypt` | 60 | 1 hour |

Standard `RateLimit-*` response headers are enabled so clients can inspect remaining allowances. Limits are enforced before validation middleware runs, so rejected requests incur minimal server work.

---

### V3 — RSA keys crash the server if environment variables are absent (MEDIUM) — fixed
**Files:** `index.js`, `modules/encrypt.js`, `modules/decrypt.js`

Both encrypt and decrypt modules call `crypto.createPublicKey` / `crypto.createPrivateKey` at module-load time. If `rsaPublicKey` or `rsaPrivateKey` is not set, the process would throw a cryptic error on the first request to `/calculate` or `/decrypt` rather than at startup.

Fixed by adding an explicit startup guard at the very top of `index.js`, before any `require` calls, that checks all four required environment variables and exits with a descriptive message if any are absent:

```js
const REQUIRED_ENV_VARS = ["rsaPublicKey", "rsaPrivateKey", "app_insert_key", "app_select_key"];
const missingEnvVars = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
if (missingEnvVars.length > 0) {
  console.error(`[startup] Missing required environment variable(s): ${missingEnvVars.join(", ")}. Server will not start.`);
  process.exit(1);
}
```

---

### V4 — CORS open to all origins (LOW) — fixed
**File:** `index.js`

`app.use(cors())` with no options allowed any origin to make cross-origin requests. Because the API has no cookie or session-based authentication, the traditional CSRF risk did not directly apply, but any website could insert fake episode records into the audit database regardless of volume (rate limiting caps quantity, not origin). Fixed by restricting allowed origins to `config.client.url`:

```js
app.use(cors({ origin: config.client.url }));
```

---

### V5 — `trust proxy` depth (LOW) — not applicable
**File:** `index.js`

`app.set("trust proxy", 3)` is correct for the production deployment topology (Cloudflare + reverse proxy chain). No change required.

---

### V6 — No explicit request body size limit (LOW)
**File:** `index.js`

`body-parser` defaults to 100 kB. This is not explicitly configured, making it easy to miss and potentially easy to change accidentally. For an API that only expects small JSON payloads, a tighter explicit limit (e.g. `10kb`) reduces exposure to large-payload attacks.

**Fix:**
```js
app.use(bodyParser.json({ limit: "10kb" }));
```

---

## Potential Optimisations

### O1 — Per-request database connections (HIGH impact)
**Files:** `modules/insertData.js`, `modules/generateAuditID.js`

A new MySQL connection is opened and closed on every call to either module. Connection establishment adds latency (typically 5–20 ms) and creates load on the database server.

**Fix:** Replace `mysql.createConnection` with `mysql.createPool` initialised once at application startup, and draw connections from the pool per-request.

---

### O2 — `generateAuditID` makes multiple round-trips to check uniqueness (MEDIUM impact)
**File:** `modules/generateAuditID.js`

The current approach generates a random ID then queries the database to check uniqueness in a loop, potentially making several round-trips. With 31⁶ (~887 million) possible IDs and a small dataset the collision probability is negligible, but the loop has no maximum retry guard.

**Fix (minimal):** Add a maximum retry limit and throw a descriptive error if it is exceeded. As a longer-term option, use a `INSERT ... WHERE NOT EXISTS` strategy or a UUID.

---

### O3 — `config.json` loaded inconsistently across modules (LOW impact)
**Files:** various

Some modules `require("../config.json")` at the top level; `handleError.js` calls `require("../config.json")` inside the function body on every invocation. Node caches `require` results so there is no real I/O cost, but the inconsistency adds confusion.

**Fix:** Move all `require` calls to the top of each module.

---

### O4 — Clinical calculation logic coupled to HTML presentation (LOW impact)
**File:** `modules/calculateVariables.js`

The calculation functions build HTML working strings inline alongside the numeric logic. This makes the module difficult to unit-test (test assertions must parse HTML) and makes it harder to support non-HTML output formats in future.

**Fix:** Separate calculation from formatting — return raw values from calculation functions and produce HTML in a dedicated formatting layer.

---

### O5 — `errors` array in `calculateVariables` is initialised but never populated (LOW impact)
**File:** `modules/calculateVariables.js`

`const errors = []` is declared at the top of `calculateVariables`, included in the return value, and checked in `index.js` (`if (calculations.errors.length)`). However, no code within `calculateVariables` ever pushes to this array — errors are thrown as exceptions instead. The array therefore always returns empty, making the check in `index.js` redundant.

**Fix:** Either populate the array with caught errors (converting from throw-based to result-based error handling) or remove the array and update `index.js` to rely purely on exception handling.
