# Browser checks: moving around

*For: anyone fixing or extending the checks on moving around: the back arrow,
the history behind it, the ledger's search bar. Part of the [browser
checks](browser-checks.md) docs, which say how to write one that holds.*

## `pnpm verify nav` — where the back arrow goes, and what it leaves behind

The arrow's destination is the half the other checks already stumble over on
their way somewhere else. This one watches **the shape of the history behind
it** — whether the screens you left are still there — which is what the device's
back button reads on the next press. Every assertion
here reads `navigation.entries()` rather than `location`
([ADR-0007](decisions/0007-a-screen-is-a-route.md), `lib/nav.ts`).

Each section is a move a thumb makes: the walk in, every door into a group
pushed from `/` so the list stays under the ledger; the balance card and the
arrow back off balances; an entry opened off the ledger, and the Save that
returns to it; the tip jar's form, unwinding past the tip screen too; the quick
split, pushed onto the list; a cold load with nothing behind it, where the arrow
puts the parent in this screen's place; the press guard on a half-typed form,
cancelled outright, the dialog its whole answer; the dialog the platform shuts
with no `cancel`, and the taps it was given as `/diag` records them; a
`history.go` that never moves, the card coming down and the act happening
anyway; Discard one entry above a cold ledger; and the ledger's position, left
with a row cut by the top edge and required back to the pixel after the arrow,
the device's back and a Save that lands a row above it — watched from the frame
the saved row is drawn, since it then glides to it, and the figure rolls only
then — while a tap in from the list opens at the top. Beside the cold load, the
press no traversal can carry: a launch's reopened ledger and a cold one each
climb to the list on a close request with no tap first, and a screen above them
doesn't. **Escape stands in for Android's button** there, being a close request
too. Then a back press the instant an entry opens on a CPU throttled sixfold,
which a handler in a passive effect sends past the ledger to the list. Last,
Delete on an entry: up to history, or to a ledger folding its row out though the
read came first (traversal held 80ms).

**A device back press is `page.goBack()`**, which Chromium reports
`userInitiated` and `cancelable` — the pair the guard reads. A keyboard
shortcut is not: headless Chromium binds none, and `Alt+ArrowLeft` fires no
`navigate` event at all, which makes a guard check written with it pass by
never pressing anything.

**And that press is not awaited.** A cancelled press never lands, so
`await page.goBack()` would sit out the navigation ceiling. What is awaited is
the dialog.

The waits are on the history itself: `window.__shape()` goes in through the
context, so the wait for a shape and the reading of it are one function and
cannot drift, and every assertion is a condition rather than a pause. The one
exception is the guard's second half, where the assertion is that the screen
did *not* move — a cancelled press has nothing to announce, so that one takes a
`settle` ([browser-checks.md](browser-checks.md#scriptslibharnessmjs--what-the-browser-checks-share)). The
group is built once, by the section that walks in through `/new`, and every
other section stands on it.

## `pnpm verify search` — where the search bar is, and the list under it

What a search finds is unit-tested (`lib/ledger.test.ts`), and so is how much
of the bar a scroll brings out (`lib/ledger-search.test.ts`). This holds what
neither reaches, the bar's every state on a real screen
([frontend.md](frontend.md#the-ledgers-search)): away at the head and half out half a bar
short of the base state; in the column over results; back at the base state when cleared; home
again when let go of empty, but not when a drag is what let go; kept for the
way back from a result and blank on a tap in; drawn where the list is put
back from the first frame of a way back from an entry; and a list too short
to scroll lent the room, again on the way back. The moves are **recorded frame by frame, not sampled** — a
fling must draw the bar part-way, a cleared search must never, a first letter
must bare no head while a slowed list catches up — since each is over in a
dozen frames. With the rate limit taken out, both fling assertions fail.
