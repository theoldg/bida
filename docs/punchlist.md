# Phase 7 — the owner's punch list

*Filed 2026-08-27, verbatim from the owner, worked through in one autonomous
session. This file is the resumable state: if a session dies, the next one reads
this, finds the first ⬜, and carries on.*

Each item is written so it can be finished on its own and pushed on its own.
**Tick the box in the same commit as the change**, and update
[implementation-status.md](implementation-status.md) when a group of them lands.

---

## The items, as asked

| # | The ask (owner's words) | State |
|---|---|---|
| 1 | "the tabs are incoherent, there's a bottom row and a top row which partially overlap. consolidate into a bottom bar" | ✅ |
| 2 | "the dark theme is ugly make it less green/yellow" | ✅ |
| 3 | "there should be in-group options including personal mode, color theme, changing identity" | ✅ |
| 4 | "there should be a history log for changing identity" | ✅ |
| 5 | "none of the text anywhere should be selectable (unless you think somewhere is explicitly justified, probably not)" | ✅ |
| 6 | "there should be a cursor in the price input, and also maybe just let the native digit keyboard pop up" | ✅ |
| 7 | "drop the placeholder example texts (maybe replace with generic things like 'title' etc)" | ✅ |
| 8 | "add an option for people to co-sponsor expenses (e.g. Bob paid 400 and Alice paid 100 for these 500 spent on people XYZ)" | ✅ |

---

## 1 — One bottom bar, no top tabs

**Problem.** `/g` renders *both* a `Tabs` strip (Expenses · Balances · Settle up)
and a `BottomNav` (Expenses · Balances · History) whose middle item is on for two
of the three tabs. Two navigations for one screen, disagreeing about where you
are.

**Shape.** Delete the top `Tabs` strip from `/g` entirely. The bottom bar becomes
the only navigation inside a group:

```
Expenses · Balances · Settle · Group
```

`Group` is the new in-group options screen (item 3), which is also where History
and People move to. `Tabs` stays in `components/chrome.tsx` only if something
else uses it; otherwise it goes.

**Done when** no screen shows two navigation rows, and every destination the old
two rows reached is still reachable in one or two taps.

## 2 — A dark theme that isn't olive

**Problem.** The dark palette is the light ledger-paper palette darkened, so it
keeps the paper's green cast: `--paper:#11150E`, `--card:#191E15` are olive-black,
and the highlighter is a strong yellow.

**Shape.** Retune *only* the dark blocks in `apps/web/app/globals.css` (both the
`prefers-color-scheme` one and the `[data-theme="dark"]` one — they must stay
identical) to near-neutral warm greys with a barely-there green tint, and cool
the highlighter from yellow towards a soft amber-sand that reads as ink on paper
rather than a marker. Light theme is untouched: it's signed off.

**Done when** dark mode's greys are neutral, contrast still passes at a glance,
and `design/mockups/` carries the same values (the mockup is the source of truth
— a drifted mockup is a lying one).

## 3 — In-group options

**Shape.** A new screen `/g/options?id=…`, reached from the bottom bar's fourth
item. It carries:

- **Who you are here** — the identity claim that today only lives on
  `/g/members`. Pick a different member, or claim one for the first time.
- **Personal mode** — the same device-wide toggle as `/settings`, offered where
  people actually notice they want it.
- **Colour theme** — system / light / dark, same reason.
- Links onward: People, History, invite link, rename group.

Theme and personal mode stay **device-wide**, not per-group: they are properties
of this phone, not of the trip. The screen just surfaces them where you are.

## 4 — Identity history

**Shape.** *(As built 2026-08-27, and revised 2026-08-28 — see below.)* Claiming
or switching identity was first taken to be device-local (`meByGroup`), recorded
in a device-local Dexie table `identityLog` and rendered by the options screen
(item 3) as a small timeline: "You were Marie · became Sam".

**Revised, 2026-08-28.** The owner: *"the edits should record who did it, and
that's why i wanted to track the identity changes, also on the public log."*
That reframes the item — the identity log is not a curiosity about this phone,
it is what makes every op's `actor` auditable. Identity claims are now
`identity` ops keyed by the device's HLC node id, on the shared log, rendered on
`/g/history`; `identityLog` is dropped and `/g/options` reads this phone's
timeline back out of the ops it stamped. See
[ADR-0011](decisions/0011-identity-changes-are-public.md), superseding ADR-0009.

