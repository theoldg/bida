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

## 3. Dead ends — a disabled button and nothing saying why

### 3.1 The payers screen can strand the form

`apps/web/app/g/payers/page.tsx`'s `toggle` will delete every entry, leaving
`payers: {}`. `Done` disables correctly, but `TopBar back={true}` doesn't, so
you can leave anyway. Back on the form, `coPayers` is empty, so it renders the
*single-payer* branch — and `payerCheck.message` is only rendered inside the
`coPayers.length > 1` card. Save is grey with no text anywhere explaining it.
Same trap with one payer holding the wrong amount.

**Do, both halves:**

- **Leaving the payers screen by the back arrow or the device's back button
  should warn and discard**, the way the entry form already does. The machinery
  exists: `isDraftDirty`/`ConfirmDialog` in `entry/edit/page.tsx`, and
  `TopBar back={fn}` routes the hardware button through the same action
  (`apps/web/lib/back-button.ts`). Discarding means restoring the payer map the
  screen opened with, not clearing the whole draft.
- **Zero payers must be unsaveable and un-leavable as a state.** An empty map
  is not a half-finished edit, it is a nonsense one — either refuse the last
  removal, or treat `{}` as `null` (back to one payer) on the way out. Whatever
  the form ends up holding, Save must never be disabled with no visible reason:
  move the `payerCheck.message` render out of the `coPayers.length > 1` branch
  so it shows in both.

### 3.2 A scan that can't read the total must fail as a scan

The payers screen computes its total as `parseMinor(draft.amountText)` while
the form computes `receiptTotal ?? parseMinor(draft.amountText)`. On the
Receipt tab `amountText` is routinely empty — OCR often reads the line items
and misses the printed total, as `handOffReceiptTotal`'s own comment says — so
the payers header reads **€0.00**, every contribution scores "over", and the
two screens disagree about what the expense is worth.

Fixing the divergence downstream is treating a symptom. A scan with no total is
a scan that failed.

**Do:**

- **Refuse the scan when the model returns no total.** `scanReceipt` already
  has the shape for this — `ScanRejectedError` carries a model-written sentence
  shown verbatim. Add the app's own: *"I can't see the total on that one"*, in
  `lib/copy.ts` with the rest of `copy.scan`. The prompt in
  `apps/web/lib/scan/request.ts` already instructs the model to set `error`
  when the receipt is cropped or partly unreadable; this is the case where it
  returns lines anyway.
- **Validate that the parts add up.** Sum the line items plus the tip and
  compare against the printed total; on a meaningful mismatch, refuse with
  *"Something doesn't add up on that receipt"* rather than importing a bill
  whose grid will silently misprice everyone. Pick a tolerance — a minor unit
  or two of rounding is normal, a missing line is not — and keep the comparison
  in integer minor units.
- **Once the total is trustworthy, make one function own it.** The form and the
  payers screen should read the entry's amount from the same place instead of
  each deriving it.

### 3.3 A zero or negative receipt total locks the form shut

Same root, same fix. `receiptLocksAmount = receiptTotal !== null`, and
`receiptTotalMinor` returns a number as soon as *one* line parses — including
`0`, and including negatives (`parseMinor("-5.00")` is `-500`, confirmed). A
refund or all-zero receipt disables the amount field *and* fails
`amountMinor > 0`, and the footer then says **"Enter an amount to split"**
pointing at a field the app has disabled. The comment above
`receiptLocksAmount` anticipates "a scan whose every line is unreadable" (which
returns `null`) but not "every line is zero or negative".

**Do:** refuse these at the scan, with the validation in 3.2 — a bill totalling
zero or less is not a bill. Belt and braces: `receiptLocksAmount` should also
require a positive total, so no future path can disable the field and the save
button at once.

### 3.4 A group must never have zero members, and no device may sit in one unclaimed

