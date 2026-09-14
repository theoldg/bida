#!/bin/sh
# `pnpm release` — make production whatever `dev` is at, from a laptop.
#
# The same act as github.com → Actions → "Release dev to main"
# (.github/workflows/release.yml), for when you'd rather not open GitHub. It is
# the owner's (docs/standing-instructions.md#workflow); nothing else moves
# `main`.
#
# The whole release is one push: `origin/dev` onto `main`, refspec, no `--force`.
# A plain push is refused unless it fast-forwards, which is the same rail the
# workflow's `--ff-only` is — it fails, loudly and without moving anything, if
# `main` holds a commit `dev` does not. That can only happen if someone
# committed straight to `main`, and the fix is `git merge main` from `dev` once.
#
# Pushing a *remote* ref means nothing is checked out and the working tree is
# never touched, so uncommitted work is none of this script's business. What is
# released is exactly what `origin/dev` holds — what the dev Worker has been
# serving — so local commits that were never pushed are not in it, and the
# script says so rather than quietly shipping without them.
#
# That push is made with your credentials, so it triggers deploy.yml the
# ordinary way (`on: push: branches: [main, dev]`) and production deploys
# itself. The workflow has to ask for the deploy by hand only because its own
# push uses GITHUB_TOKEN, which deliberately triggers nothing.
set -e

yes=
case "$1" in
  -y|--yes) yes=1 ;;
  "") ;;
  *) echo "usage: pnpm release [--yes]" >&2; exit 1 ;;
esac

git fetch origin --quiet

for branch in dev main; do
  if ! git show-ref --quiet "refs/remotes/origin/$branch"; then
    echo "origin/$branch does not exist (docs/hosting.md#dev-and-production)" >&2
    exit 1
  fi
done

# The push below would refuse this anyway, but it is worth naming before the
# confirmation rather than after: `main` holding something `dev` does not is a
# commit made straight to main, and nothing here can fix it.
if [ -n "$(git rev-list origin/dev..origin/main)" ]; then
  echo "origin/main holds commits origin/dev does not — a commit went straight to main:" >&2
  git log --oneline --no-decorate origin/dev..origin/main >&2
  echo "fix it from dev with \`git merge main\`, push, then release again" >&2
  exit 1
fi

if [ -z "$(git rev-list origin/main..origin/dev)" ]; then
  echo "nothing to release — production is already at origin/dev"
  exit 0
fi

# Unpushed local commits are not a reason to stop: releasing origin/dev is still
# a correct release. But it won't contain them, and that is worth knowing before
# you conclude the fix you just wrote is live.
if git show-ref --quiet refs/heads/dev &&
   [ -n "$(git rev-list origin/dev..dev 2>/dev/null)" ]; then
  echo "note: local dev has commits that are not on origin/dev; they are NOT in this release" >&2
  git log --oneline origin/dev..dev >&2
fi

echo "releasing to production:"
git log --oneline --no-decorate origin/main..origin/dev
echo

if [ -z "$yes" ]; then
  if [ ! -t 0 ]; then
    echo "not a terminal — re-run as \`pnpm release --yes\` if you mean it" >&2
    exit 1
  fi
  printf "push %s to main? [y/N] " "$(git rev-parse --short origin/dev)"
  read -r reply
  case "$reply" in
    y|Y|yes|Yes) ;;
    *) echo "nothing pushed"; exit 1 ;;
  esac
fi

# No --force, ever: the refusal is the safety story.
git push origin "$(git rev-parse origin/dev):refs/heads/main"

git fetch origin --quiet
# Keep a local `main`, if there is one, pointing where production is.
if git show-ref --quiet refs/heads/main &&
   [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] &&
   git merge-base --is-ancestor main origin/main; then
  git update-ref refs/heads/main origin/main
fi

echo
echo "released $(git rev-parse --short origin/main): $(git log -1 --pretty=%s origin/main)"
echo "deploy.yml is now building production — https://bida.bid"
echo "a pending migration is not part of it: run \`pnpm db:migrate\` by hand (docs/hosting.md#a-schema-change-from-here-on)"
