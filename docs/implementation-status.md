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

**[bugs.md](../bugs.md)** — the defect queue, and the only open work. Two items,
both of which put a wrong number in front of a person:

- Two members added under one name can't be merged. This is the one with
  teeth: merging two ids inside a `split` or `payers` map has to **add** their
  amounts, not overwrite, or the entry stops summing to its total.
- A departed member's balance can't be cleared. Small, but it needs a product
  call before it needs code.

Nothing else is scheduled. A session with no assignment should take the top of
that file, or improve what is there — not start a feature the owner has cut.

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
- **An edit writes only what the edit changed.** The form posts every field and
  the command layer diffs them, so two phones editing different fields of one
  expense offline both keep their change
  ([sync.md](sync.md#the-operation)).
- **History is read, never rewound.** The `restore` op kind still folds only
  because production groups hold some
  ([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md)).
