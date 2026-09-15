# `pnpm drive` — the app as text

*For: anyone reproducing a bug, stressing a screen, or watching two phones
disagree, without a phone or a screenshot. It is the harness
[testing.md](testing.md) describes, driven by hand.*

A live session you send one command at a time, and that answers with the screen
written out in words. Stress-test any nontrivial behaviour here before calling
it done — owner's instruction,
[standing-instructions](standing-instructions.md#workflow) — and what it turns
up is usually the test worth writing.

```bash
pnpm drive start &                                   # holds the session open
pnpm drive do "as ana goto /" "click 3" "fill 2 Lisbon"
pnpm drive stop
```

| | |
|---|---|
| `as <who>` | switch phone, creating it on first mention |
| `goto <path>` · `back` · `forward` · `reload` | move around |
| `click <n>` · `fill <n> <text>` · `select <n> <label>` · `press <Key> [times]` | act on the numbered control the last screen handed you |
| `type <n> <text>` | key it in one character at a time — `fill` sets a value in one go, which never runs the amount field's regrouping or its caret |
| `hold <n>` | long-press — the only way to the row menus |
| `offline on\|off` | cut this phone's network, or restore it |
| `receipt <name>` · `receipt list` · `receipt off` | hand this phone a canned bill, so the next scan reads it |
| `clipboard` | read what the page copied — how the invite link travels |
| `screen` · `wait <ms>` | look again, or give something time to settle |
| `forget` | throw this phone away and start it factory-fresh |
| `html [n]` | markup and computed style, for calibrating the reader |

**Two devices are two names.** Each phone is its own `newContext()` — its own
IndexedDB, the part a single-context test cannot simulate — and `serveWorker()`
puts a real Worker and D1 behind them, so `ana` and `bruno` sync through the API
rather than a mock. That is the stack the `/join` bug needed
([sync.md](sync.md#gotchas)): `ana` creates the group, `clipboard` yields the
invite link, `bruno` opens it on a phone with no storage at all — the "never used
the app before" device the bug reports care about.

**A figure shown beside a balance has to be able to reach it.** Two of the three
defects a blind walk turned up were a screen stating part of an arithmetic it
presented as the whole: a balance summary missing the transfer leg, and a split
asking for an amount that was typed but unconvertible. Neither is caught by a
test of the arithmetic, which was right both times.

**A scan can be driven without a camera or a key.** `receipt <name>` arms the
phone rather than the screen — the same family as `offline` — and the scan
button is still the app's own, pressed by number: the hidden file input opens a
real chooser, this answers it with a real (1×1) image the client really
downscales, and only the round trip to Gemini is faked. It is the one way to
reach the who-had-what grid — by either door, the entry form's or a quick
split's — since a scanned bill lives in an in-memory draft and cannot be
seeded by poking storage.

The bills are `scripts/fixtures/receipts/*.json`, shared with `pnpm shots`, and
each declares in `exercises` the verdict it is for — `ok`, `rejected`,
`mismatch`, `busy`. One of them (`two-for-one`) carries two deductions and a
tax, which are the grid's rows with no cells. That claim is checked against `checkScan` itself by
`lib/scan/fixtures.test.ts` on every `pnpm check`, so a bill that quietly stops
adding up fails the suite instead of testing nothing. Adding one is a file; the
test tells you if its arithmetic is wrong.

**It runs as a daemon** because replaying the whole story to take one more step
loses what makes these bugs bugs — IndexedDB, the service worker, a group's
accumulated history. Its state lives in `.drive/`, gitignored.

## What the reader shows you

Its first use is the one it is shaped by — handing an agent the app the way a
stranger gets it, so it has to work the screen out rather than read the source.
So it offers no vocabulary from the app: no `#g-name`, no `newGroup`, only
numbers. Four rules separate it from dumping `innerText`, each one a wrong
answer it gave before:

- **Layout decides the lines, not tags.** The app writes `<span>` with
  `display:block`, which a tag list read as `Split3 people`.
- **What a sheet covers is not on the screen.** With one open, only what is
  inside it is numbered; the rest is counted as out of reach, and the text under
  the scrim is dropped. `:modal` answers this for a `<dialog>`; the row menu is
  a fixed veil with a `role="menu"` beside it and no dialog at all, so a scrim
  is also recognised by hit-testing the centre of the screen.
- **A phone is 844px tall.** What is below the fold is marked a scroll away.
- **CSS is also text.** `text-transform` is what a person reads (`LEDGER`, not
  `Ledger`), `text-overflow` is what they never get to (`…`), and
  visually-hidden text is read out by screen readers but is not on the page, so
  it is left out.

**A control that says it is the chosen one** — a picked row, the page you are
on — wears `(chosen)`. Inside a set the `(•)` says it instead, and saying it
twice reads as two claims. What is only painted that way says nothing here, on
purpose: that is the finding.

**Where the keyboard is pointing.** A numbered control wears `(focused)`; when
focus is anywhere else — a sheet that opened without landing it on a row — the
dump says so. `press` is how you reach what a tap cannot, and a key sent nowhere
looks exactly like a control that ignored it.

**Alternatives are read as one question.** A `tablist`, `listbox`, `radiogroup`,
or same-tag siblings painted in two ways come out as a set with the chosen one
marked `(•)`. When only the styling says which, the header says so — a segmented
control that never tells a screen reader which segment is live is a finding, and
this is where it surfaces. Members of one set are labelled alike, which is what
separates a segmented control from a control standing between two fields: the
transfer's two sides and the swap button between them are three buttons painted
two ways, and were read out as a question whose answer was the swap. Styling
answers only from three members up: in a pair
each differs from the other and nothing makes one the odd one out, so a pair with
nothing in ARIA is read as `nothing marked as chosen` rather than guessed at.

## Gotchas

- **Numbers are only good until the next screen**, like a person looking away.
  Every answer renumbers; never reuse a number across two commands blind. A
  failed command stops the rest of its `do` for the same reason — the commands
  behind it were written against a screen that never arrived, and the answer
  says `not run` rather than pressing whatever is wearing the number now.
- **Read a whole answer, not its tail.** The banner that says what state a phone
  is in — offline, changes waiting, link rejected — is the first line, above the
  back arrow, and `| tail` cuts exactly it.
- **`offline on` cuts the page load too.** Cut the network after a phone has the
  app, not before, or you are testing a blank tab rather than the offline app.
- **`html` is the one deliberate cheat.** It is for building the reader, not for
  using it; reading it during a blind run defeats the point.
- **Don't run `pnpm check` while a session is open.** It rebuilds `apps/web/out`
  under the running Worker, which then serves 404 for every path — including the
  app shell, so the next `goto` fails with an HTTP error that looks like a bug
  in the app. Restart the daemon after any build. A `git push` counts: pre-push
  runs `pnpm check`.
- **The daemon holds a browser and a Worker**, and `stop` takes both with it:
  `serveWorker` spawns `wrangler` detached and signals the process group, so the
  `workerd` underneath it goes too. It used to survive, and enough survivors
  exhaust memory — at which point a fresh `start` hangs before it ever writes
  `.drive/ready.json`. If a start ever hangs, that is still the first thing to
  check with `ps`.
