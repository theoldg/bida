# Frontend

*For: anyone writing UI, routing, or PWA code.*

Next.js App Router with `output: 'export'`, TypeScript, Tailwind, Dexie.
Components are hand-rolled — no shadcn, no Radix
([ADR-0008](decisions/0008-hand-rolled-interface.md)). **The whole app is
client-side**: no SSR, no server actions, no Next route handlers. The Worker's
API is reached with `fetch`.

## Routing

Only static routes exist — a static export can't generate a page per group id.
Each screen is its own route, with the group id (never the secret) in the query
string ([ADR-0007](decisions/0007-a-screen-is-a-route.md)).
`lib/group-link.ts`'s `route` object is the one place URLs are built.

| Route | Purpose |
|---|---|
| `/` · `/new` | Groups list — the app's name, the light/dark toggle ([ADR-0007](decisions/0007-a-screen-is-a-route.md)), and a row menu holding the invite link and "Forget group" · create a group, everyone in it, in one screen |
| `/g?id=[&tab=]` | The group: ledger / balances tabs. Settling lives under the balances; History, Rates, People and the invite link are top-bar icons |
| `/g/entry?id=&e=[&via=]` | One entry — expense, income or transfer. The id is looked up in both tables ([ADR-0010](decisions/0010-what-an-entry-is.md)). `via=history\|members\|rates` is the screen that linked in from beside it, and is where back goes |
| `/g/entry/edit?id=[&e=][&kind=][&from=&to=&amount=]` | Add or edit any of the three: one form, a segmented control, and the split inline ([ADR-0010](decisions/0010-what-an-entry-is.md)). Settle-up links here with a transfer pre-filled |
| `/g/payers?id=` | Who *put the money in* (or took it in), for co-sponsored entries ([ADR-0010](decisions/0010-what-an-entry-is.md)) |
| `/g/history?id=[&e=][&via=]` | Version history, whole-group or per-entry. Per-entry carries the entry's own `via` so the chain back stays exact |
| `/g/rates?id=` | The group's exchange registry: one row per currency it spends in, each opening the rate dialog. Adding a currency here is the same dialog the entry form opens by itself ([ADR-0005](decisions/0005-money-and-currency.md)) |
| `/g/members?id=` | People: the member list, its check mark saying which of them this phone is, a trash button on everyone else. Adding is the last row of the list; changing identity and forgetting the group are buttons under it. Removing, changing identity and forgetting each ask in a dialog ([ADR-0008](decisions/0008-hand-rolled-interface.md)) |
| `/g/claim?id=` | The last step of joining: pick who you are, then a button into the group |
| `/join#<groupId>.<secret>` | Invite landing: saves the secret, pulls, hands over to `/g/claim` |

**Every `/g` route requires a claimed identity**, via `useClaimGate`
(`lib/hooks.ts`), which sends a phone that hasn't answered "who are you" to
`/g/claim`. An unclaimed device has no honest `actor` to sign an op with, and
every screen under `/g` writes one — so it is an illegal state, not a case to
accommodate. It used to be gated on `/g` alone, and the rest are reachable
without passing through it (a bookmark, the join flow's back arrow, a link
beside a settle-up row): People then offered a trash button on every name, and
the removal it wrote was signed by the person being removed.

**Every `/g` route validates its id.** They all read the group out of the query
string, and a link naming a group this phone doesn't have — a stale bookmark, a
URL shared to somebody who never joined — used to leave the sub-screens holding
a back arrow and nothing else, or spinning forever on `useGroupData(undefined)`.
Each now renders `BadLink` (`components/chrome.tsx`), which says what a proper
invite link is. `/g` itself keeps its gentler "Not found": you are on the group
screen, one id short.

**Back goes up, not back.** A screen's `back` is one of two things and the
device's button agrees with both (`lib/back-button.ts`,
[ADR-0007](decisions/0007-a-screen-is-a-route.md)). A path names a parent, and
`goUp` (`lib/nav.ts`) unwinds the history to it instead of pushing — the button
needs no help here, because with only descending pushing the browser's own back
*is* the arrow; it is taken over only where the arrow skips a level. `{ ask }`
is a screen that would lose typed work: it answers *may I leave?* before
anything is cancelled, and a no cancels the press with the dialog as the whole
of the answer — nothing navigates in its place. An
entry is the one screen whose parent isn't fixed: the history feed and the two
"can't remove this yet" lists link in from beside it, so they pass `via=` and
`entryParent` (`lib/group-link.ts`) sends back there instead of to the group. A
`<Link>` to an ancestor or a sibling must `replace`; only descending pushes.

