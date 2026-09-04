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

- **A form held open across a peer's edit still loses that edit.** The command
  layer diffs the posted form against the entity *as of save*, so a whole-form
  save no longer clobbers a field it never touched. But a form opened before
  the peer's op arrived holds their old value and posts it as a deliberate
  change, which is per-field LWW working correctly on a lie. Either re-read the
  entity into the open form when sync brings a change, or say so.
- **A rate too large to convert at saves anyway, and re-values nothing.** The
  dialog takes `999999999999999999999`, promises "This re-values 1 entry
  already written in USD", and stores it. `repriceEntry` then throws inside
  `convertMinor` and deliberately keeps the stored figure, so the entry does not
  move: the rates screen shows a number the ledger is not using, with nothing
  saying so. The catch is right — losing the row would be worse. The dialog is
  what should refuse, on the same range `convertMinor` enforces.
- **Segmented controls don't announce which option is chosen.** Split mode,
  entry kind and the ledger/balances tabs mark selection with styling only; a
  screen reader reads four equal buttons. Wants `role="tab"`/`aria-selected`
  or `aria-pressed` on each.

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
