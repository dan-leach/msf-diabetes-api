---
name: Usage reporting scope
description: User-confirmed scope and grouping for aggregate episode usage estimates.
---

Report total records and test/real counts, but apply episode estimation only to
real cases. Compare real episodes with the same client IP and project.

**Why:** The user stated that test counts should be reported once and only real
cases matter after that; they confirmed client IP and project as the comparison.

**How to apply:** Keep test episodes out of deduplication. Use serverDatetime
for online episodes and offlineTimestamp for offline episodes, and exclude
records within an hour of a counted episode rather than extending the window
from skipped records. Leave aggregate reporting unauthenticated as requested.

Use UTC calendar months for monthly episode reporting, rather than the Node
host's local timezone.

**Why:** The API serves multiple projects, and reporting boundaries should not
change when the hosting timezone changes. No project-specific reporting
timezone has been requested.

**How to apply:** Keep UTC as the default unless the user specifies a different
reporting calendar; explain the timezone when presenting monthly figures.
