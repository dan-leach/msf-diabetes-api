# Security review — MSF Diabetes API

**Review date:** 6 November 2026  
**Reviewed branch:** `v1.1`  
**Reviewed revision:** `62a4c2c` (before this report)  
**Status:** Code review complete; initial deployment answers incorporated. Proxy topology, database grants and backup/retention controls still require confirmation.

## Executive summary

The highest-priority concerns are availability failures and insufficient validation
of offline submissions, rather than a demonstrated SQL-injection vulnerability or
a break of AES encryption.

1. **Patch the HTTP dependency chain promptly.** Locked `body-parser` 1.20.2 is
   affected by a recently disclosed unauthenticated process-crash advisory.
   Parsing happens before route-specific rate limiting.
2. **Fix the confirmed feedback database connection leak.** Successful feedback
   requests never close their connection because of variable scope.
3. **Handle rejected promises in error emails and decryption.** Failures can
   escape application catches and terminate a process under normal modern Node defaults.
4. **Validate offline submissions as untrusted input.** Nonempty objects are not
   sufficient validation of clinical metadata, encryption envelopes or timestamps.
5. **Upgrade the confirmed production Node 20 runtime and verify proxy topology.**
   The private RSA key is currently offline, substantially reducing current
   decryption exposure. Other data-access and backup controls still need confirmation.

**No production exploitation, database access, credential inspection, application
fixes, dependency upgrades or Git pushes were performed.** The intentionally public
`/usage` route is not classified as a vulnerability merely because it lacks login.
Its resource consumption and the trustworthiness of its inputs are separate risks.

## Scope, evidence and limitations

Reviewed Express route handling, validation, calculation input boundaries, MySQL
access, encryption/decryption, errors/email, usage reporting, package manifests,
lockfile and deployment documentation. An independent read-only code review was
also used to cross-check the manual findings.

Automated scan results:

| Scanner | Status | Results |
| --- | --- | --- |
| Dependency audit, OSV data | Completed | 84 package/version advisory records: 1 critical, 33 high, 44 moderate, 6 low |
| Static application security scan | Completed; not marked incomplete | 0 findings |
| Privacy/dataflow scan | Completed | 0 findings |

These are **scanner counts, not 84 independently exploitable application defects**.
The same advisory can affect multiple package versions, related advisories can
overlap, and many require unused library features. Manual findings remain valid
despite the empty static/privacy results.

Safe, isolated local checks confirmed:

- The offline validation chains accept an arbitrary nonempty `data` object and
  arbitrary nonempty `encryptedData` object.
- A mocked successful `insertFeedback()` opens one connection and closes zero.
- The `shockPresent` validator accepts the string `"false"` and preserves it as a
  truthy JavaScript string.

No live denial-of-service payload was sent, even to the development app.
The operator supplied initial production details during the review (below).
Installed production dependency versions, exact proxy/worker topology, database
grants, edge controls, backup policy and detailed key custody were not available.
Lockfile exposure is confirmed; whether production installs that exact lockfile
still needs confirmation. Frontend/PWA code and its offline local storage are
outside this repository's review scope. This is not a complete clinical safety
validation, penetration test, infrastructure audit or regulatory-compliance opinion.

### Rating and effort scale

- **Critical:** credible direct path to catastrophic compromise with few prerequisites.
- **High:** material patient-data exposure or substantial service/data-integrity impact.
- **Medium:** meaningful impact requiring additional conditions, scale or access.
- **Low:** limited current impact or longer-term preparedness.

Ratings reflect this application, not a verbatim copy of package CVSS scores.
**Conditional** means deployment details can substantially raise or lower the rating.

Difficulty includes testing and rollout: **Easy** roughly hours to one engineering
day; **Moderate** roughly 2–5 days; **Hard** roughly 1–3+ weeks or cross-team work.
These are estimates, not commitments. Existing data migration and clinical sign-off
can extend them.

### Confirmed production context

The operator reports:

- Kualo shared-IP Linux hosting managed through cPanel.
- cPanel 138.0 build 21; Apache 2.4.69.
- Database version string `8.0.46-cll-lve`; x86_64 with a CloudLinux/LVE
  EL8-style kernel.
- **Production Node v20.20.2.** The official Node release table marks Node 20 EOL.
- **The RSA private key is not online in the current version.**
- A single operator currently controls access to data, logs and backups.

The host's name and shared public IP are not needed for these findings and are
not reproduced here. Apache/cPanel/CloudLinux package strings do not establish
whether vendor security fixes are current: older-looking kernel versions can
have backported fixes. No unsupported-OS or specific Apache exploit claim is
made from those strings alone.

