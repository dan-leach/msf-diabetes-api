---
name: Replit import migration/revert artifacts
description: How to correctly find leftover changes from the automated SQLite-migration + revert that Replit runs on import of a MySQL/Postgres app
---

# Replit import migration/revert artifacts

When a MySQL/Postgres app is imported into Replit "for review only", the platform
may auto-create a commit that converts the DB layer to SQLite ("Update backend API
to use SQLite database..."), then a later "Revert database changes..." commit. The
revert is frequently **incomplete** and silently leaves regressions.

## The rule
To find the true leftover artifacts, diff the migration commit's **actual parent**
against the **revert commit** — not a sibling branch or an arbitrary earlier commit.

```
git rev-list --parents -n 1 <migration_sha>   # last sha printed = real parent
git diff <migration_parent> <revert_sha> --stat
```

**Why:** the migration is often based on a different point than the latest feature
commit on the working branch (branches diverge). Diffing against the wrong baseline
(e.g. a sibling feature commit) produces a huge misleading diff full of unrelated
feature differences. The migration-parent → revert diff is the *only* comparison
that isolates what the revert failed to restore. If the revert were perfect this
diff would be empty.

## What the incomplete revert tends to leave behind
- DB connection config rewritten to reference a config path that doesn't exist
  (e.g. `config.api.database.users.select` when `config.api.database` has no
  `users` key) — crashes at runtime with TypeError. Original used env vars like
  `process.env.app_select_user`. **Verify the config path resolves** with a quick
  `node -e` before trusting it.
- One module reverted further back than the others (to the original upstream import
  state) while siblings keep the migration's version — leaves the modules
  inconsistent with each other. Cross-check all sibling modules.
- **Reduced DB INSERT schema**: migration regenerated an insert from an older
  template, dropping columns the rest of the data model still expects (validation
  rules + docs reference them). This is the easiest regression to miss and it
  cascades into any docs you write from the current (broken) code.

## How to apply
After fixing, sweep for the broken identifiers across `*.js` AND any docs you
authored, and run `node --check` on every module. Docs written from post-migration
code inherit the artifacts (e.g. a README column table listing the wrong columns) —
fix those too.
