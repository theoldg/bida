# Bugs

*A punch list from a UX pass over the whole app, 2026-09-04. Triaged with the
owner; items they judged working-as-intended are already gone from it.*

Ordered by what it costs to leave alone. Each item says where it is and what to
do, not just what is wrong. Delete an item when it is done — this file is a
queue, not a record.

---

## 1. Crashes the screen

### 1.1 One throw anywhere is a white screen with nothing to press

There is no `error.tsx` or `global-error.tsx` anywhere under `apps/web/app/`,
so any throw during render unmounts the tree, and the service worker serves the
shell cache-first. The two throws that got here this way are fixed — a scanned
currency symbol and an out-of-range conversion, both in the entry form — but
the class isn't: `formatMinor` and `parseMinor` throw by design and are called
all over every screen.

**Do:** a route-level `error.tsx` and a `global-error.tsx` that say something
and offer the way out (reload, and back to the group list). Needs a copy
decision, so it is here rather than done.

---

## 2. Money recorded wrong, silently

### 2.1 Fetch real exchange rates; never present `1` as if it were one

Today `blankDraft` sets `rateToBase: "1"` and the currency picker keeps
whatever the draft had: `patch({ currency, rateToBase: currency === base ? "1"
: draft.rateToBase })`. Pick MAD in a EUR group and the rate stays `"1"`,
`isValidRate("1")` passes, Save lights up, and a 500 MAD dinner is banked as
€500. A scan makes it worse — it writes the scanned currency and keeps the old
rate, so a photographed Moroccan receipt arrives looking complete and wrong.

Slightly stale rates are fine. Shape to build:

- **A Worker endpoint**, `GET /api/rates?base=XXX`, alongside the existing
  Gemini passthrough in `apps/api/src/index.ts`. Same reasoning as
  [ADR-0003](docs/decisions/0003-link-only-access.md)'s key handling: one
  server-side cache for everyone, no key in the client if the source ever needs
  one, and no CORS or service-worker fight. Cache hard — daily is plenty.
- **A source with no API key and broad coverage.** ECB-backed feeds are free
  and clean but miss MAD, UZS and others that
  `apps/web/lib/currencies.ts` already offers; check coverage against
  `COMMON_CURRENCIES` before committing to one. This is a new runtime
  dependency on a third party, so it likely wants an
  [ADR](docs/decisions/README.md) — read that file's bar first.
- **Decimal strings, never floats.** `Rate` is an exact decimal string and
  `isValidRate` is `/^\d+(\.\d+)?$/`. Convert whatever the feed returns to a
  string without going through arithmetic, and round to a fixed number of
  places at the edge.
- **Cache locally** (a small Dexie table) so an offline phone can still prefill
  yesterday's number.
- **Nothing changes about storage.** [ADR-0005](docs/decisions/0005-money-and-currency.md)
  still holds: the rate is frozen onto the entry at save. This only prefills
  the field, which stays editable.
- **When there is no rate to be had** — offline, unknown currency, feed down —
  do *not* fall back to `1`. Leave the field empty and let the existing
  invalid-rate path block Save, so the person types the rate rather than
  unknowingly accepting a wrong one. Say which it is: fetched, cached from a
  date, or yours.

---

## 5. Sync and multi-device

### 5.2 Two members with one name should be mergeable

`apps/web/lib/names.ts` argues correctly that two "Ana"s are two people nothing
on screen tells apart — then `nameTaken` only checks the local list. Two people
adding "Ana" offline both sync, and you get exactly the failure the file exists
to prevent, with no repair path: rename is blocked by the same check.

**Do:** merge them into one member. Sketch, and it wants thinking through
before it is written:

- Detect the collision by `nameKey` over live members and offer the merge where
  it is visible — the People screen.
- The merge is ops, not a mutation: rewrite the loser's references (`paidBy`,
  `payers` keys, `split` participants, `fromMember`/`toMember`,
  `receiptInvolved`/`receiptAssignments`, `identities`) onto the winner and
  tombstone the loser. Each is an ordinary `update`, so history keeps a record
  and other devices converge.
- Watch the arithmetic: two ids merging inside one `split` or `payers` map must
  have their amounts **added**, not overwritten, or the entry stops summing to
  its total. This is the part with teeth — cover it in tests before shipping
  it, per the coverage rule in [CLAUDE.md](CLAUDE.md).
- A device that claimed the loser has to follow to the winner.

### 5.3 Anyone who learns a group id before its creator syncs can steal it

`ensureGroup` registers a group id on first push and stores `sha256(secret)`
from *that* request. A group id known before its creator has ever synced can be
claimed with somebody else's secret, and the real owner is 403'd permanently
with no way back. Noticed while fixing the 403 copy, which is why it is small
here and not in section 5's original list — it needs a think about what
registration should actually be keyed on.

---

## 6. Smaller, all real

- **History stamps are wall clock while ordering is HLC.**
  `stamp(rev.op.createdAt)` sorted by `compareHlc`, so on any skewed device the
  timeline shows times out of order. Less alarming once 5.1 lands, still worth
  a note in the UI or a switch to something monotonic.
- **The scan asks for a category and throws it away.** `normalizeScan` returns
  `patch.category`; the form never reads it, and `scanReceipt(…, [])` always
  passes an empty category list. Either wire it up or stop asking — it is
  prompt tokens and a promise, for nothing.
- **No throttle on `/api/groups/:id/scan`.** Anyone holding a group link
  proxies straight to Gemini on the shared key. `copy.scan.freeTier` implies a
  budget that nothing defends.

---

## Needs more thought before it becomes a task

**Discount and zero lines are counted two different ways.**
`receiptTotalMinor` adds every parseable line, negatives included;
`weightsFromItems` skips anything `<= 0`. So a discount shrinks the bill's
total but takes no part in the ratios — which means it is spread across
everybody in proportion to what they ordered, rather than landing on whoever
the discount was actually for.

That may well be the right answer: a "-5.00 loyalty card" on a restaurant bill
probably *should* be shared. But a voucher against one person's dish should
not, and today the grid gives no way to say which. So `checkScan` refuses a
receipt with a credit line outright — nothing is mispriced, and nothing is
importable either. Deciding what a negative line means on the grid — including
whether it is assignable to people, like any other line — is what unblocks it.
