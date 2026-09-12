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

**The entry form's amount says less** (2026-09-12). Under the figure it prints
only what the entry is worth in the group's currency — the rate itself is not
printed there, because the form is not where it is set. What each figure came
from is a badge below both of them: "read from receipt" and "set EUR rate",
side by side when the entry has a scan *and* a foreign currency, each opening
where that number is changed — and a Save refused for a rate the group has
never set fills that badge red, since the fix is not on this screen
([design-system.md](design-system.md#a-dialog-is-ours-and-its-button-says-the-act)).

**A scan draws the two seconds it takes** (2026-09-12). The scan control fills
with the press wash over about two seconds — the length a scan usually is,
jittered a little so it doesn't read as a canned animation — and hands over to
the spinner only if the model is slower than that; an answer that beats the bar
never shows one ([design-system.md](design-system.md#palette-roles)).

**A scanned expense gets a title, not just a merchant** (2026-09-12). The
model returns `title`: the name with the parts that aren't the name stripped
("Bar Zahra - Sarl M. Benali" → "Bar Zahra"), plus two or three words of what
was bought where the name alone wouldn't say ("Lidl - barbecue"). Its
judgement, not a local rule — nothing downstream reads the field as the
merchant of record
([receipt-scanning.md](receipt-scanning.md#what-the-model-decides-and-what-it-must-not)).

**The app is called bida** since 2026-09-11 — name, icons and the top-bar
mark all come from `design/brand/logo.svg`. The Worker and the D1 database
keep the old `hajsik` name, and so does the IndexedDB database, because all
three are addresses that existing links and phones already point at
([hosting.md](hosting.md#deploying)). A `bida.` domain is the open question.

**A receipt may take money off** (2026-09-12). Tip, tax and discount are one
family on a bill (`BillExtras`): nobody ordered them, so none can be ticked for
on the who-had-what grid, and each is spread in proportion to what everybody
did order. Every deduction is gathered into one list, whichever field the
model filed it under (`readBill`), and kept by name behind the same `×N` a
repeated item wears, so a "buy 1 get 1 free" comes off both pizzas in the ratio
they were ordered in and says which credit did it, and a receipt printing tax on top of
its lines reconciles instead of being refused. This closes the last open
question in [product.md](product.md)
([receipt-scanning.md](receipt-scanning.md),
[ADR-0016](decisions/0016-receipts.md)).

**A ledger row shortens itself rather than being cut off** (2026-09-11). Its
second line comes as several wordings — `lib/row-meta.ts` — and `FitLine`
renders the longest that measures under the box, so a long name costs the split
mode rather than half a word
([design-system.md](design-system.md#a-row-says-less-rather-than-being-cut-off)).

**The exchange-rate field groups its thousands** (2026-09-11) like every other
money field: it types into `GroupedInput`, the caret-and-grouping half of the
amount input, and printed rates go through `rateText`
([frontend.md](frontend.md#every-money-field-is-componentsamount-inputtsx)).

**The open question is why an installed phone still pauses** (2026-09-11).
The permanent hang below is fixed, but the owner reports the skeleton rows
still standing for 10–20s before they clear — which is suspiciously close to
the watchdog's own 6s and 12s, and so may be the repair rather than the fault.
Three candidates look identical from outside the app: a slow `indexedDB.open`,
a read queued behind `rebuild`'s readwrite lock on every table, or a read that
died and was re-armed. **`lib/diag.ts` records all four spans on one clock and
`/diag` prints them** — long-press the wordmark
([frontend.md](frontend.md#the-flight-recorder-and-diag)). **The next action is
to read a timeline off the owner's phone**, not to guess again.

**A read of this phone's database can no longer hang forever** (2026-09-11).
The installed Android app was hanging on its skeleton rows: Dexie's
`liveQuery` swallows the two error names the browser uses when it kills a query
under a frozen or evicted page, and the dead subscription reads to a screen as
"still loading". Every live read now goes through `useLive`, which re-arms on a
close, on resume, and on a watchdog, and says so when it gives up
([frontend.md](frontend.md#a-live-read-can-die)). The app has an error boundary
for the first time, and `syncGroup` is single-flight per group — opening a
group raced the sync loop into rebuilding the same group twice.

**The entry form is being thinned.** It carried 19 tappable controls on a new
expense where three do the work — the rest confirm defaults the form already
has right. The kind is now one chip rather than three permanent buttons, and it
sits centred on the top bar rather than over the amount
([ADR-0010](decisions/0010-what-an-entry-is.md)); Save is a full-width last row of the
form rather than an underlined word in the corner
([frontend.md](frontend.md#state)) — as are Create on the new-group form and
Done on the who-had-what grid, the two other screens whose one act ends them —
and a refused Save points at
the field that stopped it by flashing it rather than holding it red
([design-system.md](design-system.md#a-dialog-is-ours-and-its-button-says-the-act)). Two further cuts are proposed
and **not** decided: folding the "Multi-payer" link into the payer dialog, and
taking "Receipt" out of the split's tab bar now that `/g/scan` is how a scan
starts. Ask before building either.

The previous open subject — invariants the UI checks at write time that a merge
can break anyway ([invariants.md](invariants.md)) — is closed. What follows is
what closed it, newest last, and then the measurement it owed.

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

**Both ways into a group end on the same question.** `/new` dropped its "You
are" field — your name is on the members list like everyone else's — and hands
the finished list to the picker that joining already ended on
(`components/who-picker.tsx`), so whoever is picked is the group's first member
and the actor on the ops creating it — asked even of a group of one
([frontend.md](frontend.md#state)).

**A new build is taken by tapping for it.** The worker still never activates
mid-session, but waiting for the last client of the origin to close turned out
to mean *never* on a phone with a forgotten tab open — an installed app stuck on
an old build with nothing on screen to say so, which is how this was found.
`lib/update.ts` watches for the waiting worker and re-checks on every
foreground; `components/update.tsx` offers it at the foot of the groups list.
`pnpm offline` now covers the tap end to end
([ADR-0004](decisions/0004-static-export-and-offline.md)).

**A name is filed by pressing for it.** Filing on blur asked the rest of the
app to guess: a screen's button had to flush the field before it acted, a tick
had to yield to a name being typed, and a press that filed a name rewrote the
screen out from under itself. The plus on the row files it, disabled until there
is something to file, and the row wears a box while a name is unfiled — so the
guessing is gone and the state is on screen instead. `pnpm claim` holds it
([testing.md](testing.md), [frontend.md](frontend.md#state)).

**A figure a screen quotes is the figure it writes.** A total that does not
divide hands the leftover minor unit to somebody by `tiebreakSeed`, which is the
entry's id — so the form, pricing under a placeholder until there was one,
showed the cent on one person's row and wrote it to another's. The draft carries
the id its entry will be written under (`newEntryId`, read through `splitSeed`)
and `addExpense` writes it there; `pnpm entries` compares the two readings.
Found by driving the app as text ([testing.md](testing.md), it was a €0.01
disagreement no arithmetic test could see).

**The payer screen speaks in the entry's voice.** Its title switched for an
income and nothing else did, so "Who received it" was followed by "Ana didn't
pay". A string whose wording turns on which way the entry runs is `Voiced<T>`
now — the payers screen throughout, and the history's payer lines
([frontend.md](frontend.md#every-word-in-libcopyts)).

**A deleted entry's history is titled by what it was.** The screen looked its
subject up in the alive-only lists while its own links used the maps that keep
the deleted ones, so an entry you opened *because* it is gone was titled
"Transfer" — the branch a missing subject fell through to. Both read the same
maps now.

**The log reads the entity, not only the patch.** A revision carries the fold
either side of it, so `history-copy` can say what the change alone could not: a
co-payer added beside the largest contributor moves `payers` and nothing else,
and used to read "edited this entry". The payer side now asks the split's two
questions — who put money in, then how much each of them did — an income is
called one on every edit rather than only the crossing, each figure is priced in
its own currency, and a scan, a who-had-what grid and a rewritten split mode
each say so ([sync.md](sync.md#history-ui)).

**One press on Save is one entry.** Save asked `checkEntry`, which answers
whether the form may be saved and not whether a press is already spending it, so
two taps landing before the navigation did both went through: a transfer
recorded twice, for twice the money, and an expense given a second create op
that said nothing. The form holds a `saving` flag now, as every other button
that writes already did, and `pnpm entries` presses Save twice. Found by driving
the app adversarially — mashing the controls rather than walking them
([frontend.md](frontend.md#state)).

**A receipt can be scanned without a camera.** The who-had-what grid was the
one screen no check could reach — it hangs off an in-memory draft behind a photo
and a network round trip — so it had none. `pnpm drive`'s `receipt <name>` hands
a phone a canned bill from `scripts/fixtures/receipts/`, which `pnpm shots`
now reads too, and the app's own scan button does the rest
([testing.md](testing.md#pnpm-drive--the-app-as-text)). Each bill declares the
verdict it is for and `lib/scan/fixtures.test.ts` holds it to that against
`checkScan`, so the set cannot rot the way the inline one it replaced had.

It found one thing on its first walk, since fixed: **the grid quoted a figure
the form then wrote a cent away from.** `/g/entry/items` seeded its per-item
remainders with `draft.entryId ?? "new"` while everything downstream used
`splitSeed(draft)` — the `newEntryId` fix went through the form and never
reached this screen, so a €76.50 bill read €22.25 for one person and saved
€22.24. Both screens now ask `receiptWeights` (`lib/draft.ts`), which takes the
rows and names the seed itself; `pnpm rules` fails on anything reaching past it
to `weightsFromItems`.

**A receipt split is a mode, not a `shares` split wearing a flag.** `receipt`
is a `SplitMode` of its own: the same weighted division As parts does, and
nothing else in common with it. The flag it replaces (`splitTab` on the entry,
read together with `split.mode` by every screen that named a split) is gone —
ops already written in that shape are upgraded where they become state
(`upgradeReceiptSplit` in `applyPatch`, so the fold and the history read one
shape). It closed a class of bug rather than one: the ledger row calling a
scanned bill "as parts", the log counting its weights as parts ("Teo ×3943
parts"), a tab that kept claiming Receipt after somebody switched away
([ADR-0016](decisions/0016-receipts.md)).

**The payer screen is a field, not a toggle.** Every row's amount was hidden
until a tap turned that person "on", so the plus icon that did it sat outside
the row's own button and the last payer could not be removed — two dead
corners `todo.md` named. Every row now carries an always-open amount field,
the same reasoning as `SplitEditor`'s "as amounts" tab: the figure *is* the
statement, typing it in is how somebody joins. The explicit "back to one
payer" button is gone with it — clearing every field down to nothing collapses
the draft to a plain single payer on its own, `paidBy` set to whoever
`primaryPayer` (`core/payers.ts`) now names as the largest contributor rather
than whoever the map happened to iterate to first. The entry form's trigger
into it shares the payer row: "Paid by: Alice" still opens the single-payer
dialog directly, and a quieter "Multi-payer" link at the right end of the same
row is the only way in from there. One payer costs one row; only the
multi-payer card takes two, since it has chips to show.

**Scanning starts from the ledger.** A camera above the "+" opens `/g/scan` —
the two scan buttons and nothing else — and what comes back is an ordinary
expense form with the bill's title, amount, date and currency already in it.
Both scanning screens run one hook (`components/receipt-scan.tsx`) and **a
scan no longer navigates**: it used to push straight to the who-had-what grid
whenever the bill had lines, which made photographing a bill a commitment to
itemise it. The grid is a tap on the Receipt tab, split evenly is a tap on
Evenly, and with nothing racing the screen the rate dialog for an unrated
currency just opens ([receipt-scanning.md](receipt-scanning.md)).

**The measurement is taken** (2026-09-11, production D1: 47 groups, 678 ops,
676 kB). Whole-entity ops cost **2.55x** — 241 kB of entry ops fold to 94 kB of
final state, at 2.29 ops per entry — which is real and is not the problem.
**Receipts are.** An expense op carrying `receiptItems` averages 2,016 bytes
against a plain one's 473, and those 97 ops are **74% of every patch byte in the
database**. Since an entry is written whole, editing a scanned bill's title
repeats its entire item array. Compaction, if it is ever wanted, is one rule:
drop superseded `receiptItems` from ops the fold has passed. Nothing needs doing
yet — the free tier is 500 MB and the largest real group is 45 kB
([hosting.md](hosting.md)).

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
