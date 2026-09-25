# What only a phone can check

*For a session with an iPhone in hand. Part of the [testing](testing.md) docs.
Everything here is behaviour headless Chromium cannot produce — WebKit's
events, iOS's own chrome, or a storage these checks share and a phone does not.
[`/diag`](diag.md) is the evidence for most of it
(long-press the app's name on the groups list); read the Gotcha each line points
at before deciding a symptom is new.*

**The icon and what it carries** ([ios.md](ios.md#a-in-detail)) — the `home
screen` block says which manifest each load got and which URL the icon opened.

- **Install from a group's ledger, not `/install`.** That is the run that
  settles which of the manifest and the page URL carried the fragment: only the
  manifest carries anything there. The icon must open on `/install#…` with the
  group in it.
- **Install while the tab knows who you are.** The launch claims the name
  silently — history reads "started editing from a new device", and nobody is
  asked who they are.
- **Join a second group in the tab, then install without reloading.** The stale
  carry reloads the page on the next reloadable screen; an icon that arrives
  holding one group of two is that reload not firing.
- **Launch the icon again.** `start_url` is `/install` for the life of the
  bookmark, so a launch with nothing left to give must land on the list and
  reopen the last group, never on `/join`.
- **Add with Open as Web App off.** `display:` says `browser`, `storage:` says
  `EVICTABLE`, and the banner rightly goes on warning.

**Taps WebKit does not send** ([touch-and-viewport.md](touch-and-viewport.md#a-touch-is-not-a-click)) — the
`menus and dialogs` block holds every press, lift and click of a closed overlay.

- **Hold a row, slide onto the card it opened, lift on an item.** The slide is
  a scroll as far as the browser is concerned; `heldFinger` is what makes it a
  tap. Nothing happening means it has broken.
- **A control that answers every other time** is the clickless tap. It is in
  the block or it is something else.
- **Delete and Forget**, from the hold and from the kebab: the confirm dialog
  must outlive the tap that opened it.

**The keyboard** — `pnpm keyboard` fakes one; the accessory bar is real.

- The four screens that ask for people (`/new`, claim, payers, the scan pair):
  the act under the add row has to be reachable with the keys up.
- Every pressable beside a field acts on the **first** tap (`keepsFocus`).
- The rate editor's card sits above the keys, not behind them.
- Fold the keyboard: no padding is left at the foot of the list.

**The chrome** — none of it exists in a headless viewport.

- The strip above the page under iOS 26's scrim: a band with an edge means the
  body's background and the bar under it have come apart.
- The FABs clear the home indicator.
- **Tap Reload for a new build, then look at the bottom strip.** The FAB in
  place with the start pair slid lower is `dvh` disagreeing with the ICB;
  `screen:` and `viewport.gap` say so.

**In and out** — every rung of these is a different platform promise.

- **Paste link** is always two taps, and the granting read comes back empty.
  *Nothing to paste* over a copied invite is the bug.
- **Export from the installed app must reach the share sheet.** A download
  there replaces the app with a screen that has no way back.
- **An invite opened in Instagram or Messenger** is refused by name — and
  Chrome, Brave and DuckDuckGo on iOS are *not*, their agents being Safari's
  but for a token.

**Notifications** ([notifications.md](notifications.md)) — headless Chromium
refuses push registration outright, permission granted or not.

- **Turn on from the card, in the installed app.** iOS must show its prompt;
  once allowed, the card goes, and the group's identity on another phone's
  `/diag` carries a `push` with an Apple or Google endpoint.
- **Refuse the prompt.** The card goes and never comes back; turning it on in
  Settings, then relaunching, writes the subscription with no tap.
- **Receive.** Another phone adds an entry this one's member is in: within
  seconds of its sync, the group's name over "Ana added …" and the share. A tap
  opens the entry; deleting it opens the group. An edit that moved only the
  title says nothing.
- **Forget the group** on the listening phone, then add another entry: nothing
  arrives.

**The camera** ([receipt-scanning.md](receipt-scanning.md)) — a phone is the
only thing that has one.

- A receipt shot in portrait: EXIF orientation is `createImageBitmap`'s to
  honour and nothing asks it to, so a sideways receipt reaching the model is a
  real find (`lib/scan/downscale.ts`).
- A HEIC picked from the library rather than shot through the camera input.