Single-operator access reduces the number of authorised people, but it does not
establish database least privilege, isolation from other hosting tenants, MFA,
backup encryption or retention. The number of HTTP proxy hops remains unknown.
The missing private key means the normal `/decrypt` route cannot initiate a
decryption job; existing plaintext from earlier operations, if any, still needs
its own access/retention assessment.

## Risk register

| ID | Hazard | Application risk | Difficulty |
| --- | --- | --- | --- |
| S01 | Vulnerable request parser can crash the API before route limits | High, production-version dependent | Easy–Moderate |
| S02 | Feedback requests leak MySQL connections | High | Easy |
| S03 | Offline records lack a strict nested schema and trust policy | High | Moderate–Hard |
| S04 | Failed error-alert email can cause an unhandled rejection | High, conditional on mail failure | Easy |
| S05 | Decryption promises escape error handling | Dormant currently; High if decryption enabled | Easy–Moderate |
| S06 | Decryption exposes persistent plaintext and concentrates privilege | Conditional on legacy plaintext; High if enabled | Moderate–Hard |
| S07 | Fixed proxy-hop trust may permit IP spoofing/rate-limit evasion | High, conditional | Moderate |
| S08 | Per-process/IP limits do not bound distributed resource abuse | Medium; High at sufficient scale | Moderate |
| S09 | Public usage reports perform growing full-table work | Medium; High at sufficient scale | Moderate |
| S10 | Public writes allow fabricated/replayed monitoring data and feedback | Medium | Moderate–Hard |
| S11 | Errors expose details and inject unescaped content into alerts | Medium | Easy–Moderate |
| S12 | Accepted primitive types do not match calculation assumptions | Medium; potentially High clinical impact | Moderate |
| S13 | Encryption does not bind record context or prove submission origin | Medium | Moderate–Hard |
| S14 | Unused dependencies and install-time packages enlarge supply-chain exposure | Medium | Moderate |
| S15 | Production Node 20 is EOL; other host/transport controls unverified | High runtime maintenance risk; other controls conditional | Moderate |
| S16 | Retention and secondary copies may bypass encryption protections | Medium–High, conditional | Moderate–Hard |
| S17 | AI-assisted development introduces prompt-injection/supply-chain risks | Medium–High, conditional | Moderate |
| S18 | Encryption lifecycle lacks explicit migration/key-version strategy | Low near-term; Medium for long-lived records | Moderate–Hard |

### S01 — Request-parser vulnerability before route-level protection

**Hazard / rating:** **High**, if production uses the locked vulnerable parser and
passes compressed request bodies through to Node.

**Evidence:** `package-lock.json` locks `body-parser` 1.20.2, both directly and as
an Express 4.19.2 dependency. `index.js:59–61` installs JSON parsing globally with
default decompression enabled. Route limiters run later.

The official advisory **GHSA-27r3-jxmh-p828 / CVE-2026-111181**, published
22 October 2026, describes a single compressed request causing an uncaught error
after decoding. It does not require an authenticated or even matching route.
The advisory explicitly states the report was submitted with AI assistance:
this is a concrete recent development relevant to this code, not a speculative
claim that AI can break encryption. [R1]

**Mitigation options:** Upgrade the compatible Express/dependency chain and
regenerate/review the lockfile, ensuring *all* parser copies are patched. The
advisory names **1.20.9** and **2.4.0** as patched versions. If clients do not use
compressed requests, disabling parser inflation is a documented interim option;
validate that compatibility first. Edge rejection of unsupported encodings is
additional defence, not a substitute for dependency maintenance.

**Difficulty:** **Easy–Moderate**; dependency resolution and regression testing,
not simply changing a version range in `package.json`.

### S02 — Feedback connection leak can exhaust the database

**Hazard / rating:** **High** availability risk.

**Evidence:** `modules/insertData.js:167–188` declares `const connection` inside
`try`, then references `connection` in `finally`, outside its scope. The resulting
ReferenceError is swallowed, so `end()` never runs, including on successful writes.
A local mocked call confirmed one opened connection and zero closed connections.

Repeated legitimate traffic or automated feedback submissions can accumulate
connections until MySQL refuses work, affecting clinical calculations too.
The exact time to exhaustion depends on MySQL limits and idle timeouts.

**Mitigation options:** Declare the connection in the enclosing scope, close it
reliably in `finally`, and test success and failure paths. A bounded pool plus
proper release provides stronger protection. Review idle timeout and connection
budgets as deployment controls.

**Difficulty:** **Easy** for the scope fix and regression tests; **Moderate** if
introducing pooling across modules.

