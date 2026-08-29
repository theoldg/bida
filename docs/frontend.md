# Frontend

*For: anyone writing UI, routing, or PWA code.*

Next.js App Router with `output: 'export'`, TypeScript, Tailwind, Dexie.
Components are hand-rolled from the mockup's HTML and CSS — no shadcn, no Radix
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
| `/` · `/new` | Groups list · create a group |
| `/g?id=[&tab=]` | The group: expenses / balances tabs. Settling lives under the balances; History, People and the invite link are top-bar icons |
| `/g/expense?id=&e=` | Expense detail |
| `/g/expense/edit?id=[&e=]` | Add or edit an expense — **including the split**, inline ([ADR-0013](decisions/0013-the-split-editor-is-part-of-the-expense-form.md)) |
| `/g/payers?id=` | Who *put the money in*, for co-sponsored expenses ([ADR-0010](decisions/0010-co-sponsored-expenses.md)) |
| `/g/history?id=[&e=]` | Version history, whole-group or per-expense |
| `/g/restore?id=&kind=&e=&at=` | Confirms a restore: the version and the fields coming back |
| `/g/members?id=` | People: the member list, and where this phone claims which one it is |
| `/g/leave?id=` | Confirms leaving the group — deletes it instead, if you're the last member |
| `/g/claim?id=` | The last step of joining: pick who you are, then a button into the group |
| `/g/settle?id=&from=&to=&amount=` | Record a settlement |
| `/join#<groupId>.<secret>` | Invite landing: saves the secret, pulls, hands over to `/g/claim` |
| `/settings` | Personal mode, theme. From the group *list* ([ADR-0014](decisions/0014-settings-belong-to-the-phone.md)) |

**The group secret lives in the URL fragment**, which browsers never send to a
server ([ADR-0004](decisions/0004-static-export-fragment-routing.md)). Never move
it into a path or query string "for convenience". The id alone is fine — it
confers nothing without the secret.

## State

- **Dexie is the store.** Read with `useLiveQuery`. No Redux, no Zustand, no
  server-state library; adding one is an ADR.
- Writes go through `lib/db/commands.ts` — one function per user intent, each
  building an op, appending it and materialising it in one transaction.
  **Components never write to Dexie directly.**
- Device-local, never-synced state (who "you" are, personal mode, theme,
  install-nudge dismissal) is in
  the `device` store. *Changing* who you are is not device-local:
  `claimIdentity` writes an `identity` op
  ([ADR-0011](decisions/0011-identity-changes-are-public.md)). `setMe` is the
  device-local half; nothing outside `lib/db/device.ts` should call it.
- History wording lives once, in `lib/history-copy.ts` (`describe`,
  `fieldLabel`, `fieldValue`), read by both the feed and `/g/restore`. All three
  must be **total** — they run inside a render over every patch the log holds,
  so one throw is a white screen, not a missing line.

## One navigation

Exactly one nav bar, at the bottom: **Groups · Settings** outside a group,
**Expenses · Balances** inside one. `Tabs` was deleted from `components/`; don't
bring it back. A screen needing more destinations puts them behind a top-bar
icon, not a second row — three icons is the ceiling.

## Personal mode

A device boolean read through `usePersonalMode`, on by default. It changes
rendering only, never data or what syncs:

- **A signed, coloured effect on every row** — `+€45,00` / `−€14,28` — what you
  put in for that entry minus what you owe for it, with a matching green/red
  left edge. Settlements included, so the column adds up to your net.
- **`opacity: .42`** on entries involving neither your money nor your share.
- **Your position above the list**: net, signed and coloured, with paid and
  share underneath.

Visual reasoning: [design-system.md](design-system.md).

## PWA

In scope for the MVP — build-time icon files, unrelated to receipt hosting.
`public/manifest.webmanifest` is linked from `app/layout.tsx`: maskable icons,
`display: fullscreen` (spec falls back to `standalone`), theme colour per theme.
iOS ignores manifest `display` entirely; `appleWebApp.statusBarStyle:
"black-translucent"` is the equivalent lever, which is why `viewport-fit: cover`
and `env(safe-area-inset-top)` padding on `.topbar` matter.

Installing also protects IndexedDB from eviction
([architecture.md](architecture.md#gotchas)), so the app asks. `lib/install.ts`
captures `beforeinstallprompt` at module load — it fires once, early, and only
that object can open the install sheet later — and reduces the situation to one
of `installed | ready | manual | none`; iOS has no such event, hence `manual`
(share-sheet instructions). `components/install.tsx` renders it: a nudge at the
foot of the groups list, only once there is a group worth coming back to, and
the same offer permanently in Settings. "Not now" writes
`device.installDismissedAt` and is never cleared — a banner that returns each
launch is what makes install prompts hated; Settings is where it lives after
that.

`public/sw.js` precaches the app shell (every static route, plus manifest and
icons), registered from `components/register-sw.tsx`. **It does not cache
`/api/*`** — Dexie is the offline data layer, and a second cache over the same
data gives you two disagreeing sources of truth. Pages network-first with a
cache fallback; hashed `/_next/static/` cache-first. Bump `CACHE_VERSION` by
hand whenever caching behaviour changes.

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

The other component with real logic is the **balance bar** (a bar around a
centre axis, debit left, credit right) in `components/bits.tsx`. Everything else
is markup lifted from the mockup.

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
- **A revision's `changes` are only the fields that actually differed.** Saving
  an expense in a new currency at the same rate writes `currency` and no amount
  field at all, so history copy must never read one field because a sibling
  changed.
- **A controlled input that reformats on every keystroke eats the caret.** If a
  field must reformat as you type, it has to restore the selection itself.
- **A placeholder is not a default value.** Seeding `amountText: "0"` means
  tapping in and typing 5 gives you "50".
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
