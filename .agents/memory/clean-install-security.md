---
name: Clean-install security checks
description: Why cached or incremental package installs do not establish clean bootstrap success.
---

Validate dependency/bootstrap changes with a clean, lockfile-based installation
through the configured post-merge setup, not only an incremental package install.

**Why:** Existing/cached dependencies allowed an incremental update to succeed,
but clean installation was rejected by the environment's package-security
firewall for vulnerable transitive packages.

**How to apply:** Preserve the firewall; update compatible dependency chains or
remove verified-unused dependency roots. Do not treat successful incremental
installation or unit tests alone as proof that a fresh task merge can bootstrap.
