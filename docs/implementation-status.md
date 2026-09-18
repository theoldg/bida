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
| **Demoable**    | `bida.bid/demo` is a real group of real ops that cannot sync, because it is created without a key ([sync.md](sync.md#the-demo-group-has-no-key)). Linked from nowhere in the app; the URL is the whole door. Six entries, one of them split off the bill it was itemised from. Its one broken thing, Copy invite link, refuses out loud, and **Clear the demo** erases it ([product.md](product.md#the-mvp), [frontend.md](frontend.md#routing)) |
| **Exportable**  | **Export data** in the group menu hands over one CSV in Splitwise's export shape, which is what Tricount imports too ([data-model.md](data-model.md#the-group-as-a-spreadsheet)) — share sheet, then download, then `/g/export` as text ([frontend.md](frontend.md#getting-a-group-off-the-phone)). **Tricount imports it** (2026-09-18), and the share sheet hands the file over from an iOS home-screen app |
| **Importable**  | **Import a group**, in the groups list's kebab, reads a Splitwise (or bida) export back into a **new** group: `core/import.ts` returns a plan, `apps/web/lib/import/csv.ts` is the RFC 4180 reader, `lib/db/commands/import.ts` writes it as one batch ([frontend.md](frontend.md#bringing-a-group-onto-the-phone), [data-model.md](data-model.md#reading-one-back)). The foot row is the checksum and a refusal names the line; single-currency files only |

## What is open

None of these is started, and the first is not code at all.

- **A hard quota on the Cloud project**, just above `SCAN_LIMITS.global` — the
  belt under our own counter's braces. Only the owner can set it, in the
  console, and a Cloud *budget* is not it: budgets alert, they do not stop
  ([hosting.md](hosting.md#gotchas)).
- **The hosted service has no liability line.** `/about` says what the server
  sees, names the scan as the exception, and now prints `/delete-my-data`'s address, unlinked; this
  is the rest of it, and it is the most overdue item here: the repo is public
  **and the app is being advertised to users online**, so the people keeping
  ledgers in it are strangers rather than friends who would ask
  ([hosting.md](hosting.md)).
- **`POST /ops` has no counter.** One push is now bounded — 16 MB, 5 000 ops,
  256 KB per op, all `413` ([sync.md](sync.md#the-push-has-a-ceiling)) — so no
  single call can spend the day's D1 writes or a visible slice of the 500 MB.
  What is left is the harder half: it still registers any unseen group id, and
  nothing counts pushes across requests, so a flood of well-formed ones is
  unanswered. A bucket per caller like the scan's (`scan-limits.ts`) is the
  cheap version; giving credential-minting its own door is the real one.
- **Who holds the lock when an installed phone hangs.** A lock held outside the
  page by another copy of the app frozen mid-transaction. All three cases found
  are fixed and none has recurred since (2026-09-18): a pasted link loading
  `/join` beside the list, so paste now replaces the page; `updateDevice`
  running from a hidden `/join`; and a write broadcasting to a backgrounded copy,
  which opened a readonly transaction on every save. A hidden page now neither
  writes nor reads (`lib/db/visible.ts`), and `/diag` has a `stores:` line so a
  next lock is named rather than cross-read
  ([frontend.md](frontend.md#a-live-read-can-die)). **Open only as a watch.**

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
