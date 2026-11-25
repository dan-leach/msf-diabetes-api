---
name: Production hosting and access context
description: Operator-reported production context relevant to deployment and security assessments.
---

The operator reports Kualo shared-IP Linux hosting with cPanel and
production Node v20.20.2. The RSA private key is not online in the current
production version. Access to data, logs and backups is currently single-operator.
The operator subsequently reported Node 26.13.1 is available in cPanel.
Availability is not confirmation that production has been switched to it.
The user confirmed that the RSA private key in the workspace's tracked
development configuration is a disposable test key, not the production key.
The supplied cPanel screenshot shows Node.js Selector, Production mode and
`index.js` as the startup file.
Kualo subsequently confirmed that LiteSpeed, not Apache with Phusion Passenger,
handles the application's .htaccess configuration and connection to Node.
Kualo confirmed direct inbound traffic with no CDN or external proxy, and no
separate public Node application port. MSF confirmed its role is DNS only.
The original domain went through Cloudflare; the user says the three-hop trust
setting was correct for that setup. Do not carry that topology forward.
Kualo has not verified the socket remote address, forwarding-header values or
header sanitisation presented to Express. These still require observation in
the running production app before choosing a replacement proxy-trust setting.

**Why:** The user supplied these facts during the security review; development
configuration alone does not establish production setup.

**How to apply:** Reconfirm time-sensitive runtime and access details before
deployment decisions. Do not treat web decryption as active while its private
key is offline. Shared hosting does not establish proxy hop count, database
grants, backup policy or the host's security patch coverage.

For the proxy-trust investigation, do not ask the support team for more help;
find any further information ourselves.

**Why:** The user said support has already provided a response and asked to
investigate ourselves.

**How to apply:** Gather controlled observations from the application rather
than proposing another support request.
