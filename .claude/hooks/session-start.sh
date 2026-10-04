#!/bin/bash
# `pnpm session`, run for the agent before its first turn in a cloud session.
# What this prints lands in the agent's context: the session's state, and —
# when the CLAUDE.md the harness loaded is behind `dev`'s — the current one,
# since the loaded copy can be days old and nothing else can replace it.
set -uo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
# Only a fresh start: a resume or a compaction is the same session, which has
# already claimed the clone and would now find it busy with its own claim.
grep -q '"source" *: *"startup"' || exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
start=$(git rev-parse HEAD 2>/dev/null)

echo "Startup hook: \`pnpm session\` has run (.claude/hooks/session-start.sh)."
if ! pnpm install --reporter=silent >/dev/null 2>&1; then
  echo "pnpm install failed — run \`pnpm session\` yourself and read why."
fi
sh scripts/on-dev.sh 2>&1
status=$?
[ "$status" -eq 3 ] && echo "The main clone is busy: take a worktree as above and run \`pnpm session\` there."
[ "$status" -ne 0 ] && [ "$status" -ne 3 ] && echo "on-dev.sh exited $status — read the lines above before doing anything else."

if [ -n "$start" ] && ! git diff --quiet "$start" origin/dev -- CLAUDE.md 2>/dev/null; then
  echo
  echo "The CLAUDE.md loaded into this session is out of date. This is dev's, and it wins:"
  echo
  git show origin/dev:CLAUDE.md
fi
exit 0
