# Touch, keyboard and viewport

*For: anyone handling a press, a hold, a dialog, a field or the height of the
screen. Part of the [frontend](frontend.md) docs. Every item here is something
a phone did that no desktop browser does — read the heading that matches your
change before writing the handler. `pnpm entries` and `pnpm keyboard`
([browser-checks.md](browser-checks.md)) hold the ones a headless browser can
fake; [on-a-phone.md](on-a-phone.md) lists the rest.*

## A touch is not a click

- **iOS never sends `contextmenu` for a touch hold**, in any browser — only
  Android and a right click do. `useHold` (`components/long-press.tsx`) times
  the hold from pointer events and answers whichever comes first; the finger's
  later `contextmenu` and lifting click are swallowed on `document`, because
  they land on the menu's veil, which closes on either. A right click proves
  nothing about it; `pnpm entries` holds with touch.
- **A finger that opened a menu and then moves is not scrolling**, and the
  browser has already decided it is: pans are allowed everywhere
  (`touch-action: pan-x pan-y` on `html, body`), so sliding off the held row
  hands the touch to the scroller, which fires `pointercancel` and **dispatches
  no click at all** — yet that slide is the thumb reaching for the card the
  hold just opened. `heldFinger` refuses the scroll
  (`touchmove`, non-passive, for as long as the finger is down), washes the
  item under it, and clicks that item on the lift. It must have travelled
  `SLOP_PX` first, because the card is only a few px clear of the row and a
  resting finger's drift is not a choice.
- **A tap can arrive on iOS with no click in it.** The whole press lands on
  the element — `pointerdown`, `pointerup`, `touchstart`, `touchend`, no
  `pointercancel`, nothing swallowed — and WebKit simply dispatches no `click`.
  The same tap a second later is answered normally, so it reads as a control
  that works every other time rather than one that is broken. It is not the
  callout, the selection handles or the double-tap wait: `user-select`,
  `-webkit-touch-callout` and `touch-action` have all three off already
  (`globals.css`). **So a touch gesture that must not be missed cannot be built
  on `click`** — but nor can it simply be moved off it. A row menu's items wait
  `CLICK_GRACE_MS` for the click and answer the `pointerup` only if none comes
  (`components/row-menu.tsx`), asking `elementFromPoint` where that lift
  actually landed, since a touch's `pointerup` goes to whatever its
  `pointerdown` went to however far the finger has moved. `clickGuard`
  (`lib/click-guard.ts`) eats a click that turns up after that, because by then
  the card is gone and it would land on the row underneath. `pnpm entries`
  sends the clickless tap by hand; a real one in Chromium always brings its
  click.
- **`click` is the *last* event of a touch, and acting earlier leaves the rest
  of it to land on what you drew.** Answer a `pointerup` outright and Android
  still delivers `touchend`, `mousedown` and `mouseup` onto the changed screen.
  `Dialog` light-dismisses on `mousedown` (a drag off the card is not a tap
  outside it), so a stray one lands on a just-opened confirm dialog's scrim
  and closes it — Delete and Forget then do nothing, depending on the row's
  position. iOS is immune: the tap that brings no click brings no compatibility
  mouse events either. `clickGuard` guards `click` and `contextmenu` and
  nothing else; the `/diag` trace stops when the card unmounts, so it cannot
  see this. `pnpm entries` asks where that `mousedown` landed, not whether the
  dialog survived — mid-screen it lands on the card and survives regardless.
- **A press and a lift on different elements make no `click` at all.** Chrome
  delivers the `mouseup` to whatever is under the finger by then and fires
  nothing else: there is no click to fall back on, and no event says a tap was
  lost. So anything that moves between `pointerdown` and the lift eats the tap
  in silence — a dialog card recentring as `--kb` steps down while the keyboard
  folds is the one to watch, since opening a dialog blurs the field that raised
  the keyboard. This is why the press recorder names a dialog's buttons apart
  from its card: the two targets side by side are the only evidence there is.
- **A press tint is only as tall as the element it is on.** Padding that spaces a row of tappables belongs on the tappables, not on the bar around them: held by the parent, the touch feedback is a short band floating inside a taller bar, which reads as a tap that half landed.

## The screen, and the keyboard over it

- **A FAB sits on `--fab-foot`**, never a fixed `bottom`. It grows with the home-indicator inset (34px installed on an iPhone, 0 in a browser or headless check), so a fixed offset that looks right in every check sits on the indicator of the iOS PWA. The list under it ends on `.fabclear`, which is sized off the same variable, so its last row scrolls clear of the button.
- `100dvh`, not `100vh`, or iOS Safari's toolbar eats the foot of the screen.
- **The shell takes `height`, not `min-height`.** With `min-height: 100dvh` the
  shell grows past the viewport, the *document* scrolls instead of `.scroll`,
  and the bottom bar sits at the foot of a long page — invisible until you
  scroll. `.app` is `height: 100dvh; max-height: 100%; overflow: hidden`,
  `html, body` too, and every scrolling child of a flex column needs
  `min-height: 0`.
