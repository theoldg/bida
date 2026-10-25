# Groups in and out

*For: anyone touching import, export, deleting a group, or anything handed to
the clipboard, and the file formats themselves. Part of the
[frontend](frontend.md) docs; what the other phones do when a group is deleted is
[sync.md](sync.md#deleting-a-group).*

## Bringing a group onto the phone

**Import a group**, first in the groups list's kebab, is the other
direction: somebody else's ledger read into a new group. The kebab is the whole
of the entry point.

**Two sources, one readout.** A CSV in the shape
[below](#the-group-as-a-spreadsheet) describes, chosen as
a file — or **a Tricount link**, fetched. Both land in the same `ImportPlan`,
and past that moment the screen cannot tell which it was. There is no box to
paste CSV text into.

**Three steps, and the source is read on the first.** Pick or fetch, look at
what was found, say which of those people you are. Reading writes
nothing — `core/import.ts` and `core/tricount.ts` both hand back a plan — so
the people, the currency, the counts and the rows that will be left out are all
on screen before an op exists. The plan is its own screen, `/import/plan`,
so back from it is an ordinary back to the picker, the pasted link still in
place.

**Fetching a link says what it costs, under the button.** *Sent through bida's
server, unencrypted. Not stored.* — centred under the button, and one of the
two things in the app that leave the phone readable, because the browser cannot
call bunq itself. `/about` names both in its privacy section, this one in
`about.privacy.import`; it is the same admission it makes about a receipt
photo, in the same place a person can still change their mind
(`apps/api/src/index.ts`).

Seven pieces, each in the layer that owns it:

| | |
| --- | --- |
| `core/import.ts` | Rows to a plan, and every refusal. Pure, and takes `dayToTimestamp` the way `export.ts` takes `formatDay`. `checkStated` (the plan against the stated balances) and the member, currency, figure and day checks are shared with the reader below |
| `core/tricount.ts` | A tricount's JSON to the same plan ([below](#reading-a-tricount-back)). Pure for the same reason, and it fetches nothing |
| `lib/import/csv.ts` | The bytes: an RFC 4180 state machine, the size guard, and the group name off the filename. A dialect is a parsing decision about somebody else's file, not domain arithmetic, so it is not in core — and it is not a dependency, since a library that auto-detects the delimiter is working against a reader whose whole rule is to refuse rather than guess. `parseCsv` is one swappable function if that changes |
| `lib/import/tricount.ts` | The link: the key out of whatever was pasted, a throwaway RSA public key the handshake wants, and one POST to `/api/tricount`. The private half is dropped where it is made, since nothing in that protocol signs anything |
| `core/import-shape.ts` | Each planned row as written: currency, rate, split mode and id, checked to read back as the plan ([below](#writing-a-plan)) |
| `lib/import/rates.ts` | A CSV's other currencies priced: one lookup per currency per day, six at a time, before anything is written. The plan screen says so under the readout, and a currency with no rate at all is the import's failure, named |
| `lib/db/commands/import.ts` | The plan as **one `appendOps` batch** under one actor: a hundred rows are not a hundred things somebody did a millisecond apart, and one batch is also the only atomic shape. Past fifty entries the batch is materialised in bulk and watched: "Continue as" becomes the scan button's bar, at how much is written — ten thousand take about fourteen seconds, nearly all of it IndexedDB's |

**History says an entry was imported**, since every row shares the import's
moment and author ("Ada imported this expense from Tricount", and "Imported
from Tricount by Ada" above the entry's Edit). It is read off the log, not a
flag: an entry whose create shares the group's create — actor, device,
`createdAt` — came in with it (`core/history.ts` `isImported`), so groups
imported before this read the same. A hand-made group's first batch holds no
entries, and the demo, seeded the same way, is excluded by id. What it came
from is `Group.importedFrom` (`tricount` or `file`), written on the group's
create; a group imported before that field says "imported" with no source.

**A refusal is whole-source, and says what to fix.** Every code in
`ImportRefusalCode` has a sentence in `copy.importData.refused`, interpolating
the `line` (1-based, as a spreadsheet counts, blank lines included) and the one
fact that code carries; the tricount codes name the entry instead, which is
what a person sees when they open it. The refusals are the most-read words the
feature has, which is why they are in `copy.ts` and the `ImportError` messages
are terse developer strings ([ADR-0033](decisions/0033-every-word-in-one-file.md)).
Three sentences beside them are not refusals of a ledger at all and say so:
that was not a Tricount link, this phone is offline, and **Tricount is not
answering** — the last one saying plainly that bida reads tricounts the way
Tricount's own app does and that this can stop working without warning.

The group's **name** is asked either way, prefilled and editable: a tricount
states its title, and a file can only be guessed at from its filename, since
both exporters name the file after the group and a mail client may have renamed
it since.

## Deleting a group

`/delete-my-data` is the app's answer to "take my data off your server", and the
only screen that destroys anything. It takes an **invite link**, not a group id
or a row on the list: holding the link is the whole of authority
([ADR-0003](decisions/0003-link-only-access.md)), so it is also the authority to
end the group, and asking for it means the screen works from a phone that was
never in that group.

The link is used to pull the whole log and open it, so what stands on screen
before the button is the real group, named, counted and dated
(`lib/db/erase.ts`). Then four deliberate frictions: typing the address to get
here, finding the link, typing the group's name, and a dialog that names the
group again. What is deleted is the server's copy, for everybody, plus this
phone's. **A quick split's link is taken too** ([ADR-0035](decisions/0035-a-quick-split-is-a-bill-with-no-group.md)):
its name, people and total, then one dialog — no name to type and no group
warnings, since it is one sealed row and nobody's ledger.

**The other phones learn from the 410.** Their next sync erases the group there
too and drops it off their list, wherever the app happened to be standing; the
group screen and `/join` say it was deleted, and `/g/claim` sends them back to
the list ([sync.md](sync.md#deleting-a-group)).

**Not linked from anywhere.** A screen whose job is deleting other people's
data has no business one tap from a ledger, so `/about` writes the address out
unlinked (`AboutDelete`, naming the host the app was opened from, since the dev
Worker holds its own groups), and the screen itself names the gentler thing
most people are actually after — Export data — before it asks for a link.

## Getting a group off the phone

**Export data**, in the group menu, hands over one CSV in
Splitwise's export shape — the only format anything else imports, Tricount
included, whose import *is* "import from Splitwise". The file is
`core/export.ts`; `lib/export.ts` is the part with a platform in it.

There is no format question and no JSON: a data dump is what `/diag` is for,
and `application/json` is not a file type the share sheet carries.

**Three rungs, and only *unavailability* descends** (`handoffPlan`, taking its
facts as arguments so the table can be stated and tested):

| | | When |
|---|---|---|
| 1 | `navigator.share` with a file | Wherever `canShare` takes one. The only way out of an iOS home-screen app, and the nicest anywhere: the sheet holds Save to Files, Mail and every messaging app, and it comes back to bida |
| 2 | `<a download>` | Everywhere except an iOS home-screen app — there a download is not unsupported but *hostile*, replacing the app with a full-screen "Open in …" that has no way back ([ios.md](ios.md#the-problem)). An iOS tab is fine |
| 3 | `/g/export` | Neither of the above exists |

A cancelled share sheet is **not** a failed one: it throws `AbortError`, means
"no thanks", and answering it with a fallback screen is the app insisting.
Only a share that never opened descends, because it leaves the phone exactly
where an absent sheet would have.

**Nothing says "Saved."** No rung can know: the share sheet doesn't report
which destination was picked and a download has no completion event. A
confirmation would be a guess on every platform, so the only outcome with
anything to add is the one that has a screen.

This narrows the "copying, not `navigator.share`" rule in `useInviteLink` —
that was about a *link*, where the clipboard is the destination and the sheet
is a detour. A file has no clipboard.

## The group as a spreadsheet

`core/export.ts` writes **Splitwise's export shape** and no other:
`Date,Description,Category,Cost,Currency` then one column per member,
`YYYY-MM-DD` dates, plain decimals. Tricount has no import of
its own format — it has "import from Splitwise" — so these columns are what
get a group into Tricount, Splitwise, Sesterce, Spliit and a spreadsheet, and
Tricount's own `Paid by X`/`Paid for X` shape would reach nothing this does
not. `Payment`, `General` and `Total balance` are spelled exactly so because
an importer matches them literally; they are protocol tokens, not copy, which
is why they are in core and not `copy.ts` ([ADR-0033](decisions/0033-every-word-in-one-file.md)).

**The bytes are the shape too**: LF, no BOM, a blank line under the header, a
blank line above the foot, and a trailing one. The foot is
`<export day>,Total balance, , ,<currency>` then the balances — the words go in
`Description`, never in `Date`, which an importer parses as a date and aborts
the whole file over. That leaves nowhere to state the total spend, so the file
doesn't. A newline inside a description folds to a space: quoting it is legal
but a reader splitting on LF first sees a record break, and two would look like
the blank line that ends the file. Every one of those is pinned by a test,
because **Tricount refuses the whole file over any of them** while its row
counter happily reaches the end — the blank lines especially, which read as
cosmetic and are not: the same file with them stripped is rejected.

**A member's cell is `paid − owed` for that row** — `entryDeltas`, which is
`computeBalances` run on that entry alone. Every row therefore nets to zero and
the column totals are the balances: the `Total balance` foot is
`computeBalances().byMember`, to the cent, by construction rather than by
keeping two arithmetics in step.

Three facts have nowhere to go in the shape, and each is resolved the same
way — by saying what is true rather than inventing a column:

- **Currency.** One `Currency` per row and one set of member columns, so
  there is no way to say a row is in MAD while the balance below it is in
  euros. The caller hands over a state already valued in the base and
  the column is constant — which is also the only way the foot agrees with
  the Balances screen ([ADR-0005](decisions/0005-money-and-currency.md)).
- **Income.** No such concept there, so `Cost` is negative; the member cells
  need nothing, being `computeBalances`' own. An importer that
  refuses a negative refuses the row, which beats silently booking a cost.
- **An entry nothing can apportion.** Kept, with every member cell zero.
  Dropping it would lose money somebody typed; apportioning the payers alone
  would break both the row's zero and the foot. It is already named on the
  balances screen, out of the same `problems`.

A **removed** member still named on a live entry gets a column, under their
plain name: without it nothing sums to zero, and "Bruno (removed)" would
import as a fourth person.

### Reading one back

`core/import.ts` is the mirror: rows in, a **plan** out, nothing written. The
foot is the checksum — fold the plan, `computeBalances`, refuse on any drift —
and a refusal is whole-file, by code and line, because a ledger missing one
entry balances to something nobody can account for.

Two things in the shape do not invert, so each is a **stated rule** rather than
a recovery:

- **A member's cell is `paid − owed`.** `(+20, −10, −10)` at a cost of 30 is "A
  paid 30, split three ways" and half a dozen other entries equally. One
  positive column — every file Splitwise itself writes — is lossless: that
  member paid the cost, and owes `paid − delta` (written as Evenly where that
  lands every cent — [Writing a plan](#writing-a-plan)).
  Several are read as several payers at `paidᵢ = deltaᵢ × cost / Σ positive`,
  which reproduces every balance to the cent while the payer figures are a
  guess. Both branches need `Σ positive ≤ cost`, which the file does not
  guarantee and which is therefore checked once: no real export can break it,
  since `Σ max(0, paidᵢ − shareᵢ) ≤ Σ paidᵢ = cost`.
- **A transfer is the `Payment` token plus the confirming shape** — exactly two
  non-zero cells, equal and opposite, sized to the cost. Nothing reads the
  description, so "payment for dinner" stays an expense.

`Category` comes back verbatim into `categoryId`, which is free text and not an
id into a table we do not have, so reading is the exact inverse of writing;
`General` and `Payment` are protocol tokens and land as nothing. A row with
every member cell zero is dropped — it is what the writer emits for an entry
nothing can apportion, and it adds zero to every column total, so the checksum
survives it. That is the only row that is ever dropped: **a row is skipped only
when it carries no money**, and anything else unreadable refuses the file.

Reading is **liberal where writing is strict**: CRLF, a lone CR, a BOM, a
case-folded header, blank lines anywhere and short rows are all accepted, since
a file arriving here has been through somebody else's export, a mail client and
possibly Excel. What is refused rather than guessed: a date that is not
`YYYY-MM-DD` (`01/02` is two days on two continents), and a cell finer than
its currency.

**A file may mix currencies.** Each row's figures are in its own `Currency`,
and each currency needs its own `Total balance` row, checked in that currency —
nothing is converted to read it. The currency most rows are in becomes the
group's; a row in another keeps its currency and is priced when the group is
written, at the rate on its own day (`ratesWanted`, `lib/import/rates.ts`). A
day the feed misses — before its history starts in March 2024, the endpoint
answers with its latest rate, whose `asOf` says so — borrows the nearest day it
answered (`copied`); a currency
it answers for on no day stops the import. A foot per currency is our reading
of Splitwise, whose multi-currency export nobody documents: a file with one foot
summed across currencies is refused, its checksum being meaningless.

### Reading a tricount back

Tricount has no export button, so the file above is not an option for anybody
coming from it — but its app talks to an API, and `core/tricount.ts` reads what
that answers into **the same `ImportPlan`**. Past that one function nothing
downstream knows which source it came from, which is the point: the readout,
the who-picker and the single `appendOps` batch are all the CSV's.

The shape is bunq's `Registry`: `memberships`, and `all_registry_entry` where
each entry states its `amount`, the membership that `owned` it and the
`allocations` saying whose it was — **signed from the group's side**, so an
expense is negative all the way down and an income positive. One line flips
that into our positive minor units with the direction in `kind`.

So the spreadsheet's hard case does not arise: payer and shares are stated
separately, and **an expense comes back exactly as it was entered**.
`membership_owned` is one membership and that costs nothing, since Tricount
has no expense paid by several people. One reading is still a rule rather than
a recovery, and it takes the option that loses nothing: **a repayment is a
transfer only with the shape** — `type_transaction` is `BALANCE` *and* exactly
one other person is on the receiving end. Anything else is an expense, the same
ruling the `Payment` token gets above.

There is no foot row, so the checksum is computed **by the route the app
itself uses** — allocations minus what you owned — which is not the route the
plan takes. That is what makes it worth checking: a transfer read backwards, an
income unflipped or a payer wrongly apportioned leaves the raw sums alone and
moves the plan's. A refusal names the entry rather than a line, since a line
is not what a person sees when they open the tricount, and an entry marked
`DELETED` is left out, as the app leaves it.

**What it holds to is the entries' stated shares**, which Tricount rounds to
the cent one entry at a time. Its own balance screen does not sum those — its
figures can be cents off them and need not add to zero — so an imported group
can disagree with that screen by a few cents and be right by every entry.

An entry's `date` carries a time of day, and Tricount lists a day by it, latest
first. It is kept as the entry's `createdAt` (`recordedAt` on the plan), the
tiebreak `byWhen` orders a date-only day by, so the day reads in Tricount's order.

**Every `amount` is in the tricount's own currency**, so a trip spent in three
currencies reads like one in one. Beside it, an entry spent elsewhere states
`amount_local` and `exchange_rate`, an allocation its own `amount_local`, and
a `RATIO` allocation the `share_ratio` it was split by. The plan carries those
as **hints** (`LocalMoney`, `parts`): unreadable is ignored, never refused,
because the base figures already import.

**The fetch is not here.** `apps/api/src/tricount.ts` makes the two calls and
`apps/web/lib/import/tricount.ts` makes the key pair they want, because core is
pure and because an undocumented API is exactly the thing to keep one file wide
([above](#bringing-a-group-onto-the-phone)).

### Writing a plan

The plan's figures are base currency and passed the checksum, so
`core/import-shape.ts` may write each row any way that **reads back as exactly
those figures** through `resolveEntrySplit` and `resolvePayers` — and checks
that it does. It prefers, in order: the currency it was spent in, at the
source's rate or else the shortest one `convertMinor` takes to the base figure
exactly (`rateSource: "imported"`); then Parts, Evenly, Amounts. Amounts always
fits, so the balances never depend on what was picked.

**The leftover cent decides Evenly and Parts.** It goes by
`hash32("<entryId>:<memberId>")`, smallest first, and the id isn't chosen yet —
so `seedFor` searches ids for one ranking the source's cent-takers first. The
odds are 1/C(n, k) for k cents among n people; the id is a hashed prefix, so a
try varies only the UUID's last twelve digits and costs a few dozen steps per
member, and each search is capped at 4,000 tries (about 5 ms, measured) before
falling through — a count, so the same file imports alike on any phone.

**A CSV row in another currency skips the search**: its base figures don't
exist until the rate does, so there is nothing to match. It is Evenly when its
own shares are within a cent of each other, else Amounts in its own currency,
and its foot vouched for it.

*Gotcha:* FNV-1a orders ids alike but for their last character rigidly — over
`m0`…`m9` some orders never occur. Test with ids `memberIdFor` makes.

## The clipboard

Four screens hand a string over — the invite link, a quick split, the CSV,
the `/diag` report — and every one of them was written for a clipboard that
**refuses**: `writeText` rejects on an insecure context or a denied
permission, and the answer is to put the text on screen to be read instead
(`InviteFallback`, and the same shape on the other three). A fifth hands over
a figure — a balance, or the payment in the Record card — and a refusal there
says nothing, since the figure is already on screen. It copies **the number
alone** (`figure`, `lib/format.ts`): no sign, symbol or grouping, the screen's
own decimal mark, because it is typed into a bank app.

A browser can also have **no clipboard at all** (in-app browsers such as
Messenger's). `navigator.clipboard` is then `undefined`, so
`navigator.clipboard.writeText(…)` throws before there is a promise to reject,
and a rejection handler does not catch it. `CopyLink` copies the link on
arrival, and a throw there takes the screen down to its error boundary.

So writing goes through **one door**, `lib/clipboard.ts`, where a missing
clipboard is the same *no* as a refused one — the shape every caller already
had. `hasClipboard()` is for the control that should say something else
without one: `CopyLink` drops the button and says *Hold to copy* over the
selectable link, rather than answering a press with nothing. Reading has its
own door for its own reasons (`lib/paste.ts`, whose calls are all already
inside the `try` that awaits them). `rules-check` holds the pair, because it
costs a line to lose and is invisible until it is somebody else's phone.

**Copied text never opens `word:`.** iOS takes such a text for a URL with that
scheme and percent-encodes the whole of it on its way between apps: a quick
split titled CBS, copied as `CBS: 155,00…`, reached a chat as
`CBS:%20155,00%0AJedrek%3A…/split%23<secret>`. So its first line is
`CBS total: 155,00` (`copy.quick.message.head`), and the 404 page repairs a link
that went through it anyway ([navigation.md](navigation.md#routing)).

**The invite link is `components/invite.tsx`** (`useCopyLink`), written once for
the People screen's top bar, the groups list's row menu and the group's own
menu. A copy that works says so where it was asked for, and **all three places
run the same flip**: the thing that was there **turns away on its X axis and
the check comes up behind it**. On the groups list — where the menu card has
closed and there is no bar to put a glyph in — that cell is the row's own figure
(`.flipfig`), and a balance on Balances flips the same way; on the group's kebab (`MenuButton`'s `confirmed`)
and People's top bar (`InviteButton`) it is the 18px glyph itself, at a
shallower perspective (`FlipCheck`, `.flipcheck`) — as is the copy glyph
beside the Record card's figure. A quick split's hand-over
answers the same way from its own button, the label turning and the check
coming up beside the word behind it (`FlipLabel`, `.flipcheck.line`). A
transition and not keyframes, because it reverses itself a second and a half
later when `invite.copied` lapses and a class going away replays no animation —
which is also why both faces stay drawn.
