---
name: Production hosting and access context
description: Operator-reported production context relevant to deployment and security assessments.
---

The operator reports Kualo shared-IP Linux hosting with Apache/cPanel and
production Node v20.20.2. The RSA private key is not online in the current
production version. Access to data, logs and backups is currently single-operator.
The supplied cPanel screenshot shows Node.js Selector, Production mode and
`index.js` as the startup file. Kualo describes this setup as Passenger-based,
but the screenshot does not establish the full proxy chain.
The operator confirms no CDN is configured; hosting-managed internal proxies
remain unverified.

**Why:** The user supplied these facts during the security review; development
configuration alone does not establish production setup.

**How to apply:** Reconfirm time-sensitive runtime and access details before
deployment decisions. Do not treat web decryption as active while its private
key is offline. Shared hosting does not establish proxy hop count, database
grants, backup policy or the host's security patch coverage.