### S03 — Offline sync trusts arbitrary nested objects

**Hazard / rating:** **High** stored-data integrity risk; also a route to repeated
500s and alert amplification.

**Evidence:** `modules/validate.js:282–309` checks only that the audit ID is a string
and the two objects are nonempty. `index.js:395–422` then accesses
`data.data.appVersion.api` and inserts nested metadata/ciphertext.
An object without `appVersion` passes the validator but fails in the handler.
Structurally plausible fabricated metadata can proceed further.

**Mitigation options:** Define strict schemas for required/optional nested fields,
types, enums, lengths, timestamps, audit IDs and encryption-envelope encodings/
lengths. Reject unknown fields, impossible/future timestamps and malformed version
objects. Apply an explicit policy for unverified offline calculations: quarantine,
flag or reconcile them rather than treating them as server-verified episodes.

Schema validation alone cannot prove a real patient encounter occurred. A signature
from a key embedded in a public client is not meaningful identity proof; a stronger
provenance scheme needs device/user enrolment and a compatible offline design.
Do not automatically demand login for all clinical use without considering access
requirements.

**Difficulty:** **Moderate** for schema enforcement and compatible client tests;
**Hard** for stronger provenance without disrupting offline operation.

### S04 — Error notification failure can become process failure

**Hazard / rating:** **High**, conditional on SMTP rejection, outage or missing/
incorrect mail configuration.

**Evidence:** `modules/handleError.js:53–65` calls async `sendMail()` without
awaiting or catching it; `:110–111` awaits SMTP delivery without a catch.
An ordinary 500 can therefore trigger an unhandled promise rejection. Modern
Node normally treats an unhandled rejection as an uncaught exception unless its
runtime policy is changed. Process supervision reduces downtime but does not
remove repeated crash potential.

**Mitigation options:** Catch delivery failures locally; never allow monitoring
failure to crash the clinical service. Bound email queue size and send rate,
deduplicate recurring alerts, use transport timeouts and a bounded/reused transport.
Avoid recursive alerts about alert failures.

**Difficulty:** **Easy** for rejection handling; **Moderate** for durable bounded
alert delivery. Turning off email alone would remove a monitoring control.

### S05 — Decryption runs outside its catches and reports premature success

**Hazard / rating:** **High when enabled**; requires the decryption route's secret
and configured RSA private key, rather than being an unauthenticated bypass.
**Current production applicability:** dormant on the normal HTTP path because
the operator confirms the private key is not online. Fix before enabling it.

**Evidence:** `index.js:520–527` calls async `decrypt()` without awaiting it.
`modules/decrypt.js:187–194` also neither awaits nor returns `decryptTable()`.
Missing IDs, SQL errors, duplicate destination rows or connection failures can
reject after the route has returned `"Decrypt run"`. Connections are closed only
on normal completion (`modules/decrypt.js:178`), not in `finally`.

**Mitigation options:** Return/await promises all the way through, validate a scalar
audit ID or an explicit bulk operation, always close connections, and report actual
completion. For bulk work, use a bounded job queue with job status, concurrency
limits, idempotent writes and an audit trail rather than overlapping HTTP-triggered
full-table jobs.

**Difficulty:** **Easy–Moderate** for reliable single-record execution; **Moderate**
for a production bulk-job design.

### S06 — Persistent plaintext and shared-secret admin access

**Hazard / rating:** **High, conditional** on decryption being enabled, stored
plaintext and who can read it. No exposed plaintext download route was found.
**Current production applicability:** the private key is offline, so a stolen
route secret alone cannot initiate decryption. Confirm whether `tbl_decrypt`
contains any historic plaintext; keeping today's key offline does not remove
copies created previously.

**Evidence:** `modules/decrypt.js:85–93,147–175` supports `"all"` and writes decrypted
patient data into `tbl_decrypt`; no cleanup policy is implemented here.
`index.js:505–517` uses a shared header secret and holds the private key in the web
process environment when enabled.

The database account named as the insert user is also used for the SELECT required
by decryption (`modules/decrypt.js:74–94`). Its name/documentation does not prove
least privilege: actual grants must be inspected. Strict INSERT-only grants make
this feature fail; broad grants can expose unnecessary data.

**Mitigation options:** Prefer an isolated admin job/runtime with the private key,
separate database credentials and named operator authentication. Restrict network
access, audit bulk decrypts, rotate the shared secret if retained, and avoid
persistent plaintext where possible. If plaintext storage is necessary, use
table-specific grants, short approved retention and protected backups.

