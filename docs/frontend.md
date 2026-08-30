# Frontend

*For: anyone writing UI, routing, or PWA code.*

Next.js App Router with `output: 'export'`, TypeScript, Tailwind, Dexie.
Components are hand-rolled — no shadcn, no Radix
([ADR-0008](decisions/0008-hand-rolled-css-not-shadcn.md)). **The whole app is
client-side**: no SSR, no server actions, no Next route handlers. The Worker's
API is reached with `fetch`.

## Routing

Only static routes exist — a static export can't generate a page per group id.
Each screen is its own route, with the group id (never the secret) in the query
string ([ADR-0007](decisions/0007-per-screen-routes-not-drawers.md)).
`lib/group-link.ts`'s `route` object is the one place URLs are built.

| Route | Purpose |
|---|---|
| `/` · `/new` | Groups list — the app's name, and the light/dark toggle ([ADR-0026](decisions/0026-the-groups-list-is-the-settings-screen.md)) · create a group |
| `/g?id=[&tab=]` | The group: ledger / balances tabs. Settling lives under the balances; History, People and the invite link are top-bar icons |
| `/g/entry?id=&e=` | One entry — expense, income or transfer. The id is looked up in both tables ([ADR-0028](decisions/0028-three-kinds-of-entry.md)) |
| `/g/entry/edit?id=[&e=][&kind=][&from=&to=&amount=]` | Add or edit any of the three: one form, a segmented control, and the split inline ([ADR-0013](decisions/0013-the-split-editor-is-part-of-the-expense-form.md)). Settle-up links here with a transfer pre-filled |
| `/g/payers?id=` | Who *put the money in* (or took it in), for co-sponsored entries ([ADR-0010](decisions/0010-co-sponsored-expenses.md)) |
| `/g/history?id=[&e=]` | Version history, whole-group or per-entry |
| `/g/members?id=` | People: the member list, where this phone claims which one it is, and every change to it — adding, renaming, removing, leaving — in a dialog ([ADR-0025](decisions/0025-our-own-dialogs.md)) |
| `/g/claim?id=` | The last step of joining: pick who you are, then a button into the group |
| `/join#<groupId>.<secret>` | Invite landing: saves the secret, pulls, hands over to `/g/claim` |

**Back goes up, not back.** A screen's `back` names its parent, and `goUp`
(`lib/nav.ts`) unwinds the history to it instead of pushing, so the device's
back button climbs one level per press
([ADR-0027](decisions/0027-back-goes-up-the-hierarchy.md)). A `<Link>` to an
ancestor or a sibling must `replace`; only descending pushes.

**The group secret lives in the URL fragment**, which browsers never send to a
server ([ADR-0004](decisions/0004-static-export-fragment-routing.md)). Never move
it into a path or query string "for convenience". The id alone is fine — it
confers nothing without the secret.

## State

- **Dexie is the store.** Read with `useLiveQuery`. No Redux, no Zustand, no
  server-state library; adding one is an ADR.
  `undefined` from a live query means *not answered yet*, not *empty* — the two
  used to render the same blank. A list screen shows `SkeletonRows` in that
  window and its empty state only once the query has answered.
- Writes go through `lib/db/commands.ts` — one function per user intent, each
  building an op, appending it and materialising it in one transaction.
  **Components never write to Dexie directly.**
- Device-local, never-synced state (who "you" are, theme, install-nudge
  dismissal) is in the `device` store. *Changing* who you are is not device-local:
  `claimIdentity` writes an `identity` op
  ([ADR-0011](decisions/0011-identity-changes-are-public.md)). `setMe` is the
  device-local half; nothing outside `lib/db/device.ts` should call it.
- **The entry draft is never stored** (`lib/draft.ts`): an in-memory store
  shared by the entry screens, so bouncing to the payers/items routes keeps
  what's typed, and nothing else does. One draft covers all three kinds, which
  is what lets the segmented control change your mind without losing the amount
  you already typed. Leaving asks before discarding, and a reload gets the
  browser's own warning — `seedDraft` records the baseline `isDraftDirty`
  compares against.
- **Asking is `components/dialog.tsx`, never `prompt()`/`confirm()`/`<select>`**:
  a real `<dialog>` with `showModal()`, so focus and Escape are the platform's
  job ([ADR-0025](decisions/0025-our-own-dialogs.md)) — `ConfirmDialog`,
  `PromptDialog` and `ChoiceDialog`, which is every picker in the app — payer,
  currency, a transfer's sides — behind a `.field > .pick` button or a chip.
  `<input type="date">` is the one native control left
  ([ADR-0029](decisions/0029-a-picker-is-a-dialog.md),
  [ADR-0030](decisions/0030-every-picker-is-a-dialog.md)).
- History wording lives once, in `lib/history-copy.ts` (`describe`). It must be
  **total** — it runs inside a render over every patch the log holds, so one
  throw is a white screen, not a missing line.

## One navigation

At most one nav bar, at the bottom: **Ledger · Balances** inside a group, and
none outside one — the groups list has a single destination. `Tabs` was deleted
from `components/`; don't bring it back. A screen needing more destinations puts
them behind a top-bar icon, not a second row — three icons is the ceiling.

## Your own money, pulled out of the group's

Always on, not a setting ([ADR-0026](decisions/0026-the-groups-list-is-the-settings-screen.md)).
It changes rendering only, never data or what syncs:

- **A signed, coloured effect on every row** — `+€45,00` / `−€14,28` — what you
  put in for that entry minus what you owe for it (`myEffect` in
  `lib/entry-kind.ts`, one subtraction for all three kinds), with a matching
  green/red left edge. The column adds up to your net.
