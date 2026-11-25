---
name: Git review workflow
description: User's branch and final review requirements.
---

No pushes should go to main. Use a feature branch.

**Why:** The user wants to perform a final AI-free code review during the PR into main on GitHub.

**How to apply:** Push work to the working feature branch, not main; leave the final PR review to the user.

For the next round of changes after the v1.1 merge, create a new `v1.2`
branch from updated `main` and push it to the remote before making changes.

**Why:** The user specified `v1.2` for subsequent work after merging v1.1.

**How to apply:** Create and publish that branch when subsequent changes begin,
not in advance. Continue to leave the PR into main and final review to the user.

When finishing a version update, remind the user to:
- Update the version number in the cPanel Node environment variables.
- Confirm whether any updates are needed to the offline calculator in the client repo.
- Update the versioning in the client repo.

**Why:** The user asked for these reminders when finishing a version update.

**How to apply:** Include all three reminders when wrapping up a version update.

Git pane publishing succeeded after shell pushes failed authentication. Shell push authentication has not been confirmed fixed. An incorrect upstream was not present in this project's case.

**Why:** The user verified the published branch on GitHub, and fetching confirmed matching local and remote commits.

**How to apply:** If shell authentication fails again, inspect upstream settings and live remote branches rather than assuming a tracking issue. Use Git pane publishing, then fetch and verify the matching upstream.
