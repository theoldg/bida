# `/diag`, the flight recorder

*For: anyone reading a report a phone pasted, or adding a line to it. Part of
the [frontend](frontend.md) docs. What it records is explained where it
happens: stuck reads in [live-reads.md](live-reads.md), presses and the
keyboard in [touch-and-viewport.md](touch-and-viewport.md), back presses in
[navigation.md](navigation.md#gotchas), the home-screen hand-off in
[ios.md](ios.md#a-in-detail).*

`lib/diag.ts` records what the app spends its time on, always, into a bounded
array — a debug flag records nothing on the launch that goes wrong, which is
the only launch worth recording. Timed spans around the four things that can
make a screen wait: `db.open`, each live read by name, `rebuild`, and
`sync.pushpull` (plus `heal`), and each write — `sync.commit`, `append`,
`device.write` — since a write queued behind a lock is what every read then
queues behind; `sw.controllerchange` marks an update. One clock for all of them, because the question
is never "was this slow" but "what was it waiting for", and that is always an
overlap.

Two properties do the work, and `lib/diag.test.ts` holds both. A span that has
**not finished** still prints, marked `STILL RUNNING` — a read hanging right
now is why the screen is open. And the timeline is ordered by when things
**started**, not when they ended, so a long `rebuild` sits above the read it
was blocking rather than below it.

**The report reads newest first — the head, then this page, then the pages
before it, then the home-screen hand-off.** It is pasted from a phone into a
chat box that will not take all of it, so what just went wrong has to be in the
part that survives being cut short; the same reason the `menus and dialogs` block is in
the head. Only the *printing* is turned round. `timeline()` still orders by
when things started, so the overlap above is intact and the timestamps say
which span contains which.

**Back presses and dialogs are in it**, because neither can be watched with a
cable: a thumb on a system button in an installed app, and what decides the
outcome — whether the browser made the press cancelable, whether the document
still had an interaction to spend — is gone by the time anyone opens this
screen. One `back.press` line per traversal names what was done with it
(`ours`, `ASKED`, `let through`, `swap`) beside the event's own `cancelable`
and `active`; `dialog.open` and `dialog.gone` bracket each dialog, and
`dialog.gone` says whether it was `dismissed` or `SHUT BY THE PLATFORM`
(see [navigation.md](navigation.md#gotchas)). What a thumb did to the card between those two is
the `menus and dialogs` block below.

Its Copy button sticks to the top of the scroll rather than sitting in a
`Foot`: `env(safe-area-inset-bottom)` reads 0 on Android often enough that a
foot button sits half under the system navigation bar.

The report opens with `version:` (`lib/version.ts`), because every other line in
it describes a phone and none of them say which build that phone was running
([hosting.md](hosting.md#versions)).

A `screen:` line sits above the timeline: the layout viewport, the visible one,
the height the shell actually took, and what the browser admits the system bars
cover. They are one number on a phone that is behaving, and when they are not,
the difference is the strip at the foot of every screen that gets reported as
"the bottom is cut off" (see [touch-and-viewport.md](touch-and-viewport.md#the-screen-and-the-keyboard-over-it)).

A **`menus and dialogs`** block sits in the head, not down in the timeline
where its lines are written: one per overlay that has closed, from every page
kept, holding every press, lift, cancel and click the phone sent while it was
open, where each landed, what the hold's guard did with it, every step the
keyboard took under it, and which way it went out (`lib/press-trace.ts`). It is
in the head so it survives a paste being cut short.

It exists because "the menu answered on the second press" and "it refused a
bunch of taps" reproduce only on a phone, and every explanation for one is a
different line in that sequence: a click that never came, one swallowed, one
landing on the veil or the scrim, a `pointercancel` where a lift should be, a
card that grew or moved under the finger, or one that closed with no press
behind it.

**A dialog's parts are named apart from each other**, because that is the whole
question a refused tap asks: `pointerdown@btn1` lifting on `card` is the card
having moved out from under the finger, and Chrome sends no `click` when the
press and the lift have no target in common. `row` rather than `card` is a
press that reached the button's row and not the button — a disabled one takes
no pointer events at all — and `kb 404->0` is what moved things
(`--kb`, components/viewport.tsx). Back presses are noted inline as well as in
the timeline, so a thumb alternating between the system button and the card
reads in one line.

Each press also carries **where the card was against what was on screen** —
`card 320-520 visible 0-437 of 841` — which is the one thing no event says. A
modal `<dialog>` is laid out in the layout viewport and the strip a keyboard
covers is paid out of it as padding, so a card drawn while that payment is
wrong is centred over the keys and a tap aimed at its buttons never reaches the
page at all. It is written once and then only when it changes, because the same
numbers under every tap of a run are what would hide the one tap they were
different for.

**Both ends of a long sequence are kept, and the middle is counted**
(`…27 more…`): the taps that matter are the first that went wrong and the last,
which worked.

A `home screen` block follows, for the iOS hand-off ([ios.md](ios.md#a-in-detail)),
whose every step is off the screen by the time anyone looks. An inline script
in the layout writes each load's URL to localStorage before Next runs, and keeps
the storage's first load apart forever — on iOS the icon's storage is its own,
so that line is the URL the icon opened, and each load says which manifest its
head got. `/install` and `keepCarried` add `note`s beside them. Secrets are masked (`hideSecrets`); ids are not.

Read it at **`/diag`** — long-press the app's name on the groups list. It is
linked from nowhere; a diagnostics screen earns no room in a menu a person
reads. The last five pages' timelines are kept in `localStorage`, each under
its address (not a table — this has to work on the launch where IndexedDB is
the broken thing), because the launch that hung is the launch you killed the
app to escape, and a paste's `/join` is a page of its own beside the list.

It also carries the app's one hidden setting, **Staś mode** — the switch that
makes a scan insult whoever sent it a photo that isn't a receipt
([scan-worker.md](scan-worker.md#staś-mode)). It is here rather than
on a settings screen because finding it should cost a long-press, and because
the report prints its state beside everything else this phone is doing.

**`/diag` must never wait on the database.** It is opened *because* the
database is not answering. Everything that can block is raced against a 2s
patience window and the timeline, which needs no database at all, prints either
way; `pnpm stall` fails if it waits. **The window is one window for the whole
report: start every blocking question before awaiting any of them**, or each
line waits out its own two seconds after the one above. A new line in
`collect()` goes up with the others.