**Difficulty:** **Moderate–Hard**, including operational access and data lifecycle.
Disabling decryption on the public web process is a possible interim control if
the operational workflow permits it.

### S07 — Proxy trust is unsafe unless ingress topology matches it

**Hazard / rating:** **High, conditional**. Spoofed client IPs can bypass IP-based
limits and corrupt IP-based reporting.

**Evidence:** `index.js:137–138` unconditionally trusts three proxy hops.
It listens on `0.0.0.0` (`:552–554`); that alone does not prove Internet exposure.
All IP rate limits and stored `req.ip` values depend on the trust boundary.

If any ingress path has fewer hops, allows direct origin access, or fails to
sanitise forwarding headers, an attacker may control the reported client address.
Express explicitly warns about different-length ingress paths. [R2]

**Mitigation options:** Map every production path, block direct-origin access and
configure a trust policy matching controlled proxies. Verify how the last trusted
proxy handles forwarded headers; test expected addresses and bypass attempts in
staging. Do not blindly change this to `true`, a guessed hop count or a guessed subnet.

**Difficulty:** **Moderate**, mainly infrastructure verification and deployment tests.

**Important scanner qualification:** The audit rates `proxy-addr` 2.0.7 as critical
under **GHSA-jqcg-44mw-7w3h / CVE-2026-90711**. That specific advisory requires
particular mis-specified IPv6 trust subnets. This app currently uses a numeric hop
function, so the advisory's specific exploit was **not established**. Upgrade the
dependency, but do not confuse that alert with the separate hop-trust risk. [R3]

### S08 — Rate limits are local and start after body parsing

**Hazard / rating:** **Medium**, potentially **High** under distributed abuse or
multiple workers.

**Evidence:** `index.js:68–135` configures per-IP limiters without a shared store.
Parsing occurs first (`:61`). Calculations perform cryptography and database work;
sync/feedback perform writes. There is no application-wide concurrency budget,
global write quota or bounded database pool.

Limits reset with process restarts and are independent per worker/instance. Many
source IPs can exceed a single-IP budget without bypassing the limiter. Shared
clinical-network IPs may conversely experience false-positive blocking.

**Mitigation options:** Retain fair per-IP limits, add verified edge connection/body/
timeout controls, a shared limiter store where needed, bounded connection pools
and per-operation concurrency limits. Use global resource budgets and alerting,
not only CAPTCHA or blanket authentication that can obstruct clinical access.

**Difficulty:** **Moderate**, with load testing and clinical-access checks.

### S09 — `/usage` repeats work proportional to the entire database

**Hazard / rating:** **Medium** now, potentially **High** as records grow.

**Evidence:** `modules/usage.js:97–121` fetches every record's metadata; `:16–69`
retains/group-sorts timestamps in memory on each request. `/usage` allows
60 requests/hour/IP with no cache (`index.js:128–135,163–175`).

Multiple callers can repeatedly consume MySQL CPU, transfer the full result set
and consume application memory. This can compete with clinical traffic without
any large HTTP request.

**Mitigation options:** Keep reporting public as requested. Compute/cache a
bounded report periodically with single-flight refresh, or maintain audited
incremental summaries. Isolate reporting resources, enforce query/concurrency
budgets and benchmark a representative database size. Preserve the agreed
deduplication semantics when optimising.

**Difficulty:** **Moderate**. Incorrect incremental deduplication can change the
meaning of the metric, so correctness tests matter.

### S10 — Reporting and feedback can be fabricated or replayed

**Hazard / rating:** **Medium** monitoring/audit integrity risk.

**Evidence:** Public `/calculate`, `/sync-offline-data` and `/feedback` accept
caller-supplied episode classification/project data or audit IDs. Offline timestamps
are client supplied. `modules/usage.js:23–53` treats accepted real records as inputs
to the estimate. Feedback validates a string audit ID but does not prove ownership
(`modules/validate.js:318–327`).

Attackers can generate plausible real-use records, vary grouping/timestamps or
attach unsolicited feedback to known audit IDs. The API has no proof of a genuine
clinical encounter. Offline retries may duplicate records if database constraints
or client idempotency do not prevent them; actual constraints need confirmation.

**Mitigation options:** Report the estimate as unverified usage, not a patient or
outcome count. Validate metadata, enforce documented ID uniqueness/idempotency,
detect anomalous bursts and quarantine suspect submissions. Consider scoped
feedback submission tokens if attribution matters. Stronger identity/device proof
is an optional product decision with offline/privacy trade-offs.

**Difficulty:** **Moderate** for idempotency/validation/anomaly flags; **Hard** for
trusted encounter provenance. This is not a reason by itself to add `/usage` login.

