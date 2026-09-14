#!/bin/sh
# Put this session on `dev`, whatever branch the harness dropped you on.
#
# Agent harnesses assign a feature branch and then nag about "unpushed commits"
# on it, because it has no remote counterpart — this project pushes to `dev`
# (CLAUDE.md). Run this once at the start of a session, before you commit, and
# the nagging stops because there is nothing left to nag about.
#
# `main` is a release pointer the owner fast-forwards by hand; nothing is ever
# committed to it. So being *on* main is also a branch to leave — and commits
# found there were a mistake, carried onto `dev` and then rewound off main, so
# the pointer goes on meaning "what production is serving".
#
# Safe to re-run. Commits already made on the assigned branch are carried over,
# never discarded.
set -e

# Every question below is about ancestry, and a shallow clone cannot answer one:
# past the graft boundary a local `dev` that is merely behind looks exactly like
# a branch of unrelated work, so the safety check fires on a clone that is only
# truncated. Deepen first — the harness clones with `--depth`, and this repo's
# whole history is smaller than one `pnpm install`.
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  git fetch --unshallow origin --quiet 2>/dev/null || true
fi
git fetch origin --quiet
work=$(git rev-parse --abbrev-ref HEAD)

if ! git show-ref --quiet refs/remotes/origin/dev; then
  echo "origin/dev does not exist — create it before running this (docs/hosting.md#dev-and-production)" >&2
  exit 1
fi

if [ "$work" = "dev" ]; then
  git branch --set-upstream-to=origin/dev dev >/dev/null 2>&1 || true
  git merge --ff-only origin/dev --quiet 2>/dev/null || true
  echo "on dev, tracking origin/dev"
  exit 0
fi

# Local `dev` holding commits that are neither pushed nor on the branch we are
# leaving means two lines of unpushed work. Stop rather than pick one.
if git show-ref --quiet refs/heads/dev &&
   [ -n "$(git rev-list origin/dev..dev --not "$work" 2>/dev/null)" ]; then
  echo "local dev has commits that are not on origin/dev or $work — sort that out by hand" >&2
  if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
    echo "(the clone is still shallow, so those commits may just be history this" >&2
    echo " clone cannot see past; \`git fetch --unshallow\` and re-run before believing it)" >&2
  fi
  exit 1
fi

git checkout -B dev origin/dev --quiet
git merge --ff-only "$work" --quiet 2>/dev/null ||
  echo "note: $work has commits that don't fast-forward onto origin/dev; it is left in place" >&2

if [ "$work" = "main" ]; then
  # Whatever was on main is on dev now (or was already there). Put the pointer
  # back where production is, so a later `merge --ff-only dev` is the only way
  # main ever moves.
  if git merge-base --is-ancestor main dev 2>/dev/null; then
    git branch -f main origin/main
    echo "moved from main to dev; local main reset to origin/main"
  else
    echo "moved from main to dev; local main left alone — it holds commits dev does not" >&2
  fi
  exit 0
fi

git branch -d "$work" >/dev/null 2>&1 || true
echo "moved from $work to dev, tracking origin/dev"
