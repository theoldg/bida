#!/bin/sh
# Put this session on `main`, whatever branch the harness dropped you on.
#
# Agent harnesses assign a feature branch and then nag about "unpushed commits"
# on it, because it has no remote counterpart — this project pushes to `main`
# (CLAUDE.md). Run this once at the start of a session, before you commit, and
# the nagging stops because there is nothing left to nag about.
#
# Safe to re-run. Commits already made on the assigned branch are carried over,
# never discarded.
set -e

# Every question below is about ancestry, and a shallow clone cannot answer one:
# past the graft boundary a local `main` that is merely behind looks exactly like
# a branch of unrelated work, so the safety check fires on a clone that is only
# truncated. Deepen first — the harness clones with `--depth`, and this repo's
# whole history is smaller than one `pnpm install`.
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  git fetch --unshallow origin --quiet 2>/dev/null || true
fi
git fetch origin main --quiet
work=$(git rev-parse --abbrev-ref HEAD)

if [ "$work" = "main" ]; then
  git branch --set-upstream-to=origin/main main >/dev/null 2>&1 || true
  git merge --ff-only origin/main --quiet 2>/dev/null || true
  echo "on main, tracking origin/main"
  exit 0
fi

# Local `main` holding commits that are neither pushed nor on the branch we are
# leaving means two lines of unpushed work. Stop rather than pick one.
if git show-ref --quiet refs/heads/main &&
   [ -n "$(git rev-list origin/main..main --not "$work" 2>/dev/null)" ]; then
  echo "local main has commits that are not on origin/main or $work — sort that out by hand" >&2
  if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
    echo "(the clone is still shallow, so those commits may just be history this" >&2
    echo " clone cannot see past; \`git fetch --unshallow\` and re-run before believing it)" >&2
  fi
  exit 1
fi

git checkout -B main origin/main --quiet
git merge --ff-only "$work" --quiet 2>/dev/null ||
  echo "note: $work has commits that don't fast-forward onto origin/main; it is left in place" >&2
git branch -d "$work" >/dev/null 2>&1 || true
echo "moved from $work to main, tracking origin/main"
