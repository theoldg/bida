#!/bin/sh
# Point this session's branch at `dev`, wherever the harness dropped it.
#
# Sessions work in a worktree of their own (CLAUDE.md), so there are two shapes
# to settle and this script handles whichever it finds:
#
# **In a worktree** — the branch is the worktree's own, and it stays that way:
# `dev` is checked out in the main clone, and git refuses to have one branch in
# two working trees. What it needs instead is a base and an upstream, both
# `origin/dev`: the harness branches a new worktree from `origin/main` or from
# whatever the main clone's HEAD happened to be, neither of which is what a push
# lands on. Fast-forwarding to `origin/dev` first is what makes `pnpm bump`
# honest and the push a fast-forward. Because the branch is not named `dev`,
# the push has to say where it goes: **`git push origin HEAD:dev`**.
#
# **In the main clone** — the owner's own checkout, and an agent that skipped
# the worktree. Move to `dev` and carry over any commits already made on the
# assigned branch. `main` is a release pointer the owner fast-forwards by hand;
# nothing is ever committed to it, so being *on* main is also a branch to leave,
# and commits found there were a mistake — carried onto `dev`, then rewound off
# main, so the pointer goes on meaning "what production is serving".
#
# Safe to re-run, in either shape. Commits already made are carried over, never
# discarded.
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
