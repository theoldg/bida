# Implementation status

*For: an agent starting a cold session. The state of the project in one screen,
and the next thing to do. Everything here is a pointer — the doc that owns a
subject describes it, and this file says only where the project stands against
it. Update it in the same commit as the code it describes.*

## Where it stands

**Every phase is closed** (2026-09-05). The MVP shipped, then eight more phases
did; scanning was the last feature in. What is not built was cut rather than
queued — receipt photo storage, CSV export and categories are seams in
[product.md](product.md#deliberately-not-in-the-mvp), not work in progress.
[roadmap.md](roadmap.md) has the phase-by-phase record.

**Live** at <https://hajsik.hajsik-api.workers.dev> — one Worker serving the
static export *and* the sync API, backed by the `hajsik` D1 database
([hosting.md](hosting.md)). Verified against production, not just locally:
idempotent push, pull, a wrong secret refused, and a real group synced between
two devices.

## The next action

**Nothing is scheduled.** The last open subject — invariants the UI checks at
write time that a merge can break anyway ([invariants.md](invariants.md)) — is
closed. What follows is what closed it, newest last; one measurement is owed.

**The enforcement layer is built.** `core/invariants.ts` holds each invariant's
detector and its repair in one declaration that cannot omit the repair, the two
healers the app needs are registered against it, and two test layers hold them:
one registry-driven, one that asserts the properties naming no healer at all.
Every refusal in the UI now reads its verdict from that registry. See
[Enforcement](invariants.md#enforcement).

**The whole-entity merge is built.** An expense or transfer op now carries the
entity as its saver saw it and the highest HLC wins all of it, so an amount can
no longer sit beside a split from another phone that does not sum to it —
[ADR-0002](decisions/0002-append-only-op-log.md). Its two amendments hold the
repairs up: `deletedAt` merges per field, and `createdAt` is write-once in the
fold. History diffs two folds rather than reading the patch, and a revision that
moved several fields lists all of them rather than being captioned as one.

**Healing runs on the sync path.** `syncGroup` heals right after it rebuilds
from a pull, because a merge is the only thing that can make the state illegal
— every local write is refused before it lands. A phone whose member the merge
removed puts them back there too, signed as the person restored
(`restoreClaimDrafts`); forgetting the group is the exit.

**A member is their name.** `memberIdFor(groupId, name)` keys the member by
`nameKey`, now that renaming is gone, so two phones adding "Ana" offline mint
one member rather than two — [ADR-0034](decisions/0034-a-member-is-their-name.md).
Groups that predate it keep `newId()` members and the gap that comes with them.

One measurement is owed: whole-entity ops repeat every field, so the log grows
faster than it did, and that wants a number from a real group rather than an
argument.

A session with no assignment should take that measurement, not start a feature
the owner cut.

## What a cold session needs to know

The app is a shared-expense ledger with no accounts: a group is a secret link,
every change is an appended op, and money is integer minor units. The five
non-negotiables in [CLAUDE.md](../CLAUDE.md#non-negotiables) are the ones worth
reading twice; past that, go to the doc for your task —
[docs/README.md](README.md) is the index.

Three things surprise people who assume otherwise, so they are worth naming
here before you read anything:

- **What a foreign amount is worth belongs to the group, not the entry.** One
  rate per currency, synced as an op; `atCurrentRates` values the whole ledger
  in one pass where state is read, so correcting a rate moves every entry
  already written in that currency ([ADR-0005](decisions/0005-money-and-currency.md)).
- **An entry is merged whole, a member or rate per field.** An expense op
  carries the entity as its saver saw it, so an amount can never sit beside
  another phone's split; `deletedAt` and `createdAt` are the exceptions that
  keep the healers working ([sync.md](sync.md#the-operation)).
- **History is read, never rewound.** The `restore` op kind still folds only
  because production groups hold some
  ([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md)).