### S11 — Raw errors and unescaped alert content expose secondary information

**Hazard / rating:** **Medium**.

**Evidence:** `modules/handleError.js:41–65` logs the full error and request context,
returns `error.message` to clients and inserts it plus context into HTML email.
Database errors may include SQL/schema/value details. `index.js:359–364` includes
unvalidated request fields in error context. `/usage` already returns a safer
generic error and should retain that behaviour.

Email content injection can mislead operators or introduce malicious links.
It is **not** evidence of arbitrary script execution in modern email clients.
Validation error arrays also echo rejected values (`modules/validate.js:340–343`).

**Mitigation options:** Use generic 500 messages and correlation IDs. Redact SQL,
clinical values and user-supplied context in structured logs. HTML-encode alert
fields or send plain text; truncate content and cap alert frequency. Review log
collectors and mail access/retention. Preserve useful safe 400 validation messages
without unnecessarily echoing sensitive rejected values.

**Difficulty:** **Easy–Moderate**, depending on existing monitoring.

### S12 — Input validation accepts types that calculations interpret differently

**Hazard / rating:** **Medium** security/input-integrity risk, with potentially
**High clinical impact** if clients submit these forms. No cross-user result
tampering or privilege escalation was demonstrated.

**Evidence:** `modules/validate.js` uses `.isBoolean()` without normalisation;
a local check accepted `"false"` as `shockPresent` and retained a string.
`modules/checkWeightWithinLimit.js:38` uses truthiness for `weightLimitOverride`,
so the accepted string `"false"` takes the override branch.
Numeric validators similarly accept numeric strings while
`index.js:282–283` assumes age has a numeric `.toFixed()` method.
`glucoseHigh` affects conditional validation (`modules/validate.js:146–166`)
without its own explicit type check.

**Mitigation options:** Define a single canonical JSON contract: either reject
non-boolean/non-numeric primitives or intentionally normalise them before
conditional checks and calculations. Restore explicit `glucoseHigh` validation,
test real booleans versus strings/numbers/null and verify every clinical branch
against the offline counterpart.

**Difficulty:** **Moderate** because client compatibility and clinical regression
testing are necessary. Do not change clinical formulas as part of a casual type fix.

### S13 — Authenticated encryption does not authenticate the record's origin/context

**Hazard / rating:** **Medium** record-integrity risk.

**Evidence:** `modules/encrypt.js:29–36` uses AES-GCM without additional
authenticated data (AAD); `:45–55` wraps the key using RSA-OAEP/SHA-256.
`modules/decrypt.js:137–173` decrypts a stored envelope and associates it with
separate database metadata. The envelope contains no explicit format/key version.

Valid ciphertext authenticates its encrypted bytes, not the surrounding audit ID,
project or classification. Someone able to copy an envelope can replay or
reassociate it where writes are accepted. Also, the RSA public key is deliberately
public: anyone can create a new correctly encrypted envelope. Successful decryption
is therefore **not** proof of a genuine clinician/device or accurate patient data.
No method for an unauthorised remote caller to read existing ciphertext was found.

**Mitigation options:** Version the envelope and bind immutable record identifiers
and context as AAD; verify that binding on decrypt. Enforce unique IDs and replay
policy. Treat origin authentication separately with a threat-appropriate mechanism;
AAD alone does not stop a caller constructing their own envelope.

**Difficulty:** **Moderate–Hard**: both server and offline client must agree on the
format, and legacy records require explicit compatibility/migration.

### S14 — Avoidable dependency and installation supply-chain exposure

**Hazard / rating:** **Medium**; package installation can execute with build/CI
privileges even when vulnerable package APIs are unused by the running service.

**Evidence:** `package.json` includes `sqlite3` and `mysql`, but application database
modules use `mysql2/promise`. `sqlite3` brings native-install/archive tooling such as
`tar` and `tar-fs`; the scan reports multiple traversal/overwrite advisories.
Other locked dependencies also have advisories (see appendix).
No malicious installed package or actual compromise was established.

**Mitigation options:** Confirm and remove unused direct dependencies, update the
remaining parent packages, use reviewed lockfile changes and reproducible `npm ci`,
and keep build jobs isolated from production credentials. Assess lifecycle scripts
before blanket disabling them, since native builds may depend on them. Verify
package origin, publisher and provenance when accepting AI-generated suggestions.

**Difficulty:** **Moderate**, including clean-install and deployment compatibility tests.

### S15 — Production runtime/transport hardening is not established

**Hazard / rating:** **High runtime maintenance risk, confirmed**: production
runs Node v20.20.2, which is EOL. Network exposure, tenant isolation, transport
and vendor patching remain deployment-dependent.

