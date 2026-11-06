---
name: Production hosting and access context
description: Operator-reported production context relevant to deployment and security assessments.
---

The operator reports Kualo shared-IP Linux hosting with Apache/cPanel and
production Node v20.20.2. The RSA private key is not online in the current
production version. Access to data, logs and backups is currently single-operator.
The user confirmed that the RSA private key in the workspace's tracked
development configuration is a disposable test key, not the production key.
The supplied cPanel screenshot shows Node.js Selector, Production mode and
`index.js` as the startup file. Kualo describes this setup as Passenger-based,
but the screenshot does not establish the full proxy chain.
The operator has not configured a CDN for the current deployment. The original
domain went through Cloudflare; the user says the three-hop trust setting was
correct for that setup. The current diabetes.msf.net domain goes through MSF,
and the user does not know its proxy steps. Do not assume MSF only manages DNS
or that it adds an HTTP proxy; MSF/Kualo-managed routing remains unverified.

**Why:** The user supplied these facts during the security review; development
configuration alone does not establish production setup.

**How to apply:** Reconfirm time-sensitive runtime and access details before
deployment decisions. Do not treat web decryption as active while its private
key is offline. Shared hosting does not establish proxy hop count, database
grants, backup policy or the host's security patch coverage.