**The group secret lives in the URL fragment**, which browsers never send to a
server ([ADR-0004](decisions/0004-static-export-and-offline.md)). Never move
it into a path or query string "for convenience". The id alone is fine — it
confers nothing without the secret.

## State

- **Dexie is the store.** Read with `useLiveQuery`. No Redux, no Zustand, no
  server-state library; adding one is an ADR.
  `undefined` from a live query means *not answered yet*, not *empty* — the two
  used to render the same blank. A list screen shows `SkeletonRows` in that
  window and its empty state only once the query has answered.
- Writes go through `lib/db/commands/` — one function per user intent, each
  building an op, appending it and materialising it in one transaction
  (`append.ts`). **Components never write to Dexie directly.** The rule that an
  op carries only what changed is `patch.ts`, once, for both entry editors: it
  was written out at each of them and the two copies drifted.
- Device-local, never-synced state (who "you" are, theme, install-nudge
  dismissal) is in the `device` store. *Changing* who you are is not device-local:
  `claimIdentity` writes an `identity` op
  ([ADR-0003](decisions/0003-link-only-access.md)). `setMe` is the
  device-local half; nothing outside `lib/db/device.ts` should call it.
- **The entry draft is never stored** (`lib/draft.ts`): an in-memory store
  shared by the entry screens, so bouncing to the payers/items routes keeps
  what's typed, and nothing else does. One draft covers all three kinds, which
  is what lets the segmented control change your mind without losing the amount
  you already typed. Leaving asks before discarding, and a reload gets the
  browser's own warning — `seedDraft` records the baseline `isDraftDirty`
  compares against. The payers route asks too, and puts back only the payer
  side: the rest of the draft is not its to throw away. So does who-had-what,
  which has to write a split or merged line through as it happens — its rows
  and the bill's lines are one list — and restores the bill it opened with.
  **What the entry is worth is `draftAmountMinor` and nowhere else** — a
  scanned bill is worth what its lines add up to, and the payers editor
  reading `amountText` on its own is how it came to call one €0.00.
- **Whether the entry may be saved is `checkEntry` (`lib/entry-check.ts`)**,
  not the form. It answers the amount, the base figure, the split in force and
  the one sentence saying why Save is grey — from a draft and the group's
  rates, with no React in it, so the arithmetic behind that button is a test
  suite rather than a screen to mount. The form reads its answers and writes
  none of them.
- **The invite link is `components/invite.tsx`**, written once for the two top
  bars that carry it and the groups list's row menu, which offers it without a
  top bar of its own. `navigator.clipboard.writeText` rejects on an insecure
  context or a denied permission, and used to reject into nothing — an
  inert-looking button, and the link shown nowhere else. A refusal puts the
  link on screen to be read (`InviteFallback`,
  [ADR-0003](decisions/0003-link-only-access.md)).
- **Asking is `components/dialog.tsx`, never `prompt()`/`confirm()`/`<select>`**
  — `ConfirmDialog`, `PromptDialog` and `ChoiceDialog`, which is every picker in
  the app, behind a `.field > .pick` button or a chip. `<input type="date">` is
  the one native control left
  ([ADR-0008](decisions/0008-hand-rolled-interface.md)).
- **Adding people is not a dialog.** `components/name-adder.tsx` is the last row
  of a list of names: Enter files the name and hands the caret back, so a group
  of six is one burst of typing rather than six trips through a scrim. Used on
  `/new`, `/g/members` and `/g/claim`. A dialog is for a decision with a
  consequence to state; it was never right for a list you fill. Living in the
  list costs two rules: **one name, one person** — a name already on it is
  refused as you type (`lib/names.ts`), since a member is only ever drawn as
  their name — and the row **follows the list down**, as a browser scrolls to
  a field only as it takes focus, and this one never lets go
  — clear of the keyboard, per the `--kb` Gotcha below.
- History wording is assembled once, in `lib/history-copy.ts` (`describe`),
  from `copy.history`. It must be **total** — it runs inside a render over
  every patch the log holds, so one throw is a white screen, not a missing line.

## Every word, in `lib/copy.ts`

Screens import `copy` and hold no literal a person can read — `aria-label`,
`placeholder` and `title` included; `pnpm run rules` fails a build that types
one back in ([ADR-0033](decisions/0033-every-word-in-one-file.md)). Say it once
and say it short: the screen already shows the amount, the name and the button,
so the sentence beside them carries only what they can't.

## One navigation