**Evidence:** `.replit:1` selects Node 20, which the current official release table
marks EOL; the operator independently confirmed production v20.20.2. [R4]
No specific exploitable Node runtime CVE was demonstrated in this review;
the confirmed problem is the end of normal upstream security maintenance.
Production is Kualo shared hosting with Apache/cPanel; the app expects external
TLS termination and its MySQL
connections use `host: "localhost"` with no explicit TLS/socket configuration.

The dependency scan flags a `mysql2` auth-plugin downgrade requiring a rogue
server/MITM, not an arbitrary Internet HTTP caller. Localhost reduces network
exposure but does not prove isolation from local hostile processes.
The scanner reports a fix in 3.22.0 while the maintainer advisory fetched during
review still says “Patched versions: None”; verify release/changelog status before
selecting an upgrade target. [R5]

**Mitigation options:** Confirm supported Node/OS/MySQL versions and timely security
updates, including upstream security releases. Move production and development
to a supported Node LTS supported by the host, regression-test the native/dependency
chain and agree future runtime updates. If the host claims extended Node 20
security maintenance, obtain explicit coverage and expiry rather than assuming it.
Restrict host/database ports and
run the service as a non-root account. Require HTTPS at the edge, reject or redirect
HTTP appropriately, review HSTS there, and verify trusted internal transport.
Use a controlled Unix socket or verified TLS where suitable for the database.
Set request/header/idle timeouts and resource limits. Lack of `helmet` alone is not
proof of a critical flaw; the relevant headers may already be set at the proxy.

**Difficulty:** **Moderate**, potentially higher if hosting is end-of-life.

### S16 — Retention and secondary copies can defeat data minimisation

**Hazard / rating:** **Medium–High, conditional** on stored content and access.

**Evidence:** `modules/insertData.js:72–122` stores IP, project, user agent and
timestamps outside the encrypted patient payload. `:176–180` stores feedback in
plaintext. Free-text feedback may contain patient details despite its intended
purpose. `wiki.md` acknowledges no application-layer automated retention.
Decrypted tables, email and logs create additional copies (S06/S11).

**Mitigation options:** Establish approved retention/access rules for each data
category, redact/minimise metadata where possible, warn against identifying
free-text feedback, and encrypt/restrict backups and exports. Include log and mail
stores in deletion/access policies. Set recovery objectives and test restores
without exposing plaintext to development or AI tools.
With a single operator, also verify MFA/account recovery and documented
break-glass/recovery arrangements, without unnecessarily granting routine access
to additional people.

**Difficulty:** **Moderate–Hard**, because ownership, operational need and clinical/
data-protection approval are required. No unauthorised deletion is recommended.

### S17 — AI workflow prompt injection, package hallucinations and faster attacks

**Hazard / rating:** **Medium–High, conditional** on agent privileges and which
untrusted material developers or downstream tools process.

**Evidence / applicability:** No LLM runtime integration was found in the API.
Therefore an HTTP prompt-injection vulnerability in this service was **not**
established. However, this project is developed with AI assistance and accepts
untrusted feedback/log inputs.

GitHub Security Lab documents agent prompt injection through external issue/tool
content leading to token/file disclosure or code execution in vulnerable tooling.
This is evidence of the attack class, not a claim that this environment has those
specific already-addressed tool vulnerabilities. [R6] USENIX Security 2025 research
demonstrates hallucinated package recommendations as an attacker-controlled
package-confusion opportunity (“slopsquatting”). [R7]

If feedback, issue text, logs or repository files are later fed to a privileged
agent, embedded instructions can become a new trust-boundary crossing.
Separately, NCSC assesses AI as increasing the speed/scale of familiar intrusion
methods and vulnerability research; it is a reason to shorten patch latency,
not to invent an LLM endpoint in the threat model. [R8]

**Mitigation options:** Treat source/tool content as data, not authority; require
approval for package installation, secrets access, outbound transfers and
privileged actions. Keep agent environments free of production keys/data and
restrict network/tool permissions. Review new dependencies by verified identity,
not a plausible name. Enforce branch protection and required human review through
GitHub permissions; a written “do not push main” instruction alone is not a
technical control. Preserve the user's final AI-free PR review.

**Difficulty:** **Moderate** for tool/permission/policy controls, **Hard** where
production workflows depend on broadly privileged automation.

### S18 — Plan key lifecycle and long-term encryption migration

**Hazard / rating:** **Low near-term**, potentially **Medium** for records that must
remain confidential for many years.

