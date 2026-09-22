#!/bin/sh
# Point this session's branch at `dev`, wherever the harness dropped it.
#
# **In a worktree** the branch stays the worktree's own — `dev` is checked out
# in the main clone, and git won't lend a branch to two working trees. It gets
# `origin/dev` as base and upstream instead (the harness branches from
# elsewhere, which would leave `pnpm bump` comparing against the wrong tree).
# Push with `git push origin HEAD:dev`.
#
# **In the main clone**, move to `dev` and carry over any commits made on the
# assigned branch. `main` is a release pointer the owner fast-forwards by hand,
# so commits found on it are carried onto `dev` and rewound off `main`.
#
# Safe to re-run, either shape. Commits are carried over, never discarded.
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

# A linked worktree has its own gitdir inside the clone's shared one.
if [ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ]; then
  git branch --set-upstream-to=origin/dev "$work" >/dev/null 2>&1 || true
  if git merge --ff-only origin/dev --quiet 2>/dev/null; then
    :
  elif git merge-base --is-ancestor origin/dev HEAD; then
    : # already ahead of dev — this session's own commits, nothing to rebase.
  else
    echo "note: $work and origin/dev have both moved; rebase before pushing" >&2
  fi
  echo "worktree on $work, tracking origin/dev — push with: git push origin HEAD:dev"
  exit 0
fi

echo "note: not in a worktree — sessions get one of their own (CLAUDE.md)" >&2

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
