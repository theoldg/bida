# Discard on the entry form does not leave

*For: whoever picks up the back-navigation work. Diagnosed 2026-09-21 on the
owner's Android phone, from two `/diag` traces. **Not fixed** — the last
section says what to do, and this file goes when it is done.*

## The symptom

On a half-typed **new** expense, the device's back gesture asks "Discard this
expense?" and tapping Discard does nothing: the screen stays, and because
`discard()` clears the draft before it goes, the form re-renders as
`<Blank title="New" />` — a page titled "New" with nothing in it. It looks like
a fresh blank entry rather than a screen that failed to leave.

The same Discard from the on-screen **arrow** works. So does Discard on the
payers editor, on the who-had-what grid, on `/new` and on `/quick`.

## The rule

**After a press this app refuses, a traversal whose target is history index 0
is not delivered.** `history.back()` returns, nothing moves, and no `navigate`
event arrives to say so.

Every screen that asks before leaving refuses the press to put its dialog up
(`back-button.ts`, the `ASKED` branch), so every one of them is exposed. What
decides whether it bites is **where the screen sits in the history**, not which
screen it is:

| Where the act runs | Target | Delivered |
|---|---|---|
| Create form at index 1 (app resumed into the group) | 0 | **no** |
| Create form at index 2 (walked in from the groups list) | 1 | yes |
| Payers editor, who-had-what grid (pushed above the form) | ≥1 | yes |
| `/quick` at index 1 | 0 | **no** — but repaired, see below |

`goUp` survives it: it checks that its traversal moved and puts the parent in
this screen's place when it didn't (`SWALLOWED_MS`, `lib/nav.ts`). `goBack` has
no such check, by design — it names no parent, so it has nothing to put there.
Discard on the entry form is the one exit that traverses to a parent it never
names.

## The evidence

Two traces of the same version, 1.0.62, on the same phone. Dev, where the app
had resumed into a group, so the form is at index 1:

```
11.74s  back.press  ASKED  traverse to=0 here=1 user=true cancelable=true active=true
11.74s  dialog.open   Discard this expense?
12.72s  dialog.gone   Discard this expense?   (click@btn1, then nothing)
13.73s  back.press  no screen  traverse to=0 here=1
```

No `back.press ours` line follows the tap on Discard — the traversal never
happened — and the next press still reads `here=1`, so the app never moved.
Production, where the session went through `/` and the form is at index 2:

```
3.06s  back.press  ASKED  traverse to=1 here=2 user=true cancelable=true
3.52s  back.press  ours   traverse to=1 here=2 user=false cancelable=true
```

Delivered, inside 10ms. And the same production trace holds the swallow *and*
its repair, on `/quick`:

```
644.22s  back.press  ASKED  traverse to=0 here=1     ← "Discard this split?"
644.75s  dialog.gone  Discard this split?
645.18s  live  groupSummaries epoch#4 3 rows          ← the groups list, 430ms later
```

Nothing at 10ms and a screen change at 430ms is not a traversal: that is
`goUp`'s no-move check firing and replacing. `/quick` takes the same swallow
the entry form does and recovers from it.

**"It only happens on dev" was a red herring.** Both installs run the same
version. The dev one had last been used inside a group, so `/` replaced itself
with the ledger (`lib/launch.ts`) and the ledger *is* index 0; the production
one was left on the groups list, so the ledger is index 1 and the form is at 2.
Production will do it too the moment it resumes into a group.

## Two labels in our own instrumentation that lie

Both of these sent this investigation down blind alleys, and neither is a bug
in the app:

- **`SHUT BY THE PLATFORM` on a dialog the app closed itself.** The label is
  `el.open ? "dismissed" : "SHUT BY THE PLATFORM"` read at cleanup
  (`components/dialog.tsx`), and `closeDialogs()` has already closed it by
  then. It does not mean a close watcher took the press.
- **No `close event` note on the entry form**, where `/quick` has one.
  `close()` queues that event; the re-render to `<Blank>` unmounts the dialog
  and removes its listener before it is delivered, so `onClose` never runs.
  Harmless — the screen is leaving — but it is not evidence of anything.

The signal that actually distinguishes the cases is the presence of a
`back.press ours` line, and how late the screen changes.

## The fix

**`discard()` should be `goUp(saveTo, (to) => router.replace(to))`** — the call
Save already makes a line below it (`app/g/entry/edit/page.tsx`). `saveTo` is
`formParent`, which is the entry summary for an edit and **the ledger for a
creation**, which is what the owner asked for on the way in. The repair then
covers the swallow, exactly as `/quick` demonstrates.

Two things to get right with it:

- **Don't clear the draft until the going lands.** The repair takes 400ms, and
  a draft cleared first means those 400ms are spent looking at the blank "New".
  A `leaving` ref is the pattern `/new` uses for its own version of this.
- **The other `goBack` exits are exposed to the same rule** — the payers
  editor's Discard and Done, the grid's Done and Back, `/quick/items`' Back —
  whenever their target is index 0, which needs the app to resume onto the
  form. Each already has a parent worth naming.

A cheaper-looking alternative was considered and rejected: have the screen
remember whether the dialog was opened by the arrow or by a refused press, and
replace outright on the second. It removes the 400ms window, but it puts new
state in the most delicate file in the app to buy what keeping the draft buys
for nothing.

## When this is fixed

The finding belongs in [frontend.md](frontend.md#gotchas), beside the two
gotchas it continues, as one line: *a refused press swallows a traversal to
index 0, so every exit needs a parent to fall back on*. Add the case to
`scripts/nav-check.mjs` — refuse a press, stub `history.go` to a no-op, assert
the screen left — close the watch in
[implementation-status.md](implementation-status.md#what-is-open), and **delete
this file**. It is a report, not a doc: it earns its place only while the bug
is open ([ADR-0007](decisions/0007-a-screen-is-a-route.md) owns the design it
is about).