- **A shell taller than the box that clips it loses its last strip, silently.**
  `body` is what clips `.app` (`height: 100%`, `overflow: hidden`), so the two
  have to agree about how tall the screen is — and they are two different
  measurements, `dvh` and a percentage of the initial containing block. A `dvh`
  reported larger than the ICB puts the bottom of the shell below the fold,
  where nothing scrolls: the about line under the
  groups list. Seen on an installed phone after Reload onto a new build; no
  browser check reproduces it. **How to recognise it:** everything else is right, the FAB is exactly
  where it belongs, and the groups list's start pair has slid *lower* than
  usual — a `position: fixed` FAB is placed against the ICB, so a FAB that has
  not moved while `margin-top: auto` pushes the pair down says the ICB is the
  honest one and `dvh` is not. Hence `max-height: 100%` on `.app`, and `100%`
  rather than `100dvh` wherever else a box is sized to the screen (`.dialog`);
  it costs a browser that agrees nothing at all. The same symptom from the
  other direction — a layout viewport bigger than the screen it is painted on,
  which no CSS can see — is measured instead: `viewport.gap` in the `/diag`
  timeline is how much of the layout viewport is off screen with nobody
  typing.
- **`dvh` does not shrink for the keyboard.** On iOS the keyboard and its
  accessory bar are drawn *over* the layout viewport, so the shell keeps its
  full height and `.scroll` ends behind them — a field scrolled to that edge,
  by us or by the browser on focus, sits under the strip's buttons. The visual
  viewport is what's left: `components/viewport.tsx` writes the covered
  strip to `--kb`, and `.scroll` spends `--kb` plus air as both padding and
  `scroll-padding-bottom`. Padding is what a last row can scroll into;
  scroll-padding is where a field mid-form stops. A dialog sits outside the
  shell and pays the same toll: the scrim spends `--kb` as bottom padding, so a
  card is centred in what is left rather than behind the keys. `.foot` pays it
  too, for the screens that pin an act. **An act that scrolls has to be scrolled to**: the four
  screens that ask for people put Create, "Continue as …", the scan pair or
  "Change who you are" under the add row, so the field asks for that much room
  beneath itself (`--act-below`) and `bringIntoView` spends it. It has to be
  spent in script, because `scrollIntoView`'s `nearest` reads "already in view"
  off the field's own box — a field the browser has just parked above the keys
  is finished as far as it is concerned, `scroll-margin-bottom` and all, and the
  button under it stays behind them. Only ever upward: a keyboard closing must
  not drag the list down to re-hang the field at the bottom of the screen.
  `pnpm keyboard` holds all four ([browser-checks.md](browser-checks.md#pnpm-keyboard--a-form-under-a-phone-keyboard)). **A gap with nobody typing is not a keyboard** and is
  never paid as one (`lib/viewport.ts`): the difference between the two
  viewports is a keyboard only while something has the caret; otherwise a
  browser that reports the two differently gets permanent padding at the foot
  of every list.
- **A press that closes the keyboard is a press that never lands.** A button
  tapped while a field has the caret blurs it on `mousedown`; the keyboard
  retracts, the visual viewport grows, the page reflows — and the `click` misses,
  because the button has moved out from under a thumb that hasn't lifted. It
  reads as a button needing two taps. `keepsFocus`
  (`components/bits.tsx`) is the whole fix: `preventDefault` on `mousedown`, so
  the field keeps focus and nothing moves. Spread it on anything pressable that
  shares a screen with a field. Tab and Enter are untouched — a keyboard never
  moves the layout out from under itself. **It holds off only while `data-kb`
  says there is a keyboard**: Android's back button closes the keyboard and
  leaves the caret in the field, and holding that focus through the next press
  makes Chrome reopen the keyboard over the tap's answer. In
  that state it blurs the field itself rather than trusting the press to move
  focus — which browser and target both get a say in. The three cases are
  `caretOnPress` (`lib/viewport.ts`), which is where the test is.
- **`scrollTo({ behavior: "smooth" })` is not smooth everywhere.** It glides
  on iOS and jumps on Android, and has no end event to wait on either, so a
  scroll the app has to wait for is driven by hand, frame by frame (`glide`,
  `lib/seek.ts`). Reduced motion still puts it in place at once.
- **A sticky `<thead>` needs a scrollport to stick to.** In a wrapper that only
  scrolls sideways — `overflow-x: auto` makes it the nearest scroll container in
  *both* axes — `position: sticky; top: 0` is inert while the page scrolls past
  it, and looks implemented. The wrapper must own the vertical scroll too, with
  `border-collapse: separate`, or the collapsed border belongs to the table and
  slides out from under the frozen row.

## Focus

- **Only a real `<dialog>` gets focus for free — and it spends it without
  asking.** `Dialog` calls `showModal()`, so the platform keeps Tab inside and
  makes the screen behind inert, but it also focuses the first focusable
  descendant when nothing in the card claims focus. In a dialog whose first
  control is a field that is the field, keyboard and all, `data-autofocus` or
  not. `Dialog` therefore parks focus on the card itself unless an
  `input[data-autofocus]` asks for it, which only `PromptDialog` does. `RowMenu` is a card anchored to the row — or the button
  (`MenuButton`) — it was opened from and cannot be one, so it does that by hand: it focuses its first item once it
  has been positioned — a `visibility: hidden` element cannot take focus, and
  `preventScroll`, because a scroll is what closes it — and hands focus back to
  the row on the way out.
