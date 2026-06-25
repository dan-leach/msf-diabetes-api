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

### V2 — No rate limiting (HIGH)
**File:** `index.js`

All endpoints are publicly accessible with no request throttling. `POST /calculate` performs RSA public-key encryption and a database write on every call. A sustained flood of requests could exhaust server resources or rack up database connection costs.

**Fix:** Add [`express-rate-limit`](https://github.com/express-rate-limit/express-rate-limit) middleware, with a stricter limit on `/calculate` than on `/config`.

---

### V3 — RSA keys crash the server if environment variables are absent (MEDIUM)
**Files:** `modules/encrypt.js`, `modules/decrypt.js`

Both modules call `crypto.createPublicKey` / `crypto.createPrivateKey` at module-load time. If `rsaPublicKey` or `rsaPrivateKey` is not set, Node throws during `require()` and the process exits with no helpful diagnostic message.

**Fix:** Validate required environment variables at startup in `index.js` and exit with a clear message; or lazy-load the key objects on first use.

---

### V4 — CORS open to all origins (MEDIUM)
**File:** `index.js`

`app.use(cors())` with no options allows any origin to make cross-origin requests to a clinical API.

**Fix:** Pass an explicit `origin` allowlist:
```js
app.use(cors({ origin: [config.client.url] }));
```

---

### V5 — `trust proxy` depth may not match deployment topology (LOW)
**File:** `index.js`

`app.set("trust proxy", 3)` instructs Express to trust three proxy hops when reading the client IP. If the actual deployment sits behind fewer proxies, a malicious caller can spoof `X-Forwarded-For` to fake their IP address in the audit log.

**Fix:** Set the trust depth to match the actual number of reverse proxies in front of the application (typically 1 for a single Nginx/load-balancer layer).

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
