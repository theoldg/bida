# 0009 — Who you are is device-local, and so is its history

**Status:** Accepted · 2026-08-27

## Context

A group's members are shared facts, folded from ops like everything else. But
*which member is holding this phone* has never been one: it lives in the device
record's `meByGroup`, is written by `setMe`, and is what drives personal mode,
"You paid", and the settle-up screen's "you" pronouns.

The owner asked for two things at once: in-group options that include "changing
identity", and "a history log for changing identity". The second raises the
question the first doesn't: where does that log live, and who can see it?

The tempting answer is an op. The op log already carries history, already syncs,
already renders as a timeline on `/g/history` — an `identity` op would come with
all of that for free.

## Decision

**Identity, and the log of identity changes, stay device-local. Neither is ever
an op.**

A new Dexie table `identityLog` (`{ groupId, at, fromMember, toMember }`,
schema v2) is appended by `setMe` and rendered by `/g/options`. It never leaves
the phone, exactly like `meByGroup` and the group secret before it (ADR-0003).

## Why not an op

- **It is not a fact about the group.** "This phone now thinks it is Sam" tells
  the other members nothing about who owes what. It would be noise in a log
  whose entire value is that every line changed the ledger.
- **It would leak the shape of people's devices.** From a synced identity log
  anyone with the link could read how many devices a person uses, when they
  switched phones, and that Marie's phone briefly claimed to be Sam. There is no
  account system to make that legible or governable — see
  [ADR-0003](0003-link-only-access.md).
- **There is nothing to converge.** Two devices both claiming to be Sam is not a
  conflict, it is Tuesday. An op log exists to merge concurrent edits to shared
  state; identity has no shared state to merge.
- **Deleting it must be easy.** Clearing site data should erase who this phone
  said it was. If it were an op, it would already be on the server and on
  everyone else's phone, unretractable.

## Consequences

- The log does not survive a reinstall, and does not follow you to a new phone.
  That is correct: it is a log *of this phone*, and it says so on screen.
- `/g/history` and `/g/options` are two different timelines with two different
  scopes. The options screen's copy makes the distinction explicit rather than
  hoping people infer it.
- Re-claiming the member you already are is a no-op and is not logged, so the
  list stays a list of actual changes.