**Evidence:** Envelopes use RSA-OAEP and AES-256-GCM without a key identifier or
algorithm version (`modules/encrypt.js:64–67`). Rotation/recovery/rewrapping is
not implemented here. Losing the private key makes historical data unrecoverable;
its theft enables decryption of copied historical envelopes.

AI does **not** currently establish a practical break of AES-256 or correctly
implemented RSA-OAEP. Quantum “harvest now, decrypt later” is a separate long-term
risk to RSA-wrapped keys, not an observed attack on this deployment. NIST has
finalised post-quantum standards; migration planning should follow data lifetime
and approved cryptographic guidance, not an improvised algorithm substitution. [R9]

**Mitigation options:** Define key ownership, secure backups, recovery drills,
rotation and per-envelope key IDs/versioning. Establish whether long-term records
justify a vetted post-quantum/hybrid migration plan covering the offline client
and existing stored data. Prioritise S01–S07 over an emergency bespoke crypto rewrite.

**Difficulty:** **Moderate** for lifecycle/version design; **Hard** for a complete
cross-client historical-data migration.

## Dependency triage: important qualifications

| Locked component | Scanner result / relevant condition | Recommended handling |
| --- | --- | --- |
| `body-parser` 1.20.2 | High recent compressed-body crash; applies to configured parser unless edge eliminates that input | Prioritise S01; update every installed copy |
| `proxy-addr` 2.0.7 | Critical upstream severity for particular IPv6 trust-subnet configurations | Patch, but specific advisory prerequisites are not shown by current numeric trust setting; see S07 |
| `express` 4.19.2 and `path-to-regexp` 0.1.7 | Redirect XSS / route-pattern ReDoS advisories | Current route strings have no multi-parameter patterns and root uses a fixed-config HTML link, not `res.redirect`; no matching exploit established; update parent |
| `mysql2` 3.11.0 | High rogue-server auth downgrade; moderate compression issue | Verify server trust/transport; compression is not explicitly enabled here; reconcile advisory/fix-version discrepancy before upgrade |
| `nodemailer` 6.10.0 | Multiple parser, raw-content, transport and address advisories | Current recipient/host are fixed configuration, no caller-supplied raw mail/attachments/options seen; don't label all as remotely reachable; update with major-version compatibility tests |
| `ip-address` 10.2.0 / 9.0.5 | Multiple classification, diagnostic and parser advisories | Update parents (`express-rate-limit` and transitive tooling); verify actual untrusted-input paths, not generic SSRF claims |
| `validator` 13.12.0 | URL-validation and Unicode-length advisories | Reviewed validation does not use `isURL()` or `isLength()`; no corresponding exploit established; update `express-validator` dependency chain |
| `lodash` 4.17.21 | Template imports injection / selected mutation-function pollution | No reviewed request path invokes those APIs; no confirmed global prototype pollution; update parent packages |
| `qs`, `cookie`, `send`, `serve-static` | Additional parsing/serialization/XSS advisories | No cookies/static serving configured; query parsing still exists; assess each feature and update Express chain |
| `tar` 6.2.1, `tar-fs` 2.1.1, `minimatch` 3.1.2, `brace-expansion` 1.1.11, `@tootallnate/once` 1.1.2 | Archive/path/complexity/control-flow advisories, mostly transitive/install tooling here | Remove unused dependency roots after verification; otherwise update parents and secure installation environment |

This table groups all audited package names rather than reproducing dozens of
overlapping advisory descriptions. No `npm audit fix --force`, package installation
or major-version migration was performed. Exact upgrade targets must be checked
against current maintainer releases and retested at remediation time.

## Existing protections and non-findings

- Parameterised MySQL values are used in reviewed queries; table identifiers are
  from local configuration, not request input. No direct SQL injection was found.
- AES keys and IVs are generated with `crypto.randomBytes`; AES-GCM checks integrity
  and RSA-OAEP uses SHA-256. No static AES key or IV reuse pattern was found.
- Decryption fails closed when its shared secret is absent/wrong; the private key
  is optional and checked before importing the decryption module.
- `/usage` exposes counts and rule descriptions, not patient fields, IPs or project
  values. Fine-grained future reports would need a fresh privacy assessment.
- JSON body size is configured as `100kb`. This is useful, but not a remedy for
  parser bugs or expensive operations on small requests.
- CORS restricts allowed browser response access; it is not authentication and
  does not prevent scripts/non-browser clients from sending API requests.
- Public clinical endpoints without a browser session are not automatically a
  conventional authenticated-CSRF vulnerability. Request abuse still matters.
- No confirmed arbitrary command execution, runtime LLM prompt injection or
  process-wide prototype pollution was established in reviewed application paths.