- **`opacity: .42`** on entries involving neither your money nor your share.
- **Your position above the list**: net, signed and coloured, with paid and
  share underneath.

Visual reasoning: [design-system.md](design-system.md).

## PWA

In scope for the MVP — build-time icon files, unrelated to receipt hosting.
`public/manifest.webmanifest` is linked from `app/layout.tsx`: maskable icons,
`display: fullscreen` (spec falls back to `standalone`), theme colour per theme.
The three PNGs are the tally wordmark in paper on an ink tile — the same
figure-ground inversion as the FAB. Regenerate them together if the mark or the
ink changes; the maskable one draws its mark smaller and unrounded so a
circular launcher crop can't clip it.
iOS ignores manifest `display` entirely; `appleWebApp.statusBarStyle:
"black-translucent"` is the equivalent lever, which is why `viewport-fit: cover`
and `env(safe-area-inset-top)` padding on `.topbar` matter.

Installing is also what makes the browser grant `navigator.storage.persist()`
— `lib/persist.ts`, called from `saveGroupKey` and on every start once the
phone holds a group, because the answer changes once the app looks established.
Without it IndexedDB is evictable ([architecture.md](architecture.md#gotchas)),
so the app asks to be installed too. `lib/install.ts`
captures `beforeinstallprompt` at module load — it fires once, early, and only
that object can open the install sheet later — and reduces the situation to one
of `installed | ready | manual | none`; iOS has no such event, hence `manual`
(share-sheet instructions). `components/install.tsx` renders it: a nudge at the
foot of the groups list, only once there is a group worth coming back to, and
and nowhere else. "Not now" writes `device.installDismissedAt` and is never
cleared — a banner that returns each launch is what makes install prompts
hated, and the browser's own menu still installs.

`public/sw.js` precaches the whole export — routes, hashed `/_next/static/`
chunks, *and* the `.txt` RSC payloads Next fetches on every in-app tap —
registered from `components/register-sw.tsx`. **It does not cache `/api/*`** —
Dexie is the offline data layer, and a second cache over the same data gives
you two disagreeing sources of truth.

Everything precached is served cache-first, so a launch and every tap after it
paint without waiting on the network — the reasoning, and the three things that
make it safe, are
[ADR-0024](decisions/0024-precache-the-whole-export-cache-first.md). In short:
the list and the cache name are stamped in after the build by
`apps/web/scripts/precache.mjs` (nothing to drift, no `CACHE_VERSION` to bump);
the worker does not `skipWaiting`, so a deploy takes over on the next launch
rather than deleting the running build under an open page; and a *document*
request for a `.txt` is answered with that route's shell.

`node scripts/offline-check.mjs` walks every screen with the network cut and
then installs a deploy over a half-dead network, against the real export. Run it
after touching either file.

## Every money field is `components/amount-input.tsx`

There is exactly one, and **no screen sanitises or formats a typed amount
itself** ([ADR-0015](decisions/0015-one-money-field-core-reports-numbers.md)).

| Export | For | Value |
|---|---|---|
| `AmountInput` | fields whose model is the typed text | `value` / `onChange(text)` |
| `MinorAmountInput` | fields whose model is minor units | `valueMinor` / `onChangeMinor(n)` |
| `sanitizeAmount(raw, currency)` | what may be typed | pure, tested |
| `groupDigits(canonical)` | `"4800"` → `"4 800"` | pure, tested |

A real `<input inputMode="decimal">`. It sanitises as you type (digits, one
separator — "," and "." both accepted — fraction clipped to the currency's
exponent, leading zeros stripped), **restores the caret** across its own
reformatting via a `useLayoutEffect` that counts significant characters before
it, wears `.amountfield`'s underline so it looks like a field, and autofocuses
on a *new* expense only. `MinorAmountInput` holds typed text locally and
re-reads the model only on outside change — don't go back to
`value={bare(parseMinor(text))}`, which ate the caret and erased a half-typed
"12.".

The other place with real logic is the **balance bar** (a bar around a centre
axis, debit left, credit right), drawn inline on `/g`'s Balances tab.
Everything else is ordinary markup; what more than one screen
draws lives in `components/chrome.tsx` (the frame, plus `Blank` for a screen
still waiting on Dexie, `Foot` for its one pinned act, `Banner`, `Failure`) and
`components/bits.tsx` (`Avatar` — a *group's* initials, ADR-0032 — `Card`, `KV`, `GhostRow`). What the three
kinds of entry are *called* — labels, verbs, headings — lives only in
`lib/entry-kind.ts`.

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
- **A sticky `<thead>` needs a scrollport to stick to.** In a wrapper that only
  scrolls sideways — `overflow-x: auto` makes it the nearest scroll container in
  *both* axes — `position: sticky; top: 0` is inert while the page scrolls past
  it, and looks implemented. The wrapper must own the vertical scroll too, with
  `border-collapse: separate`, or the collapsed border belongs to the table and
  slides out from under the frozen row.
- **A revision's `changes` are only the fields that actually differed.** Saving
  an expense in a new currency at the same rate writes `currency` and no amount
  field at all, so history copy must never read one field because a sibling
  changed.
- **A controlled input that reformats on every keystroke eats the caret.** If a
  field must reformat as you type, it has to restore the selection itself.
- **An input's `size` attribute is not a character count**, it is characters
  times the font's average advance. A field that hugs its own text sizes from a
  hidden mirror (`.amountsizer`), and the input must then be `width: 100%` or
  the column sizes to `size`'s 20-character default.
- **The typed grouping separator is U+202F**, a narrow no-break space, because
  the field accepts both "," and "." as decimal separators. It deliberately
  doesn't match `Intl`'s grouping in saved figures.
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