`data.me` is undefined until a device claims someone, and while it is, *every*
member row shows a trash button — the `m.id !== data.me` guard passes for all
of them. Remove them all and the entry form's seed effect hits `if (!me)
return` and never seeds: `Blank title="New"` forever, no message, no hint that
People is where the fix is.

**Do:**

- **Refuse to remove the last member.** `apps/web/app/g/members/page.tsx`
  already has the pattern — `askRemove` opens a "Can't remove" dialog with a
  reason. Give it a second reason.
- **A device with no claimed member doesn't get into the group.** `/g/claim`
  disables Continue until a name is picked, but nothing stops landing on
  `/g?id=…` directly — a bookmark, or the join flow's back arrow followed by
  tapping the group row. Send an unclaimed device to `/g/claim` instead of
  rendering the group. Joining is not finished until "who are you" is answered.
- **Never render a silent `Blank`.** Where a screen genuinely can't proceed, it
  should say so and point at the way out, not sit blank.

---

## 4. Balances that visibly don't sum to zero

### 4.1 Removing a member checks expenses but not transfers

`askRemove` filters `data.expenses` through `expenseInvolves`; nothing looks at
`data.settlements` — `expenseInvolves` is the only such guard in the app.
So:

1. Ada sends Bob €50 as a transfer. Bob is in no expense.
2. Remove Bob — allowed.
3. `computeBalances` `touch()`es Bob so the set still sums to zero internally,
   but `BalancesTab` iterates alive `members`. **On screen Ada is +50 with
   nothing balancing her.**
4. `settleUp` works over `byMember`, so it still yields Bob, and the settle-up
   card renders `<span>{from?.name}</span>` — `undefined`. **A nameless row
   with an arrow and an amount.**
5. Tapping it opens `route.transferBetween(gid, <dead id>, …)`. `sidesOk` only
   checks `from !== to && !!from && !!to`, and a dead id is truthy. **Save is
   enabled on a transfer from somebody who is not in the group.**

**Do — the bug, then the class of bug it came from.** The one-line version is a
settlement check in `askRemove`, but four separate pieces of sloppiness had to
line up for step 5 to be reachable, and each is worth a look on its own:

- **Give core a sibling to `expenseInvolves`.** `packages/core/src/payers.ts`
  has the expense half; a settlement half belongs next to it, and the members
  screen should ask about both. Consider one `memberInvolved(state, memberId)`
  so the next entity kind can't be forgotten the same way.
- **`sidesOk` should check membership, not truthiness.** A member id that
  doesn't resolve to a live member is not a valid side. Same for `paidBy` and
  for split participants on save — the form will happily save an entry naming
  somebody who was removed on another device mid-edit.
- **Never render a bare `memberById.get(id)?.name`.** The settle-up card is the
  one place with no `?? copy.unknown` fallback; the rest of the app has one.
  A shared helper would make the omission impossible rather than caught by
  review.
- **`BalancesTab` should show anyone carrying a balance**, not only alive
  members — a removed person with a non-zero position is exactly who you need
  to see. Rendering `byMember` and marking the departed keeps the bars summing
  to zero on screen, which is the invariant the whole tab rests on.

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

- **The rate field is the one money field that rejects a comma.** `AmountInput`
  normalises `,` to `.` everywhere; the rate is a bare `<input>` checked by
  `isValidRate`. Half of Europe types `4,32` and gets a red field with no
  message. (Folds naturally into 2.1.)
- **The tip field swallows typos.** `items/page.tsx` stores
  `e.target.value.trim() || null` unvalidated; `"abc"` or `"5.5.5"` keeps
  showing in the field while `receiptTotalMinor`'s `try`/`catch` silently drops
  it from the total. It is the one typed figure on that screen — give it
  `AmountInput` like every other.
- **A scan shouldn't rename an expense you have already named.** `onPhoto`
  overwrites `description` with the merchant unconditionally. Only take the
  merchant name when the description is empty **or** still holds the previous
  scan's merchant — track that so a rescan can correct itself without
  clobbering a title somebody typed.
- **A finished scan shouldn't yank you into "who had what".** `onPhoto` fires
  `router.push(route.items(groupId))` when the scan resolves, even if you left
  the form minutes ago. Only navigate when the form is still the screen on
  show. The grid stays reachable and editable either way — "Edit who-had-what"
  on the Receipt tab is already the door.
- **History is capped at 200 and the count lies.** `activityFeed(ops, 200)`,
  and the subtitle renders `plural(revisions.length, …)` — the post-slice
  length. Drop the cap, or make it a seamless scroll-to-load-more; either way
  the count must be the real one.
- **History stamps are wall clock while ordering is HLC.**
  `stamp(rev.op.createdAt)` sorted by `compareHlc`, so on any skewed device the
  timeline shows times out of order. Less alarming once 5.1 lands, still worth
  a note in the UI or a switch to something monotonic.
- **A long unbroken name breaks the Balances tab.** `.balrow` is
  `grid-template-columns: 1fr auto` and the name is a bare `<div>` with no
  `min-width: 0` and no ellipsis, unlike `.rtitle` everywhere else. Forty mono
  characters — the `maxLength` — overflows a phone.
- **Emoji names get half a surrogate pair.** `initials()` and
  `distinctInitials()` in `apps/web/lib/format.ts` both slice by code unit.
- **`/new` discards a typed group in silence** while the entry form asks first:
  the back arrow is a plain `<Link>` and there is no `beforeunload`. Also,
  member names cap at 40 and the group name has no limit at all.
- **Clipboard failure is silent.** `onClick={invite.copy}` — a rejected
  `writeText` (insecure context, denied permission) is an unhandled rejection,
  `copied` never flips, the button looks inert, and the link is shown nowhere
  else. For an app whose whole auth model is a secret link
  ([ADR-0003](docs/decisions/0003-link-only-access.md)), there should be a way
  to read it when copying fails.
- **Unfolding an item commits the in-progress grid.** `commitRows` writes
  `receiptInvolved`/`receiptAssignments` into the draft, so backing out of
  "who had what" is no longer a clean cancel once you have tapped ×N.
- **The scan asks for a category and throws it away.** `normalizeScan` returns
  `patch.category`; the form never reads it, and `scanReceipt(…, [])` always
  passes an empty category list. Either wire it up or stop asking — it is
  prompt tokens and a promise, for nothing.
- **No throttle on `/api/groups/:id/scan`.** Anyone holding a group link
  proxies straight to Gemini on the shared key. `copy.scan.freeTier` implies a
  budget that nothing defends.
- **`lib/copy.ts` breaks its own stated rule twice.** `group.payers` does
  ``other${others === 1 ? "" : "s"}`` and `split.people` inlines
  `person`/`people`, both of which the file's own header forbids in favour of
  `plural()` with a `Noun`. `copy.noun.person` already exists.

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
not, and today the grid gives no way to say which. Worth deciding what a
negative line means on the who-had-what grid before writing anything —
including whether it should be assignable to people at all, like any other
line. The scan-time sum check in 3.2 has to agree with whatever is chosen.
