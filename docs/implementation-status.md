# Implementation status

*For: an agent starting a cold session. Where the project stands, and the next
thing to do. Everything here is a pointer — the doc that owns a subject
describes it, and this file says only where we stand against it. **It is not a
log of what sessions built.** Update it in the same commit as the code.*

## Where it stands

**The app is built, deployed and in use.** Nothing is queued: what is not built
was cut rather than postponed — receipt photo storage and categories are seams
in [product.md](product.md#deliberately-not-in-the-mvp), not work in progress.

|                 |                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Production**  | <https://bida.bid> — one Worker serving the static export *and* the sync API, backed by the `hajsik` D1 ([hosting.md](hosting.md))                                                                                                                                                                                                                                                                            |
| **Dev**         | <https://hajsik-dev.hajsik-api.workers.dev>, its own D1 and scan secrets, deployed by every push to `dev` — the branch sessions push to. Production moves only when the owner releases ([hosting.md](hosting.md#dev-and-production))                                                                                                                                                                          |
| **Sealed**      | The server cannot read a group ([ADR-0036](decisions/0036-the-server-cannot-read-a-group.md)). The D1 log is finished data: a schema change from here is a new numbered migration ([hosting.md](hosting.md#a-schema-change-from-here-on))                                                                                                                                                                     |
| **Scanning**    | The Worker composes the request, so the shared Gemini key cannot be handed someone's prompt, and the scan has a budget — three buckets, a global daily cap, and Turnstile in front of every call ([receipt-scanning.md](receipt-scanning.md#what-the-scan-costs)). Staś mode, off and hidden on `/diag`, swaps the refusal wording for the vicious one ([receipt-scanning.md](receipt-scanning.md#staś-mode)). A phone that pastes its own Gemini key under **Advanced** skips all of that and calls Google directly ([receipt-scanning.md](receipt-scanning.md#a-key-of-your-own)). The shared path runs on `gemini-3.1-flash-lite` **via Vertex**, which is where Cloud credit can be spent and which does not train on what it reads; a brought key is an AI Studio one, whose free tier does |
| **Versioned**   | `major.semi.minor` in the root `package.json`, in the corner of the `/about` top bar and the first line of `/diag`. Every push to `dev` deploys, so every push bumps the minor and `pnpm check` insists on it; the major is the owner's alone ([hosting.md](hosting.md#versions))                                                                                                                             |
| **The tip jar** | A FAB on the balances tab opens `/g/tip`, which prices the only paid part of the app and offers to split a donation like any other expense ([product.md](product.md#the-mvp))                                                                                                                                                                                                                                 |
| **Deletable**   | `/delete-my-data` takes an invite link, shows the group it opens, and deletes it from D1 for everybody in it, leaving a tombstone no phone can push past ([frontend.md](frontend.md#deleting-a-group), [sync.md](sync.md#deleting-a-group)). |
| **Installable** | An iPhone joins in the home-screen app rather than a Safari tab that forgets after a week: `/install`, the card on the groups list and on each ledger, the claim screen's link to paste, and an invite whose two halves ride the icon. Android is offered in the same two places, and an in-app browser — a third storage — is refused outright ([ios.md](ios.md)). Works on the owner's iPhone, install and join both (2026-09-18) |
| **Exportable**  | **Export data** in the group menu hands over one CSV in Splitwise's export shape, which is what Tricount imports too ([data-model.md](data-model.md#the-group-as-a-spreadsheet)) — share sheet, then download, then `/g/export` as text ([frontend.md](frontend.md#getting-a-group-off-the-phone)). The bytes are pinned against a real export's shape, and the share sheet hands the file over from an iOS home-screen app. **Tricount still refuses the file** — see the open list |

## What is open

None of these is started, and the first is not code at all.

- **A hard quota on the Cloud project**, just above `SCAN_LIMITS.global` — the
  belt under our own counter's braces. Only the owner can set it, in the
  console, and a Cloud *budget* is not it: budgets alert, they do not stop
  ([hosting.md](hosting.md#gotchas)).
- **The hosted service has no liability line.** `/about` says what the server
  sees, names the scan as the exception, and now prints `/delete-my-data`'s address, unlinked; this
  is the rest of it, and the repo being public makes it due.
- **`POST /ops` has no budget.** It registers any unseen group id and writes
  unbounded ops into a D1 that gets no further resets — the only door in the app
  with no ceiling on it ([sync.md](sync.md)). Giving credential-minting its own
  door is the shape of the fix.
- **Who holds the lock when an installed phone hangs.** A lock held outside the
  page by another copy of the app frozen mid-transaction. All three cases found
  are fixed and none has recurred since (2026-09-18): a pasted link loading
  `/join` beside the list, so paste now replaces the page; `updateDevice`
  running from a hidden `/join`; and a write broadcasting to a backgrounded copy,
  which opened a readonly transaction on every save. A hidden page now neither
  writes nor reads (`lib/db/visible.ts`), and `/diag` has a `stores:` line so a
  next lock is named rather than cross-read
  ([frontend.md](frontend.md#a-live-read-can-die)). **Open only as a watch.**
- **Tricount refuses the exported CSV.** The bytes were fixed on 2026-09-18 —
  LF, the blank line under the header, the blank line above the foot, the foot
  dated with spaces where the category and cost would be — and each of those is
  confirmed against what real Splitwise exports carry and what importers built
  on them skip. Tricount still refuses the file whole, so the fault is not the
  shape ([data-model.md](data-model.md#the-group-as-a-spreadsheet)).
  **Next: the refused file itself and whatever Tricount said about it** — until
  one of those is in hand every further byte is a guess, and this one has been
  guessed at once already. The suspects worth carrying into that look are the
  three rows a Splitwise reader cannot represent: an income's negative `Cost`,
  a transfer, and an expense with more than one payer, which is more than one
  positive column and which every importer read so far skips outright.
- **Importing a Splitwise CSV**, into a new group only, from the groups list's
  menu. The shape is what `core/export.ts` writes, read backwards
  ([data-model.md](data-model.md#the-group-as-a-spreadsheet)), and the one part
  that is not a mirror is that **a member's column is `paid − owed`, which does
  not invert**: `(+20, −10, −10)` at a cost of 30 is "A paid 30, split three
  ways" and half a dozen other entries equally. So it is a stated rule, not a
  recovery. One positive column — every file Splitwise itself writes — is
  lossless: that member paid the whole cost, and the split is `exact` with
  `owed = paid − delta`. Several positive columns are the payers, at
  `paidᵢ = deltaᵢ × cost / Σ positive`, which can never send an `owed` negative
  and reproduces every balance to the cent while the payer figures are a guess.
  The foot row `Total balance` is the checksum: fold, `computeBalances`, refuse
  on a mismatch. Settled with it: the category folds into the title because we
  have none, a transfer is the `Payment` token plus a few keywords and nothing
  cleverer, an income arrives as the negative `Cost` our own writer already
  emits, and the CSV package lives in `apps/web` so `packages/core` stays
  dependency-free and takes rows. **Open: single-currency files only.** A mixed
  one needs a rate per currency that the file cannot supply, and its foot sums
  across currencies, so the checksum is gone exactly where the import is least
  sure — v1 refuses it and names the codes it found.

## What a cold session needs to know

A shared-expense ledger with no accounts: a group is a secret link, every change
is an appended op, and money is integer minor units. The five non-negotiables in
[CLAUDE.md](../CLAUDE.md#non-negotiables) are worth reading twice; past that, go
to the doc for your task — [docs/README.md](README.md) is the index.

Three things surprise people who assume otherwise:

- **What a foreign amount is worth belongs to the group, not the entry.** One
  rate per currency, synced as an op; `atCurrentRates` values the whole ledger
  in one pass where state is read, so correcting a rate moves every entry
  already written in that currency
  ([ADR-0005](decisions/0005-money-and-currency.md)).
- **An entry is merged whole, a member or rate per field.** An expense op
  carries the entity as its saver saw it, so an amount can never sit beside
  another phone's split; `deletedAt` and `createdAt` are the exceptions that
  keep the healers working ([sync.md](sync.md#the-operation)).
- **History is read, never rewound.** The `restore` op kind still folds only
  because production groups hold some
  ([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md)).
