#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Reconcile dependencies exactly to the merged lockfile, non-interactively.
npm ci --no-audit --no-fund

# Tests use synthetic data and substitutes; no production database or mail.
npm test

# Production MySQL schema/data and credentials are deliberately untouched.
# The platform handles workflow reconciliation after this script completes.