- Short audit IDs are references, not secrets or authorisation tokens.

## Deployment questions needed to finalise conditional ratings

Please answer without sharing secrets, key material or credential-bearing URLs.

Already answered: Kualo shared hosting, initial Apache/cPanel/database version
strings, Node v20.20.2, offline production RSA private key and single-operator
access. Do not request passwords, keys or an unredacted environment dump.

1. **Ingress:** Apache-to-Node integration (for example Passenger, if used),
   CDN/WAF and exact reverse-proxy chain; is the Node port
   reachable directly, are there different-length paths, and which proxy overwrites
   or appends forwarding headers? Are compressed request bodies forwarded?
2. **Runtime:** Supported Node upgrade options and vendor OS/MySQL security
   maintenance/update process; number of
   workers/instances; restart policy, memory/CPU limits and Node rejection flags?
   Does deployment use this lockfile through `npm ci`?
3. **Decryption:** Given the key is offline, has `tbl_decrypt` ever contained
   plaintext, and how is offline decryption performed? How are keys backed up,
   rotated and separated from development/agent tooling? If web decryption is
   enabled later, which network/operator restrictions will apply?
4. **Database:** Actual table-specific grants for the SELECT and INSERT users,
   network/socket arrangement, connection limits/timeouts, uniqueness/foreign-key
   constraints, existing row count and anticipated growth?
5. **Data copies:** Given single-operator access, what are account/MFA, host-support
   access, encryption, retention, deletion, restore and monitoring arrangements
   for `tbl_decrypt`, feedback, logs, mail and backups?
6. **Development controls:** Branch protection, CI/security/update checks, agent
   permissions and whether user feedback/logs/issues are processed by AI tools?

## Suggested remediation order — not implementation approval

1. **Immediate patch/reliability work:** S01 parser chain, S02 connection leak,
   S04 caught alert delivery and S15 supported Node migration. S05 before any
   future decryption enablement.
2. **Confirm exposure:** S06/S07/S15 production access, proxy trust, runtime and
   database grants. Interim decryption/encoding restrictions require operator approval.
3. **Input/data integrity:** S03/S10/S12 strict contracts, replay policy and
   clinical-compatible regression tests.
4. **Resource/privacy controls:** S08/S09/S11/S16 bounded work, reporting cache,
   redaction, retention and backups.
5. **Ongoing lifecycle:** S13/S14/S17/S18 versioned envelopes, dependency
   maintenance, AI tooling controls and key migration planning.

Use a feature branch, perform staging tests without production patient data,
and leave the final PR review and merge to the user. This report does not authorise
behaviour changes, new authentication requirements or data deletion.

## Sources

Sources checked on 6 November 2026. Advisory statements describe upstream
prerequisites; local applicability is assessed separately above.

- **R1:** [body-parser advisory GHSA-27r3-jxmh-p828](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828), published 22 October 2026; compressed-body crash, affected and patched versions.
- **R2:** [Express behind proxies](https://expressjs.com/en/guide/behind-proxies.html), official guidance on numeric trust and multiple ingress paths.
- **R3:** [proxy-addr advisory GHSA-jqcg-44mw-7w3h](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h), published 15 September 2026; IPv4-mapped IPv6 trust-subnet prerequisites.
- **R4:** [Node.js release lifecycle](https://nodejs.org/en/about/previous-releases), official current/EOL status.
- **R5:** [mysql2 advisory GHSA-3f6p-5ww8-9rcr](https://github.com/sidorares/node-mysql2/security/advisories/GHSA-3f6p-5ww8-9rcr), published 19 July 2026; rogue-server authentication downgrade.
- **R6:** [GitHub Security Lab: Safeguarding VS Code against prompt injections](https://github.blog/security/vulnerability-research/safeguarding-vs-code-against-prompt-injections/), published 25 August 2025, updated 6 July 2026; research on external-content injection and privileged agent tools.
- **R7:** [USENIX Security 2025: We Have a Package for You!](https://www.usenix.org/conference/usenixsecurity25/presentation/spracklen), primary research on code-generating LLM package hallucinations.
- **R8:** [NCSC: Impact of AI on cyber threat from now to 2027](https://www.ncsc.gov.uk/report/impact-ai-cyber-threat-now-2027), assessment of AI-enabled vulnerability research, exploitation and patch urgency.
- **R9:** [NIST finalised post-quantum standards](https://www.nist.gov/news-events/news/2024/08/nist-releases-first-3-finalized-post-quantum-encryption-standards), 13 August 2024; long-term cryptographic migration context.
