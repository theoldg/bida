# The entry

*For: anyone touching the entry form (`/g/entry/edit`) or the entry screen
(`/g/entry`): the draft, the split tabs, Save, the keyboard's chain, and how
an entry is laid out. Part of the [frontend](frontend.md) docs.*

## The draft

- **The entry draft is never stored** (`lib/draft.ts`): an in-memory store
  shared by the entry screens, so bouncing to the payers/items routes keeps
  what's typed, and nothing else does. One draft covers all three kinds, which
  is what lets the kind chip change your mind without losing the amount you
  already typed. Leaving asks before discarding, and a reload gets the
  browser's own warning — `seedDraft` records the baseline `isDraftDirty`
  compares against. The payers route asks too, and puts back only the payer
  side: the rest of the draft is not its to throw away. So does who-had-what,
  which has to write a split or merged line through as it happens — its rows
  and the bill's lines are one list — and restores the bill it opened with.
  A **quick split** is this same store, keyed by the phone's scan credential
  rather than by a group, which is what makes the whole of it — bill, grid and
  answer — something leaving throws away
  ([ADR-0035](decisions/0035-a-quick-split-is-a-bill-with-no-group.md)).
  **What the entry is worth is `draftAmountMinor` and nowhere else** — a
  scanned bill is worth what its lines add up to, whatever `amountText` says. With no
  amount at all the door onto that screen doesn't open: there is nothing to
  divide between payers, so the tap reddens the amount field instead — the
  same red Save gives it, held until something asks for it.
- **A draft carries the id its entry will be written under** (`newEntryId`,
  read through `splitSeed`). The leftover minor unit goes by `tiebreakSeed`,
  which is the entry's id — so a form pricing its rows under a placeholder id
  shows the cent on one row and writes it to another. `addExpense`
  takes the id rather than minting one. `pnpm verify entries` holds it.
## The split editor

- **Each split tab is its own input** (`SplitInputs`, ADR-0010): the editor
  draws and edits the tab showing, `changeSplitTab` is the one way the tab
  moves (handing a newly opened tab its start through `openSplitTab`), and
  `activeSplit` says which spec a save writes — the receipt's, on its tab,
  read off the bill. Which tab is lit is `splitTab` alone, never the spec. What a first-time
  tab is handed is who `arithmeticSplit` has in, never the receipt: a scan is an answer of
  its own, in a mode of its own, and does not fill in As parts (ADR-0016).
  Items opens the Evenly under it the same way, so that is never nobody.
  Which tab is showing lives on the draft alone; a saved entry carries its
  mode, and that is what reopens it.
- **A count of parts** is typed with the money field's caret and Backspace
  (`PartsInput`), between − and + drawn small and grey; having parts puts you
  in, none takes you out, and a tap on the name toggles.
- **An "as amounts" row is typed, sharing or out**: a figure typed, in with
  none (the rest — what the typed figures leave, divided evenly, its share the
  field's grey placeholder on a faint rule), or not in the split (a zero, as
  faint). A tap on the name never types: typed and sharing go out, out comes
  back sharing, under the mark that says so — a grey × or + for what the tap
  does, Evenly's ink tick for a row that shares. Typing makes any row typed;
  clearing a typed figure leaves it sharing. Over the total, or with nothing
  left, the sharing rows read a red "?" and the dock names them. On
  `/g/payers` a tap on a name is not a focus either: it clears a figure, hands
  an empty row what is left, and types only when the column is already full or
  over (`tapAmount`, marked by `TapMark`), since a payer has no rest to share.
- **The everyone box toggles the whole list** (`toggleEveryone`), in every tab
  but Items and only from three people up: everyone in takes everyone out,
  else it brings in whoever is out and leaves the rest — a 2 in parts stays 2,
  a typed amount stays, and in amounts whoever was out joins the rest. The tabs
  stick to the top of `.scroll` and the everyone box, under the last row, to
  its foot, so a long list keeps both in reach.

## Save

