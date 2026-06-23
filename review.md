# Code Review — MSF Diabetes API

Findings from a full review of the codebase. Items are grouped by category and ranked by severity within each group.

---

## Bugs

### B1 — Execution continues after error response is sent (HIGH)
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

**Fix:** Add `return` after each `handleError` call, or restructure so errors propagate to the outer `catch`.

---

### B2 — Insulin rate working string shows wrong rate for age ≥ 2 (LOW)
**File:** `modules/calculateVariables.js` — `calculateInsulinRate()`

The HTML working narrative displays `config.insulin.rateOptions[0]` for both the `< 2 years` and `>= 2 years` bullet points. The `>= 2 years` entry should reference `config.insulin.rateOptions[1]`. The *calculation* uses the correct value; only the displayed explanation is wrong.

```js
// Both lines currently show rateOptions[0]
<li>Age <${config.insulin.ageThreshold} years = ${config.insulin.rateOptions[0]} Units/kg/hour</li>
<li>Age >=${config.insulin.ageThreshold} years = ${config.insulin.rateOptions[0]} Units/kg/hour</li>
//                                                                             ^ should be [1]
```

---

### B3 — `hypoSpeed` mutates `highSpeed` by reference (MEDIUM)
**File:** `modules/calculateVariables.js` — `calculateBagSpeeds()`

`const hypoSpeed = highSpeed` copies the object reference, not the value. The subsequent `hypoSpeed.working = ...` permanently overwrites `highSpeed.working`. Any code that reads `highSpeed.working` after this line receives the mutated (hypo-prefixed) string instead of the original.

**Fix (already applied in JSDoc update):** Construct a new object rather than reassigning the property:
```js
const hypoSpeed = { val: highSpeed.val, working: prefix + highSpeed.working };
```

---

### B4 — `checkWeightWithinLimit` throws a primitive string, not an `Error` (LOW)
**File:** `modules/checkWeightWithinLimit.js`

`throw \`...\`` throws a string literal. The catch block handles it via `.toString()`, so no crash occurs, but stack traces are unavailable and the pattern breaks standard error handling conventions.

**Fix:** Replace with `throw new Error(\`...\`)`.

---

### B5 — `connection` potentially out of scope in `finally` block (MEDIUM)
**Files:** `modules/insertData.js`, `modules/generateAuditID.js`

`connection` is declared with `const` inside the `try` block. If `mysql.createConnection()` rejects before the assignment completes, `connection` is not in scope when the `finally` block runs, causing a `ReferenceError`. This is silently swallowed by the nested `try/catch` in `finally`, so no crash surfaces to the caller — but the original connection error may be obscured.

**Fix:** Declare `let connection;` before the `try` block.

---

### B6 — Implicit global variable in `handleError` (LOW)
**File:** `modules/handleError.js`

The `html` variable on the error-email path is assigned without a declaration keyword, creating an implicit global in non-strict mode:

```js
html = `<p>route: ${route}<br>...`; // ← missing let/const
```

**Fix:** Add `const html =`.

---

## Vulnerabilities

### V1 — No authentication on `/decrypt` endpoint (HIGH)
**File:** `index.js`

`GET /decrypt?decryptID=<id>` triggers database retrieval and RSA decryption of a patient record with no authentication, API key check, or IP allowlist. Any caller who knows (or guesses) a valid auditID can trigger decryption of that record.

**Fix:** Protect the route with at minimum a server-side secret passed as a header, and consider restricting to specific IP ranges (e.g. the server's own management network).

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

`app.use(cors())` with no options allows any origin to make credentialled cross-origin requests to a clinical API.

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

The current approach generates a random ID then queries the database to check uniqueness in a loop, potentially making several round-trips. With 31⁶ (~887 million) possible IDs and a small dataset the collision probability is negligible, but the loop has no maximum iteration guard.

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

### O5 — Dead import: `sodiumOsmoRules` imported but no route defined (LOW impact)
**File:** `index.js`

`sodiumOsmoRules` is destructured from `./modules/validate` on line 24 but is never used; no `/sodium-osmo` route is registered in `index.js`.

**Fix:** Remove the unused import, or add the route if it is planned.

---

### O6 — `errors` array in `calculateVariables` is initialised but never populated (LOW impact)
**File:** `modules/calculateVariables.js`

`const errors = []` is declared at the top of `calculateVariables`, included in the return value, and checked in `index.js` (`if (calculations.errors.length)`). However, no code within `calculateVariables` ever pushes to this array — errors are thrown as exceptions instead. The array therefore always returns empty, making the check in `index.js` redundant.

**Fix:** Either populate the array with caught errors (converting from throw-based to result-based error handling) or remove the array and update `index.js` to rely purely on exception handling.
