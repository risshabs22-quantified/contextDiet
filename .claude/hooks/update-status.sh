#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# ContextDiet — Stop hook.
# Fires when Claude Code finishes a turn. Appends a timestamped checkpoint into
# the AUTO-LOG block of PROJECT_STATUS.md so the memory ledger records activity
# even if a session ends abruptly.
#
# IMPORTANT (honest scope): a shell hook cannot author prose. It only stamps the
# machine-managed AUTO-LOG block. The curated sections (Architecture, ADL,
# Checklist, Metrics) are updated by Claude as a convention at the end of each
# major task — the hook is the safety net, not the author.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
STATUS="$ROOT/PROJECT_STATUS.md"
END_MARKER="<!-- AUTO-LOG:END -->"

# Nothing to do if the ledger or its managed block is missing.
[ -f "$STATUS" ] || exit 0
grep -q "$END_MARKER" "$STATUS" || exit 0

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TMP="$(mktemp)"

# Insert a checkpoint line immediately before the END marker (first match only).
awk -v ts="$TS" -v marker="$END_MARKER" '
  index($0, marker) && !done { print "- " ts " — session checkpoint recorded"; done = 1 }
  { print }
' "$STATUS" > "$TMP" && mv "$TMP" "$STATUS"

exit 0
