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
| **Scanning**    | The Worker composes the request, so a caller picks one of four envelopes it holds and never a word of one, and the scan has a budget — three buckets, a global daily cap, and Turnstile in front of every call ([receipt-scanning.md](receipt-scanning.md#what-the-scan-costs)). Staś mode, off and hidden on `/diag`, swaps the refusal wording for the vicious one ([receipt-scanning.md](receipt-scanning.md#staś-mode)). A phone that pastes its own Gemini key under **Advanced** skips all of that and calls Google directly ([receipt-scanning.md](receipt-scanning.md#a-key-of-your-own)). **A bill can be typed instead of photographed** — "Type it in" on the Items tab, capped at 4,000 characters, kept on the expense, counted against the same budget and read by **its own prompt**: free form, a price per unit or per line, a total only where the bill states one, and almost never a title; that is also the one place a caller's own words reach the shared key, which the owner ruled on knowingly ([receipt-scanning.md](receipt-scanning.md#typing-a-bill-in)). The shared path runs on `gemini-3.1-flash-lite` **via Vertex**, which is where Cloud credit can be spent and which does not train on what it reads; a brought key is an AI Studio one, whose free tier does |
| **Versioned**   | `major.semi.minor` in the root `package.json`, in the corner of the `/about` top bar and the first line of `/diag`. Every push to `dev` deploys, so every push bumps the minor and `pnpm check` insists on it; the major is the owner's alone ([hosting.md](hosting.md#versions))                                                                                                                             |
| **The tip jar** | A FAB on the balances tab opens `/g/tip`, which prices the only paid part of the app and offers to split a donation like any other expense ([product.md](product.md#the-mvp))                                                                                                                                                                                                                                 |
| **Deletable**   | `/delete-my-data` takes an invite link, shows the group it opens, and deletes it from D1 for everybody in it, leaving a tombstone no phone can push past ([frontend.md](frontend.md#deleting-a-group), [sync.md](sync.md#deleting-a-group)). |
| **Installable** | An iPhone joins in the home-screen app rather than a Safari tab that forgets after a week: `/install`, the card on the groups list and on each ledger, the claim screen's link to paste, and an invite whose two halves ride the icon. Android is offered in the same two places, and an in-app browser — a third storage — is refused outright ([ios.md](ios.md)). Works on the owner's iPhone, install and join both (2026-09-18) |
| **Demoable**    | `bida.bid/demo` is a real group of real ops that cannot sync, because it is created without a key ([sync.md](sync.md#the-demo-group-has-no-key)). Linked from nowhere in the app; the URL is the whole door. Four travellers haggling over passage off Tatooine: six entries, one of them split off the bill it was itemised from. A build whose seed reads differently re-seeds the phone rather than reopening the story it was given, since the demo is the pitch and not a group anybody keeps ([frontend.md](frontend.md#routing)). Scanning works there, under this phone's own scan credential rather than the key it has not got. Its one broken thing, Copy invite link, refuses out loud, and **Clear the demo** erases it ([product.md](product.md#the-mvp), [frontend.md](frontend.md#routing)) |
| **Exportable**  | **Export data** in the group menu hands over one CSV in Splitwise's export shape, which is what Tricount imports too ([data-model.md](data-model.md#the-group-as-a-spreadsheet)) — share sheet, then download, then `/g/export` as text ([frontend.md](frontend.md#getting-a-group-off-the-phone)). **Tricount imports it** (2026-09-18), and the share sheet hands the file over from an iOS home-screen app |
| **Importable**  | **Import a group**, in the groups list's kebab, reads a Splitwise (or bida) export back into a **new** group: `core/import.ts` returns a plan, `apps/web/lib/import/csv.ts` is the RFC 4180 reader, `lib/db/commands/import.ts` writes it as one batch ([frontend.md](frontend.md#bringing-a-group-onto-the-phone), [data-model.md](data-model.md#reading-one-back)). The foot row is the checksum and a refusal names the line; single-currency files only. **The round trip is driven** (2026-09-20): a group's own export pasted back makes a keyed, syncable group a second phone joins, balanced to the cent |

## What is open

Two things, and both are watches rather than tasks.

- **A back press the browser will not let us cancel leaves `/new` with
  nothing.** The guard on a screen holding typed work is a *cancelled* press,
  and a browser only allows that while the document holds history-action
  activation — which the previous cancelled press spent. A run of presses with
  no tap between them therefore ends in one that goes through unasked, and
  `/new` is plain React state with no draft behind it, so the typed group is
  gone. ADR-0007 names an uncancellable press as the accepted degradation; that
  was reasoned for a shared link's first press, where there is nothing to lose.
  Closing it means either a draft store for `/new` or absorbing the press
  instead of cancelling it — **an ADR-level call, so it is the owner's**
  ([frontend.md](frontend.md#routing)). The trap it used to sit behind — the
  dialog shut by the platform with the screen still believing it was up, so the
  back button went dead — is fixed and driven. **The first trace back from a
  phone rules this watch out of the report that started it** (1.0.42,
  2026-09-20): every press read `cancelable=true active=true`, and no dialog was
  shut by the platform. **The report that started this watch was a different
  bug entirely, and it is now found and fixed** (1.0.46, 2026-09-20): the
  recorder, extended to cover a dialog's presses, showed three clean clicks on
  Discard with nothing following. `history.go` from an act tapped inside a modal
  dialog is not delivered on Android, so the screen never left — and each of
  those taps armed the latch that tells the app's own traversal from a device
  press, nothing spent it, and the next real press was waved through unguarded.
  The dead button and the vanished group were one cause. Leaving now takes the
  dialog down before it goes, and the latch is spent by the next press anywhere
  ([frontend.md](frontend.md#gotchas)); `pnpm nav` drives both with `history.go`
  stubbed to a no-op. **Taking the card down was not the whole of it** (1.0.48,
  2026-09-20): the next trace showed Discard dead again, and only where the
  dialog had been opened by the device's back button — the same tap from the
  arrow went. A press this app *refuses* leaves Android holding a traversal it
  will not deliver again. `goUp` now checks that its traversal moved and puts
  the parent in this screen's place when it didn't, and `/new` and `/quick`
  stop guarding the way out once Discard is answered, which is what the entry
  form got for free from clearing its draft
  ([frontend.md](frontend.md#gotchas)). **This watch stands on its own terms** —
  a press the browser makes uncancellable still leaves `/new` with nothing, and
  a draft store is what would make that cost a dialog instead of the work.

- **Who holds the lock when an installed phone hangs.** A lock held outside the
  page by another copy of the app frozen mid-transaction. All three cases found
  are fixed and none has recurred since (2026-09-18): a pasted link loading
  `/join` beside the list, so paste now replaces the page; `updateDevice`
  running from a hidden `/join`; and a write broadcasting to a backgrounded copy,
  which opened a readonly transaction on every save. A hidden page now neither
  writes nor reads (`lib/db/visible.ts`), and `/diag` has a `stores:` line so a
  next lock is named rather than cross-read
  ([frontend.md](frontend.md#a-live-read-can-die)). A fourth, found by reading
  the log rather than reported (2026-09-19) and **not fixed**: the 410 branch of
  `syncGroup` erases the group across nine stores before reaching the gate the
  success path waits on, and a 410 lands off the same slow network the gate
  exists for. Nothing checks the writes — `rules-check` enforces `useLive` and
  `goBack`, not `whenVisible`. **Open only as a watch.**

**Two former items here are closed as decisions, not as work** (2026-09-18), so
a session that rediscovers either is rediscovering a call the owner has already
made: **no per-caller counter on `POST /ops`**, because counting callers means
storing a row about each of them ([sync.md](sync.md#the-push-has-a-ceiling)),
and **no hard quota on the Cloud project**, because the owner watches the spend
with alerts of their own ([hosting.md](hosting.md#cost-tripwires)).

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