- **Whether the entry may be saved is `checkEntry` (`lib/entry-check.ts`)**,
  not the form. It answers the amount, the base figure, the split in force and
  why the entry isn't ready — from a draft and its own rate, with no React
  in it, so the arithmetic behind that button is a test suite rather than a
  screen to mount. The form reads its answers and writes none of them.
- **Save is the last row of the form, and the kind is the top of it.** One
  full-width `.btn-lg` ([design-system.md](design-system.md)), because the
  screen has exactly one act; a save failure is said above it. The kind chip sits
  at the top bar's right, inked — the form's second ink block after Save, spent on
  the one choice that reshapes everything under it, with the picker's ⇕ in it
  ([design-system.md](design-system.md)).
- **Every field's value starts on one column** (`--label-w`), so a label is a
  word or two: an income's payer is "Paid to", since "Received by" won't fit.
  Several payers are the payer picker's first row, "Multiple people ›"; with
  no amount it is greyed, "set the amount first" under it, rather than open a
  screen that divides zero. Once set, they are one row of lines, largest
  amount first ([below](#the-entry-on-screen)).
- **Save is never disabled** ([refusals.md](refusals.md#a-refused-action-points-first)):
  tapping it while `!checkEntry(...).ready` refuses instead of saving, and what
  is *missing* blooms. `amountMissing`/`titleMissing` *flash* their field rather
  than adding a caption — a word doesn't fit next to the hero figure — counted
  per field so a repeat refusal replays. That flash is the only thing that reports a missing amount — `splitFooter`
  returns `null` for a zero total. What is *wrong* is said in words, live, in
  the Save dock over the button, where no scroll hides it: `blocker` (a removed
  member, payers that no longer add up to the amount) and `splitProblem` (the
  split now showing, following its tab). A refused Save flashes them and spends
  the button like any bloom. Typed amounts that do add up are ticked there too
  (`splitTick`), but only while nothing is wrong: the dock holds one line. The dock keeps 9px of its own above its first line, so a
  half-scrolled form never runs into it. An Items tab short of
  its split says nothing in words — its step blooms.
- **A press already spending the draft is the form's own `saving` flag.**
  `checkEntry` answers whether the entry *may* be saved, which is a question
  about the form, not whether a save is in flight; without the flag a double
  tap before `router.replace` records the entry twice. `pnpm verify entries` presses
  Save twice.
## The keyboard's chain

- **The confirm key hands the caret on, or folds the keyboard.** A phone
  keyboard's bottom-right key is whatever `enterKeyHint` names it, and the word
  it wears is a promise — so `"next"` is both the opt-in and the instruction,
  and **every other field is the end of its chain and puts the keyboard away**
  (`confirmAct`, `lib/viewport.ts`). That is what makes each column of figures
  a chain of its own rather than a stretch of one long one: the entry form runs
  amount → note → fold, and the split editor's "as amounts" and "as parts" each run first person →
  … → last person → fold, started by a tap on a field. `walkFields`
  (`components/viewport.tsx`) is the whole of it, hung on `.scroll` because the
  next field is rarely a sibling; it walks that screen's fields in the order
  they are laid out and puts the caret at the *end* of what is already in one
  (entered at character nought, a typed "5" turns "12.00" into "512.00"). It
  steps over what has no caret to take — a date spinner, an amount a scanned
  bill owns, a tab's fields not drawn (`landsOn`) — and an IME's Enter is a
  candidate being picked, never a field being finished. **A field inside a
  `<form>` is left alone**, because its Enter is already spoken for and is a
  better answer than either of these: the add row files the name and hands the
  caret back, a dialog submits its card. What asks for `"next"`: the entry
  form's amount, `/new`'s group name, and each row but the last of a column of
  figures — the split editor's "as amounts" and "as parts", and `/g/payers`;
  `pnpm verify keyboard` walks each column ([browser-checks.md](browser-checks.md#pnpm-verify-keyboard--a-form-under-a-phone-keyboard)).
- **The currency picker offers the group's own currencies first** — the base
  one, then whatever the ledger is written in, most spent-in first, then the
  short common list (`lib/currencies.ts`, `currencyChoices`), then "Other…" for
  any code — one `CurrencyPicker` in /new and the entry form. A trip spends in
  two or three, and scrolling past seventeen to reach one of them is the whole
  of the annoyance. Names come from `Intl.DisplayNames`, with a small fallback
  map for the codes a trimmed locale build answers bare (ISK, UZS).

## The entry on screen

Every top bar is the same height whatever was typed into the app
([design-system.md](design-system.md#the-bar-is-furniture)), so text with more
to say than a bar holds says it **in the screen**. `/g/entry`'s head is
the entry's own title, with the figure under it and the bar left holding only
the kind and the date, both bounded. The title's size is measured rather than
set (`FitTitle`, on `lib/fit.ts` like `.rmeta`'s wording ladder): it takes the
largest step that says the words in one line and falls to the wrapping size
when none does, so "Dinner" is a heading and a sentence is a paragraph. Nothing
on that ladder reaches the amount — the money still leads, and it keeps
the same left margin as the title, since a figure pushed to the other edge
strands the short ones.

The figure is set at two sizes (`.entryamt`, cut by `moneyParts`): the whole
part 44px, the currency code and the fraction at 55% in `--muted` — "UZS
150,779.27" read as one weight made the code and the cents as loud as the
thousands. A lone symbol (`€`, `$`) is set at the whole part's size and ink: at a code's size one glyph
read smaller than three letters, and muted it read as a smudge. It sits against its digits, as "£6.87" is written
everywhere else — a gap made for a word stranded one glyph from its number. The code stays on whichever side the reader's locale
puts it. A sum too long for the column shrinks to fit it (a container-query
size off the whole part's length, never under 28px) rather than wrapping
mid-number. The sum as spent, when it was spent in another currency, is a
13px muted line under it, not beside it — beside, it read as a third part of
the same figure — with the rate chip that made it the figure above at its end — a button, opening
the entry's rate dialog as the entry form's twin chip does (`RateChip`: a quiet
"@", the figure at one digit fewer than the dialog edits, a red "?" for no rate).
It starts flush at the left margin, one run of text: sharing the figure's
columns so the two sets of digits lined up broke on the edge cases (a symbol
over a code, a code on the trailing side), and the margin is an edge every
case has.

**An expense or income is laid out as its form is**: a head card, the ÷
(`.splitrule`), then the split in a card of its own. On the form the head card
(`.formhead`) is the figure over What, Paid by and When as ruled rows, each
washing under a press. Several payers are one row (`.payersfield`): a line
each in the value column, name and figure with its currency set as the item
split's summary rows are, and one › centred on the lines — it opens all of them, not the
first — standing where the date's calendar does and drawn at its weight; on the
entry it is the title, the figure and who paid, with your balance under the
split, on the screen's ground. A transfer's form has no ÷, so no head card. Under a hairline the head card says who:
one payer is a line — "paid by **Adaś**" — named nowhere else on the screen;
several are rows carrying what each put in, under an eyebrow that counts them,
"Paid by **2 people**". A transfer's head is no card: its card below is
nothing but who. The cards' eyebrows read as phrases ("Split by items", "Paid
by 2 people"), not a label, a dot and a value.

**History is one quiet link, above Edit** (`.entryhist`) — never a top-bar
icon as well, which was two ways to the same screen. A clock, then what is
there — "Created by Luke", or "Edited 3 times · last by Han" — then a chevron
right after the words, in grey, not underlined; only those words are the
link, and a press washes them, as `.tlink`'s does, not the row. The name is the first
thing to go when the line is short (`historyMeta`); "Created by" with no room
for the name says "History". Both ride the dock under the card; a deleted
entry keeps the line where Edit was.

## Gotchas

- **`patch()` on the draft must merge against the latest saved draft, not the
  `draft` the render closed over**, or two `patch()` calls in one handler both
  merge onto the same stale closure and the second undoes the first. `patch()`
  reads `getDraft(groupId)` itself, so a handler may.
