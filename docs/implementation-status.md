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
| **Scanning**    | The Worker composes the request, so a caller picks one of four envelopes it holds and never a word of one, and the scan has a budget — three buckets, a global daily cap, and Turnstile in front of every call ([receipt-scanning.md](receipt-scanning.md#what-the-scan-costs)). Staś mode, off and hidden on `/diag`, swaps the refusal wording for the vicious one ([receipt-scanning.md](receipt-scanning.md#staś-mode)). **A bill reads in the language it was printed in**, with the translation icon on the who-had-what bar switching every line — grid, entry screen and quick-split text — to the English the scan already returned, and absent on a bill printed in English; remembered per phone ([ADR-0016](decisions/0016-receipts.md)). A phone that pastes its own Gemini key under **Advanced** skips all of that and calls Google directly ([receipt-scanning.md](receipt-scanning.md#a-key-of-your-own)). **A bill can be typed instead of photographed** — "Type it in" on the Items tab, capped at 4,000 characters, kept on the expense, counted against the same budget and read by **its own prompt**: free form, a price per unit or per line, a total only where the bill states one, and almost never a title; that is also the one place a caller's own words reach the shared key, which the owner ruled on knowingly ([receipt-scanning.md](receipt-scanning.md#typing-a-bill-in)). The shared path runs on `gemini-3.1-flash-lite` **via Vertex**, which is where Cloud credit can be spent and which does not train on what it reads; a brought key is an AI Studio one, whose free tier does |
| **Versioned**   | `major.semi.minor` in the root `package.json`, in the corner of the `/about` top bar and the first line of `/diag`. Every push to `dev` deploys, so every push bumps the minor and `pnpm check` insists on it; the major is the owner's alone ([hosting.md](hosting.md#versions))                                                                                                                             |
| **The tip jar** | A FAB on the balances tab opens `/g/tip`, which prices the only paid part of the app and offers to split a donation like any other expense ([product.md](product.md#the-mvp)). `/tip` is the same jar with no group behind it, linked from `/about`'s guarantees section                                                                                                                                    |
| **Deletable**   | `/delete-my-data` takes an invite link, shows the group it opens, and deletes it from D1 for everybody in it, leaving a tombstone no phone can push past ([frontend.md](frontend.md#deleting-a-group), [sync.md](sync.md#deleting-a-group)). |
| **Installable** | An iPhone joins in the home-screen app rather than a Safari tab that forgets after a week: `/install`, the card on the groups list and on each real group's ledger, the claim screen's link to paste, and an invite whose two halves ride the icon. Android is offered in the same two places, and an in-app browser — a third storage — is refused outright ([ios.md](ios.md)). Install and join both work on a real iPhone, from any page, names included. An invite pasted into Messenger arrives whole as long as the layout carries no `og:url` ([frontend.md](frontend.md#pwa)) |
| **Demoable**    | `bida.bid/demo` is a real group of real ops that cannot sync, because it is created without a key ([sync.md](sync.md#the-demo-group-has-no-key)). Linked from nowhere in the app; the URL is the whole door. Four travellers haggling over passage off Tatooine: six entries, one of them split off the bill it was itemised from. A build whose seed reads differently re-seeds the phone rather than reopening the story it was given, since the demo is the pitch and not a group anybody keeps ([frontend.md](frontend.md#routing)). Scanning works there, under this phone's own scan credential rather than the key it has not got. Its one broken thing, Copy invite link, refuses out loud, and **Clear the demo** erases it ([product.md](product.md#the-mvp), [frontend.md](frontend.md#routing)) |
| **Exportable**  | **Export data** in the group menu hands over one CSV in Splitwise's export shape, which is what Tricount imports too ([data-model.md](data-model.md#the-group-as-a-spreadsheet)) — share sheet, then download, then `/g/export` as text ([frontend.md](frontend.md#getting-a-group-off-the-phone)). **Tricount imports it**, and the share sheet hands the file over from an iOS home-screen app |
| **Importable**  | **Import a group**, in the groups list's kebab, reads somebody else's ledger into a **new** group, from two sources landing in one `ImportPlan` ([frontend.md](frontend.md#bringing-a-group-onto-the-phone)). A Splitwise (or bida) export, chosen as a file: `core/import.ts` returns the plan, `apps/web/lib/import/csv.ts` is the RFC 4180 reader, the foot row is the checksum ([data-model.md](data-model.md#reading-one-back)). Or **a Tricount link**, which Tricount gives no export button for: `core/tricount.ts` reads the JSON its own app asks for, fetched through `POST /api/tricount` because the browser cannot make that call — which the screen says under the button, being the one thing in the app that leaves the phone readable — and checksummed against balances recomputed the app's own way ([data-model.md](data-model.md#reading-a-tricount-back)). `lib/db/commands/import.ts` writes either as one batch. A refusal names the line, or the entry; single-currency only. **The CSV round trip is driven**: a group's own export read back makes a keyed, syncable group a second phone joins, balanced to the cent. **A real Tricount link works**, so the handshake in `apps/api/src/tricount.ts` is right as written; what could still move under it is bunq's, not ours |

## What is open

Two things: a gap found by reading the code rather than a report, and a
design waiting to be built.

- **The 410 branch of `syncGroup` writes while hidden.** A deleted group is
  erased across nine stores before reaching the gate the success path waits on,
  and a 410 lands off the same slow network the gate exists for — so it is the
  one write left that can strand a lock the whole origin then queues behind
  ([frontend.md](frontend.md#a-live-read-can-die)). Nothing catches it:
  `rules-check` enforces `useLive` and `goBack`, not `whenVisible`.

- **Push notifications are half-built** — the decision, the wording and an
  eight-step plan are in [notifications.md](notifications.md). Steps 1–7 (core: `push` on identity,
  `webpush.ts`, `notify.ts`; the Worker's relay; subscribing, offered by the
  installed app's card; sending; leaving) are in, unproven on a phone. Its
  VAPID keys are set on both Workers. Next is step 8, the docs and ADR-0037.

**Three things are closed as decisions, not as work**, so a session that
rediscovers one is rediscovering a call the owner has already made:
**no per-caller counter on `POST /ops`**, because counting callers means
storing a row about each of them ([sync.md](sync.md#the-push-has-a-ceiling));
**no hard quota on the Cloud project**, because the owner watches the spend
with alerts of their own ([hosting.md](hosting.md#cost-tripwires)); and **an
uncancellable back press is behaviour, not a bug** — *"if someone does back 3x
in a row without interacting with the page they deserve to be let out"* (the
owner). So `/new` and `/quick` get no draft store and the press is
not absorbed; a run of presses with no tap between them ends in one that leaves
unasked, and losing what was typed is the price of the platform's own promise
that a page cannot trap you ([ADR-0007](decisions/0007-a-screen-is-a-route.md)).

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
- **History is read, never rewound.** The `restore` op kind folds only
  because production groups hold some
  ([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md)).
