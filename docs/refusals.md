# Asking and refusing

*For: anyone writing a dialog, a picker, or a button that can say no. Part of
the [design system](design-system.md).*

## A dialog is ours, and its button says the act

Asking is never `prompt()` or `confirm()`: those arrive in another app's
typeface, announcing that the *site* is asking, with one line where a consequence
needs a paragraph. `components/dialog.tsx` — `ConfirmDialog`, `PromptDialog`,
`NoticeDialog` (read, then Close) and `ChoiceDialog` — is a real `<dialog>` — `showModal()`,
so focus and Escape are the platform's — filling the viewport and painting the
scrim itself. Inside: a hairline card, `Cancel` beside an act that names itself
("Forget group", never "OK"), `--debit` outlined when it destroys something.
**A confirm's title is the question its act answers** ("Forget this group?");
every other dialog's names what it holds ("Currency", "Invite link") or asks
which one ("Which one are you?"). Never an imperative, which would compete with
the button. A
screen still wins where the decision needs the ledger on it — the payers editor,
who-had-what ([ADR-0008](decisions/0008-hand-rolled-interface.md)). Nor is a `<select>` ours, and
there are none left: `ChoiceDialog` picks from a short list in the app's own
rows — a name, a check on the current one, and a `note` saying what an
unobvious pick does; your own row says "(you)" on the name's line, so it is no
taller than the others. A `lead` row may head it, with a chevron: not
a choice but a door elsewhere, as "Multiple people ›" heads the payer picker.
**Two marks say where a tap goes:** › goes to another screen, which Back
returns from; ⇕ (`i-updown`) opens a picker over this one — a `.pick` field
(Paid by, a new group's currency) and the entry form's kind and currency
chips. Not ⌄: a fold's chevron already turns down when it opens in place. A date is the exception, being a calendar and not a list
([ADR-0008](decisions/0008-hand-rolled-interface.md)). A *failure* is not
a dialog at all — there is nothing to decide — so it is said under whatever was
attempted, in `--debit`: `Failure` / `.failure`. **A held action always says
why**: Save greyed with nothing to read is a dead end, so the entry form keeps
a single reason line in the dock over Save rather than one per branch — but a
line is not the only way to say it, and where the fix is a control on screen
the control blooms and the sentence goes.

## A refused action points first

A Save, a Create or a Done that can't go through is never greyed in advance —
an untouched field is not a mistake, and a grey button gives no reason.
Pressed anyway, it blooms whatever stopped it `--debit` and lets it settle
back over ~600ms — **whole, ground included**. A missing figure blooms its field: the title's box
fills like an ink block, its label and whatever is written in it riding along
in `--brand-ink`, and the amount takes a red plate under its figure and the
rule it is typed on. The label goes with the fill because it is the word that
says *which* field was refused. A missing *step* blooms the whole control that takes it, edge, label,
icons and any rule inside it: the scan pair and the door to the who-had-what
grid, which is the Items tab's entire complaint. Both of those are ink blocks,
so both fill (below). Words come only once a Save is refused, because "scan a
receipt" is true of every untouched bill and said unasked reads as a scolding
for arriving. **A flash alone can be missed, so the entry form's refusal also
says one thing in words** — one red line over Save, never a stack. Everything
missing still blooms; the line names the problem a bloom explains worst, least
obvious first (`REFUSAL_ORDER`, `lib/entry-check.ts`): a rate, the payers —
said as "Paid by: …", their row blooming with it, since a bill typed or read
again moves the amount under figures somebody typed — the split, the Items step, then the amount and the title, which an empty field
going red already says. Fix it and the line moves to the next. The payers' and
split's sentences stand on that line unasked; the rest leave once nothing is
missing, so a field emptied later is not scolded. Where what is missing is spread over
several rows, every one of them blooms: a Done on the who-had-what grid points
at each line nobody has been given: the row washes `--debit-wash` from edge to
edge, its words go `--debit`, and every empty cell flashes a solid `--debit`
dot — the mark a tap there would draw — since an empty cell draws nothing at
rest and the row would say what is missing but not where to tap. No press tile
behind the dot: a column of them read as stuck buttons, not a line. This is how you find the line again in twenty rows
of bill. **A refusal nobody can see whole is a press that
did nothing**, so unless one of those rows is fully in view — a name with its
amount cut off by the fold is not — the nearest is brought into the grid
smoothly first and the flash runs when it lands (`lib/reveal.ts`, `lib/seek.ts`);
one already wholly in view moves nothing, because a list that jumps under
somebody looking at the answer is worse than one that sits still. The entry
form does the same on its own scroll — with the keyboard up, Save and an empty
amount are a screen apart — and blooms only what is still missing when it lands.
With the rate, the amount or the title among what is missing it goes to the very
top instead, where the three are read together.
The button itself never goes red — it is the
control that was pressed, not what is missing — it only greys for the length of
the flash and any travel before it, like Save. A number that
is not on the form at all blooms the way *to* it: a foreign entry whose currency
the group has no rate for points at its rate chip, and the dock line says which
rate. **A control fills whole**,
ground and border together, rather than colouring its label: that chip, the two ink blocks — the who-had-what door and the scan pair — and
a field: a red line around unchanged grey writing is the smallest signal in the
app for the biggest thing it has to say. A label alone is smaller still, and a `--brand` or `--rule-soft`
frame left around a red block reads as half a refusal. **A refusal
blooms what has to change**, and on the add row that is the whole row — a good
name is never refused, since every press files it — so its box washes
`--debit-wash` in a `--debit` edge, the writing goes red and the plus fills,
15px of glyph in a 32px box being far too little ink to be seen going red:
the placeholder when a screen refuses over a list too short to go on with, the
typed name when the list already holds it. That name's line under the row is
boxed like the entry form's line over Save and fills with the row; the two are
glided into view together before either blooms, as the grid's rows are. The box is always there with a
transparent edge, so the wash moves nothing. A press of the plus on an empty row refuses nothing at
all: it takes the caret, which is the whole answer. And a keystroke ends any
flash there on the spot, rather than reddening writing that is being typed over,
and tells whoever owns that flash, so Create un-greys with it (`name-adder.tsx`,
`lib/refusal.ts`). A flash
rather than a held red, and it replays on every refusal — the two identical
`-a`/`-b` animations in `globals.css` are the restart mechanism. Save is spent
for exactly as long as the flash — greyed instantly, eased back — which is the
press saying it landed, and stops the same press arriving again over a form
mid-way through saying no. The bloom is a jump in *contrast* and not only in
hue (`--debit` is far darker than `--rule` on paper and far lighter in the
dark), so it survives being unable to tell red from grey. It is the one thing
exempt from the global reduced-motion clamp: a colour settling is what that
guidance asks you to fall back *to*, and clamped it would be nothing at all.

## Not every flash is a refusal

**Not every flash is a refusal.** Where a tap is answered by the screen
rearranging itself — tapping a folded run of portions on the who-had-what grid
opens it — the tapped column is faint from the first frame those rows are
painted, holds that way while they are scrolled into view whole, and is
released once they have stopped moving, each dot easing back to what it really
is. **The column meets in the middle**: assigned and empty cells alike sit at
one faint ink, so what an opened run shows first is the places an answer could
go. The empty ones take the assigned ink while held, because their resting
square is `--card-3` and would vanish at that strength; the assigned ones fade
rather than darken because `--ink-2` has nowhere darker to go. **A pointer starts held, not
animated** — rows painted at full strength and dimmed a beat later flicker, and
nothing can ease into a row that did not exist a frame ago. Never `--debit`:
nothing is wrong and nothing is being asked for.
The same `-a`/`-b` pair restarts it, and it is exempt from the motion clamp on
the same grounds. Nor is the flash a scan earns by bringing lines back: the
form's way into the who-had-what grid fills with ink once, a beat after the
form appears — the next step pointed at, not demanded — whether the scan began
on `/g/scan` or on the Items tab, never on `/quick`, whose screen is already
that step. A cell that cannot be tapped like its neighbours doesn't look
like them either — a run handed out unevenly wears the dot **broken into two
overlapping squares** on everyone who had any of it, so no cell in that row
reads as an ordinary assignment. **An empty cell draws nothing** — pale squares
read as disabled ones — and a tap inks its square in. The rows nobody ordered (tip, charges,
discounts) wear a 4px `--rule` **pip** instead: ink, since everyone does carry a
share, but too small to be a target.

## Gotchas

- **`animationend` bubbles.** `.btn-pair` listens for the refusal flash on the
  way up, so anything else that animates inside it — the scan's sweep, the
  grid's pointer in a bloomed row — has to stop the event, or a flash that
  never ran reads as one that settled.
- **An animation taken off mid-flight reports nothing.** Fixing what is wrong
  *during* the flash removes the class and no `animationend` fires, so a
  control spent for its length stays spent. Whatever put the flash there ends
  the refusal by hand (`refusal.onFlashEnd()` with no event, `lib/refusal.ts`).
- **A `::placeholder` cannot be animated** — Blink drops the animation and no
  test sees it; `getComputedStyle(el, "::placeholder")` mid-flash says so.
  Animate the *input* and mix the placeholder from `currentColor`
  (`globals.css`, "save refusal"). And a placeholder is *created* each time its
  field empties, starting any animation still declared on it: take a one-shot
  class off on `animationend` (`e.pseudoElement` says which fired).