## 5 — Nothing selectable

**Shape.** `user-select: none` on the app shell in `globals.css`, with a
`.selectable` opt-in. The one justified exception: the invite link, if it is ever
rendered as text a person might want to copy by hand. Inputs keep their own
selection behaviour (browsers exempt them, but set it explicitly anyway).

## 6 — A real amount input

**Problem.** The amount is a rendered `<span>` driven by a hand-built keypad —
no caret, no native keyboard, no way to tap into the middle of a number.

**Shape.** Replace the custom keypad with a real `<input inputMode="decimal">`
styled as the big figure, autofocused on a new expense so the phone's digit
keyboard opens on its own. Keep the parse-as-you-type behaviour and the currency
chip. The `.keypad` CSS goes with it.

## 7 — Generic placeholders

Drop the invented examples ("Dinner · Nomad", "Marrakech", names in prompts) for
plain generic ones ("Title", "Name", "Group name"). The mockup's demo data stays
— it's a mockup — but the app itself should never look pre-filled with somebody
else's trip.

## 8 — Co-sponsored expenses

**The ask.** "Bob paid 400 and Alice paid 100 for these 500 spent on people XYZ."

**Shape.** `Expense.paidBy` stays exactly as it is — one payer is the common case
and every existing op in every existing log carries it. Alongside it, a new
optional field:

```ts
payers?: Record<Id, number> | null   // amounts in the expense's OWN currency,
                                     // summing exactly to amountMinor
```

Amounts are stored in the expense currency (that is what people actually handed
over) and apportioned into the base currency by the same largest-remainder
distribution the split uses, seeded by the expense id — so the payer side sums to
`baseAmountMinor` exactly, just as the consumer side does.

`paidBy` keeps being written as the **largest** payer, so an older client, a row
in the list, and an avatar all still have one sensible answer.

New core module `payers.ts`: `resolvePayers`, `validatePayers`, `payerList`,
`isCoSponsored`. `computeBalances` credits every payer. Tests live beside it and
must cover: sums exactly, rounding under conversion, a payer who is not a
participant, and equivalence with `paidBy` when `payers` is absent.

UI: the "Paid by" row on the expense editor opens `/g/payers`, an editor shaped
like the split editor. The expense row reads "Bob + 1 other paid"; the detail
screen lists who put in what.

---

## Order of work

Cheapest and least entangled first, so the session banks progress early:

5 → 7 → 6 → 2 → 1+3 → 4 → 8

Items 1 and 3 land together because the bottom bar's fourth item *is* the
options screen. Item 8 is last because it touches `packages/core` and needs its
own tests.


---

## Where it ended up

All eight landed on `main` on 2026-08-27 and are deployed. What each turned into:

| # | Landed as |
|---|---|
| 1 | `/g`'s top tab strip deleted; one bottom bar — Expenses · Balances · Settle · Group. `Tabs` and its CSS removed from the codebase |
| 2 | Neutral dark palette in `globals.css` **and** `design/mockups/index.html`; see [design-system.md](design-system.md#dark-is-not-the-light-palette-turned-down) |
| 3 | `/g/options` — identity, personal mode, theme, and the way out to People / History / invite / rename |
| 4 | `identity` ops keyed by device node id, rendered on `/g/history` and `/g/options`. Shared — [ADR-0011](decisions/0011-identity-changes-are-public.md) (Dexie v2's device-local `identityLog` was dropped in v3) |
| 5 | `user-select: none` on `body`, `.selectable` opt-in, inputs exempt |
| 6 | The keypad is gone; the amount is an `<input inputMode="decimal">` with a caret, autofocused on a new expense only |
| 7 | "Marrakech" → "Group name", "Dinner · Nomad" → "Title", "Cash, bank transfer…" → "Note (optional)" |
| 8 | `packages/core/src/payers.ts` + 17 tests, `computeBalances` credits every payer, `/g/payers` editor — [ADR-0010](decisions/0010-co-sponsored-expenses.md) |
