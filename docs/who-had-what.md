# Who had what

*For: anyone changing the grid a bill is divided on, or how its tip, tax and
discounts spread. Part of the [receipt-scanning](receipt-scanning.md) docs;
the UX rulings are [ADR-0016](decisions/0016-receipts.md), and the reading the
grid starts from is [scan-reading.md](scan-reading.md).*

## The grid

`normalizeScan` uses none of `lineItems`, `tip`, `tax` or `discounts`. `/g/entry/items` does —
reached by tapping the Items tab's button — "Assign who had what" on a bill
nobody has been given a line of, "Edit who-had-what" once somebody has —
building the grid that becomes a `receipt` split — its own mode, which is why
no screen has to ask a second field whether a split came off a bill
([ADR-0016](decisions/0016-receipts.md)). The screen is **one scroller**: who
was there, the grid and the running per-person totals pass through it together,
and what is held back is what you are working against — the row of initials
across the top and the column of names down the left, so neither a column nor a
row can go anonymous on a bill that outruns the screen in both directions. The
chips are set once before anything is assigned and the totals are read at the
end, so freezing either costs the grid height it needs more (at eight people
on a 360×640 phone, over half the screen). Only Done stays put, being the way
out. Column widths are declared in a `<colgroup>` under `table-layout: fixed`,
never measured from the cells, or every dot moves each time a run is opened.
Everyone starts at the table and **nothing starts assigned**: ticking what you
had is the work, so the grid asks for it rather than handing you a bill already
split evenly to untick your way out of. **A tap on the line itself — the name
and amount — is everybody, or nobody**: the two answers a whole row of a bill
usually wants (a shared bottle; a dish that turns out to be one person's), in
one tap rather than one per column. It overwrites whatever was there, because a
control meaning "all of them" cannot also mean "all of them, except what you
already said", and a second tap puts it back to nobody. It takes a folded run
whole, portions and all — including one somebody is split across, which a
*cell* refuses, since the ambiguity there is which portion the tap meant and a
line has none. Done is never held grey: pressed on a bill
with a line nobody has been given, it refuses — every unassigned line's name and
amount bloom, the grid scrolling to the nearest of them first unless one is
already wholly in view, the button is spent for that travel and the flash, and only then
does the sentence under the grid appear, until the last line has somebody
([design-system.md](design-system.md)). It waits for that press because on
arrival nothing is assigned yet, and a red line printed then scolds a grid for
being untouched.

## A repeated line is portions

**×N never edits the bill.** A printed "Salad ×2" is split into portions as
the bill arrives (`unfoldAll`) — there have to be rows before there is anything
to assign — and a bill saved before that is split as the grid opens. The
button only opens and closes a *view* of them (`foldedLine`), and the history
reads a bill as printed (`printedBill`), so a split line is never "6 items → 7
items". So folding
never throws away which portion was whose, and cannot move a cent
either: three portions of 5.67/5.67/5.66 shared two ways do not round like one
17.00 line. A folded run whose portions went to different people wears the
split mark on everyone who had any of it, and a tap on one of those cells opens
the line rather than guessing which portion it meant — the run is scrolled into
view whole and the tapped column is pointed at
([design-system.md](design-system.md)). A run nobody is split across is the
single line it is drawn as, and edits like one: the tap lands on every portion.
A restored draft opens with every run folded, which is the compact reading of
it.

## Tip, tax and discounts

**Tip, tax and discount are one family — `BillExtras`.** They are the lines a
bill charges for that nobody ordered, so none of them can be ticked for on the
grid: each is spread across everyone at the table in proportion to what they
*did* order, and the discount is the one that comes off. `readBill` (core)
gathers every deduction into `discounts` first, wherever it arrived — a
negative line item, a negative tip, the field itself — so the arithmetic
downstream sees positive lines and a list of figures that come off, and never a
sign to get the wrong way round. Only the tip is typed; the other two are read
off the bill and drawn as rows with no cells (`copy.items.extra`), and a caption
under them says so — naming only the charges this bill actually has
(`copy.items.extraNote`). It sits in the table rather than in the footer below
it, because it explains those rows and the footer's line is what to do next.

**The deductions are kept apart, not summed.** They divide identically either
way, so this is for the reader: "Discounts −9.25" cannot tell a two-for-one
from a loyalty card. Several of them collapse into one row wearing the same
`×N` the repeated items wear, and open into the names the bill printed —
display only, since the rows aren't assignable either way. Each person's own copy of the bill names
them one by one too (`billCharges`, `receiptBreakdown`).

Proportional is the reading [ADR-0016](decisions/0016-receipts.md) settles on,
and the argument is "buy 1 get 1 free" — ham pizza 10, cheese pizza 8,
discount 8. The credit exists because *both* pizzas were
bought, so giving all of it to the cheaper one leaves the other person paying
full price for a promotion their order created. Pro rata (5.56 / 4.44) is the
same rule a whole-bill loyalty deduction follows, scoped to what it came off,
which is why the code has one rule and not two. A whole-bill discount, pooled
this way, leaves every ratio between people exactly where the items put them —
it is only the total that moves.

`quantity` never multiplies anything — `amount` is already the line's printed
total. It says how many portions that line is **unfolded** into, and — with
the number of people on the row — how much of it each of them had.

## The bill, read back

The grid is kept on the expense, so the entry screen can read it back:
`receiptBreakdown` returns the split weights *and* the lines they were summed
from, and each person's row on a scanned expense opens onto their own copy of
the bill — "Beer ×2", "Fries ×1 1/2", "Tagine ×1/3", then the tip and the tax,
muted, below what was ordered. Nothing is ruled or washed anywhere in it: not
between the people, not between a person's items and their extras, because a
name, a figure and a shift to muted ink already say where one thing ends. Each
line carries a printed bill's dotted leader out to its figure. It is the same
reading a quick split ends on (ADR-0035), which differs only in starting with
every row open. Weights and lines come out of one pass, so a row and the lines
under it cannot disagree.

## Gotchas

- **`receiptItems.length` is not how many items the bill has.** A line of
  several is kept as portions, so "Salad ×2" is two rows; say a count with
  `printedCount` (or `printedBill`), never the array's length.
- **A discount is spread across everybody, and that is a decision, not a
  fallback.** The grid has no way to say who a particular credit belongs to, so
  there is no "this voucher was on my dish" to honour — and pro rata is the
  answer with the best argument anyway (see above, and ADR-0016). If per-item
  scope is ever wanted, the seam is `readBill`: stop pooling, and give a
  deduction the lines it came off.
- **What a bill is worth is asked of `receiptWeights` (lib/draft.ts), never of
  `weightsFromItems` under it.** Dividing a line leaves a remainder cent, and
  only `tiebreakSeed` says whose it is, and a screen choosing its own seed
  quotes a cent the form then saves on someone else. The wrapper takes the rows
  and names the seed itself, so
  a caller cannot get it wrong, and `pnpm rules` fails on a screen that reaches
  past it.
- **Two things that mean different things to a person are two things in the
  code, however alike their arithmetic.** `receipt` is its own `SplitMode`, not
  `shares` with a flag; old ops carrying the flag are upgraded on the way out of
  the op log (`upgradeReceiptSplit`).
- `validateSplit(0, spec)` reads as **fully allocated**, not incomplete
  (`allocated === total === 0`). The verdict is `splitFooter`'s
  (`lib/format.ts`), so "€0.00 of €0.00 allocated" is unreachable rather than
  guarded per call site.
- **Don't write a derived value into the draft for another screen's effect to
  resync.** That resync is only as reliable as the next mount happening before
  anyone reads the value, and a screen that writes the input then navigates away
  (`/g/entry/items`'s "Done") beats it. Recompute inline instead — and where one
  tab derives what another tab merely reads, closing it needs an explicit
  handoff, or leaving Receipt zeroes the amount.