At most one nav bar, at the bottom: **Ledger · Balances** inside a group, and
none outside one — the groups list has a single destination. `Tabs` was deleted
from `components/`; don't bring it back. A screen needing more destinations puts
them behind a top-bar icon, not a second row — three icons is the ceiling.

## Your own money, pulled out of the group's

Always on, not a setting ([ADR-0007](decisions/0007-a-screen-is-a-route.md)),
and it changes rendering only — never data or what syncs. Every row carries a
signed, coloured effect: what you put in for that entry minus what you owe for
it (`myEffect` in `lib/entry-kind.ts`, one subtraction for all three kinds).
The column adds up to the net printed above the list. Rows involving neither
your money nor your share drop to `opacity: .42`. What it looks like and why:
[design-system.md](design-system.md#your-own-rows-are-highlighted).

## PWA

`public/manifest.webmanifest` is linked from `app/layout.tsx`: maskable icons,
`display: fullscreen` (falls back to `standalone`), theme colour per theme. The
three PNGs are the tally wordmark in paper on an ink tile; regenerate them
together if the mark or the ink changes, and the maskable one draws its mark
smaller and unrounded so a circular launcher crop can't clip it. iOS ignores
manifest `display` entirely — `appleWebApp.statusBarStyle:
"black-translucent"` is the equivalent lever, which is why `viewport-fit: cover`
and `env(safe-area-inset-top)` padding on `.topbar` matter.

Installing is also what makes the browser grant `navigator.storage.persist()`
(`lib/persist.ts`, called from `saveGroupKey` and on every start once the phone
holds a group, because the answer changes once the app looks established).
Without it IndexedDB is evictable ([architecture.md](architecture.md#gotchas)),
so the app asks to be installed too. `lib/install.ts` captures
`beforeinstallprompt` at module load — it fires once, early, and only that
object can open the install sheet later — and reduces the situation to
`installed | ready | manual | none`; iOS has no such event, hence `manual`.
`components/install.tsx` puts the nudge at the foot of the groups list, only
once there is a group worth coming back to. "Not now" writes
`device.installDismissedAt` and is never cleared: a banner that returns each
launch is what makes install prompts hated, and the browser's menu still
installs.

`public/sw.js` precaches the whole export — routes, hashed `/_next/static/`
chunks, *and* the `.txt` RSC payloads Next fetches on every in-app tap —
registered from `components/register-sw.tsx`. **It does not cache `/api/*`** —
Dexie is the offline data layer, and a second cache over the same data gives
you two disagreeing sources of truth.

Everything precached is served cache-first, so a launch and every tap after it
paint without waiting on the network. The list and the cache name are stamped in
after the build by `apps/web/scripts/precache.mjs` — nothing to drift, no
`CACHE_VERSION` to bump — and the three things that make cache-first safe are
[ADR-0004](decisions/0004-static-export-and-offline.md). Run `node
scripts/offline-check.mjs` after touching either file: it walks every screen
with the network cut, then installs a deploy over a half-dead network.

## Every money field is `components/amount-input.tsx`

There is exactly one, and **no screen sanitises or formats a typed amount
itself** ([ADR-0005](decisions/0005-money-and-currency.md)).

| Export | For | Value |
|---|---|---|
| `AmountInput` | fields whose model is the typed text | `value` / `onChange(text)` |
| `MinorAmountInput` | fields whose model is minor units | `valueMinor` / `onChangeMinor(n)` |
| `sanitizeAmount(raw, currency)` | what may be typed | pure, tested |
| `groupDigits(canonical)` | `"4800"` → `"4 800"` | pure, tested |

A real `<input inputMode="decimal">`. It sanitises as you type (digits, one
separator — "," and "." both accepted — fraction clipped to the currency's
exponent, leading zeros stripped), **restores the caret** across its own
reformatting, and autofocuses on a *new* expense only. `MinorAmountInput` holds
typed text locally and re-reads the model only on outside change — don't go back
to `value={bare(parseMinor(text))}`, which ate the caret and erased a half-typed
"12.".

The other place with real logic is the **balance bar** (around a centre axis,
debit left, credit right), drawn inline on `/g`'s Balances tab. Everything else
is ordinary markup; what more than one screen draws lives in
`components/chrome.tsx` (the frame, plus `Blank` for a screen still waiting on
Dexie, `Foot` for its one pinned act, `Banner`, `Failure`) and
`components/bits.tsx` (`Avatar` — a *group's* initials — `Card`, `KV`,
`GhostRow`).

**Core says what is wrong; the screen says it in money.** `validateSplit` and
`validatePayers` return `problem` (`"under"`, `"over"`, `"empty"`…) and
`diffMinor`; `shortfallText` in `lib/format.ts` writes "€15.00 left to split".
Never print core's `message` for an amount problem — it is deliberately
figure-free.

## Gotchas

- `output: 'export'` disallows route handlers, `next/image` optimisation, ISR,
  middleware and dynamic params. Needing one is a change to ADR-0004.
- `100dvh`, not `100vh`, or iOS Safari's toolbar eats the bottom nav.
- **The shell takes `height`, not `min-height`.** With `min-height: 100dvh` the
  shell grows past the viewport, the *document* scrolls instead of `.scroll`,
  and the bottom bar sits at the foot of a long page — invisible until you
  scroll. `.app` is `height: 100dvh; overflow: hidden`, `html, body` too, and
  every scrolling child of a flex column needs `min-height: 0`.
- **`dvh` does not shrink for the keyboard.** On iOS the keyboard and its
  accessory bar are drawn *over* the layout viewport, so the shell keeps its
  full height and `.scroll` ends behind them — a field scrolled to that edge,
  by us or by the browser on focus, sits under the strip's buttons. The visual
  viewport is what's left: `components/keyboard-inset.tsx` writes the covered
  strip to `--kb`, and `.scroll` spends `--kb` plus air as both padding and
  `scroll-padding-bottom`. Padding is what a last row can scroll into;
  scroll-padding is where a field mid-form stops. A dialog sits outside the
  shell and pays the same toll: the scrim spends `--kb` as bottom padding, so a
  card is centred in what is left rather than behind the keys — without it the
  rate pair's own fields and Save were under them.
- **A sticky `<thead>` needs a scrollport to stick to.** In a wrapper that only
  scrolls sideways — `overflow-x: auto` makes it the nearest scroll container in
  *both* axes — `position: sticky; top: 0` is inert while the page scrolls past
  it, and looks implemented. The wrapper must own the vertical scroll too, with
  `border-collapse: separate`, or the collapsed border belongs to the table and
  slides out from under the frozen row.
- **Only a real `<dialog>` gets focus for free.** `Dialog` calls `showModal()`,
  so the platform moves the caret in, keeps Tab inside and makes the screen
  behind inert. `RowMenu` is a card anchored to the row it was opened from and
  cannot be one, so it does that by hand: it focuses its first item once it
  has been positioned — a `visibility: hidden` element cannot take focus, and
  `preventScroll`, because a scroll is what closes it — and hands focus back to
  the row on the way out. Without that the long-press menu opened with the
  caret still on the row behind its own veil.
- **A revision's `changes` are only the fields that actually differed.** Saving
  an expense in a new currency at the same rate writes `currency` and no amount
  field at all, so history copy must never read one field because a sibling
  changed.
- **A cancelled back press leaves the browser counting from the entry the
  press was heading for**, not from the screen still on show — for the rest of
  that task, and on a real phone for longer than that. So `history.go(-1)`
  moved *two*: an expense's button reached the groups list, and a group's ran
  off the start of the history, where a traversal that lands nowhere is
  silently dropped and the press appears to do nothing. Hence both halves of
  the fix: don't cancel a press the browser is already getting right, and when
  you must, name the destination entry (`traverseTo`) instead of counting to
  it. A count is only ever as right as the browser's idea of where you are.
  Deferring to a macrotask is not enough on its own, though it is still needed
  — a traversal started while the cancellation unwinds is refused outright.
- **A controlled input that reformats on every keystroke eats the caret.** If a
  field must reformat as you type, it has to restore the selection itself.
- **An input's `size` attribute is not a character count**, it is characters
  times the font's average advance. A field that hugs its own text sizes from a
  hidden mirror (`.amountsizer`), and the input must then be `width: 100%` or
  the column sizes to `size`'s 20-character default.
- **`bare()` is display text; `minorToDecimalString` is canonical text.** Both
  drop the symbol, but `bare` is `Intl`-grouped, so feeding it to an
  `AmountInput`'s `value` or a draft's `amountText` loses money: `parseMinor`
  throws on "1,234.50" (amount silently 0) and reads JPY "25,000" as **25**.
- **`patch()` on the expense draft must merge against the latest saved draft,
  not the `draft` the current render closed over.** A handler that calls
  `patch()` twice synchronously (e.g. switching split tabs: once for the tab,
  once for the converted `SplitSpec`) had the second call overwrite the first
  — both merged onto the same stale closure, so `saveDraft` never saw the
  first change. Fixed by reading `getDraft(groupId)` inside `patch()` itself.
