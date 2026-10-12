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
| **Scanning**    | The Worker composes the request, so a caller picks one of four envelopes it holds and never a word of one, and the scan has a budget — three buckets, a global daily cap, and Turnstile in front of every call ([scan-worker.md](scan-worker.md#what-the-scan-costs)). The phone straightens and crops a photo to the bill with an ML corner detector, then caps it at a megapixel ([scan-worker.md](scan-worker.md#cropping-to-the-bill)); `/diag/crop` shows its work. Staś mode, off and hidden on `/diag`, swaps the refusal wording for the vicious one ([scan-worker.md](scan-worker.md#staś-mode)). **A bill reads in the language it was printed in**, with the translation icon on the who-had-what bar switching every line — grid, entry screen and quick-split text — to the English the scan already returned, and absent on a bill printed in English; saved with the expense, so every phone reads it alike ([ADR-0016](decisions/0016-receipts.md)). A phone that pastes its own Gemini key under **Advanced** skips all of that and calls Google directly ([scan-worker.md](scan-worker.md#a-key-of-your-own)). **A bill can be typed instead of photographed** — "Type" on the Items tab ("As text" once a bill is read), capped at 4,000 characters, kept on the expense — where a photographed bill writes its reading too, in English, so the box opens on it for correcting — counted against the same budget and read by **its own prompt**: free form, a price per unit or per line, a total only where the bill states one, and almost never a title; that is also the one place a caller's own words reach the shared key, which the owner ruled on knowingly ([receipt-scanning.md](receipt-scanning.md#typing-a-bill-in)). The shared path runs on `gemini-3.1-flash-lite` **via Vertex**, which is where Cloud credit can be spent and which does not train on what it reads; a brought key is an AI Studio one, whose free tier does |
| **Versioned**   | `major.semi.minor` in the root `package.json`, in the corner of the `/about` top bar, Settings › Version and the first line of `/diag`. Every push to `dev` deploys, so every push bumps the minor and `pnpm check` insists on it; the major is the owner's alone ([hosting.md](hosting.md#versions))                                                                                                                             |
| **The tip jar** | A FAB on the balances screen opens `/g/tip`, which prices the only paid part of the app and offers to split a donation like any other expense ([product.md](product.md#the-mvp)). `/tip` is the same jar with no group behind it, linked from `/about`'s guarantees section                                                                                                                                    |
| **Deletable**   | `/delete-my-data` takes an invite link, shows the group it opens, and deletes it from D1 for everybody in it, leaving a tombstone no phone can push past ([import-export.md](import-export.md#deleting-a-group), [sync.md](sync.md#deleting-a-group)). |
| **Searchable**  | The ledger has a search bar, out as the you-owe card scrolls away, over titles, people, currency, kind and figures, sectioned by where the words were found ([frontend.md](frontend.md)) |
| **Installable** | An iPhone joins in the home-screen app rather than a Safari tab that forgets after a week: `/install`, the card on the groups list and on each real group's ledger, the claim screen's link to paste, and an invite whose two halves ride the icon. Android is offered in the same two places, and an in-app browser — a third storage — is refused outright ([ios.md](ios.md)). Install and join both work on a real iPhone, from any page, names included. An invite pasted into Messenger arrives whole as long as the layout carries no `og:url` ([pwa.md](pwa.md)) |
| **Demoable**    | `bida.bid/demo` is a real group of real ops that cannot sync, because it is created without a key ([sync.md](sync.md#the-demo-group-has-no-key)). Linked from nowhere in the app; the URL is the whole door. Four travellers haggling over passage off Tatooine, and the visitor first picks which one they are: six entries, one of them split off the bill it was itemised from. A build whose seed reads differently re-seeds the phone rather than reopening the story it was given, since the demo is the pitch and not a group anybody keeps ([navigation.md](navigation.md#routing)). Scanning works there, under this phone's own scan credential rather than the key it has not got. Its one broken thing, Copy invite link, refuses out loud, and **Clear the demo** erases it ([product.md](product.md#the-mvp), [navigation.md](navigation.md#routing)) |
| **Exportable**  | **Export data** in the group menu hands over one CSV in Splitwise's export shape, which is what Tricount imports too ([data-model.md](data-model.md#the-group-as-a-spreadsheet)) — share sheet, then download, then `/g/export` as text ([import-export.md](import-export.md#getting-a-group-off-the-phone)). **Tricount imports it**, and the share sheet hands the file over from an iOS home-screen app |
| **Importable**  | **Import a group**, in the groups list's kebab, reads somebody else's ledger into a **new** group, from two sources landing in one `ImportPlan` ([import-export.md](import-export.md#bringing-a-group-onto-the-phone)). A Splitwise (or bida) export, chosen as a file: `core/import.ts` returns the plan, `apps/web/lib/import/csv.ts` is the RFC 4180 reader, the foot row is the checksum ([data-model.md](data-model.md#reading-one-back)). Or **a Tricount link**, which Tricount gives no export button for: `core/tricount.ts` reads the JSON its own app asks for, fetched through `POST /api/tricount` because the browser cannot make that call — which the screen says under the button, being the one thing in the app that leaves the phone readable — and checksummed against balances recomputed the app's own way ([data-model.md](data-model.md#reading-a-tricount-back)). `lib/db/commands/import.ts` writes either as one batch. A refusal names the line, or the entry. A CSV may mix currencies, one `Total balance` row each, the rest priced at each row's day's rate when the group is created; a tricount's entries keep the currency they were spent in, and either writes Evenly or Parts wherever that lands every cent where the source did ([data-model.md](data-model.md#writing-a-plan)). **The CSV round trip is driven**: a group's own export read back makes a keyed, syncable group a second phone joins, balanced to the cent. **A real Tricount link works**, so the handshake in `apps/api/src/tricount.ts` is right as written; what could still move under it is bunq's, not ours |

## What is open

One thing: push notifications, built and unchecked on a phone. The visual review is closed
([design-review.md](design-review.md)).

- **Push notifications are built and work on dev**
  ([notifications.md](notifications.md), ADR-0037): an edit from an incognito
  tab reached the owner's installed app (2026-09-23). The rest of the phone
  checklist in [on-a-phone.md](on-a-phone.md) is unrun.
  VAPID keys are set on both Workers. A notification also pulls its group
  ahead ([sync.md](sync.md#the-pull-ahead)), untried on a phone — `/diag`'s
  `pull ahead:` lines now say whether it ran. Settings' Off · Just me · All
  is built; All is untried on a phone.

### Found by the audit of 2026-10-11, not yet fixed

A read of the hundred commits to 1.3.65; each item names where to start. Delete
a line in the push that fixes it.

- **Smaller.** Two folds closing within one glide leave padding under the list
  (`lib/fold.ts:52-61`). An icon launch
  whose `/install` fragment still has a key to save paints the ledger skeleton,
  then the list (`firstFrame`). Parts typed beside a bill between 0336c2a9
  and 97037e75 carry no flag and open on Items.
- **Rules.** `effectSum` (`lib/entry-kind.ts:57-60`, and the older `myEffect`)
  signs an income outside `computeBalances`. The bill-pricing rule in
  `rules-check.mjs:89-100` bans `weightsFromItems`, which nothing calls, while
  `receiptBreakdown` is called from `app/g/entry/page.tsx:472`; its message
  still says `receiptWeights`.
- **Checks.** Fixed waits against timers: `nav.mjs:518` (2000ms against
  600+480+600), `nav.mjs:446`, `entries.mjs:756`, `homescreen.mjs:307,402`;
  `search.mjs:150` hard-codes half of `--search-h`. A check that reports
  nothing passes (`verify.mjs:83`). The pre-push hook drops `BUSY` before the
  push has succeeded.
- **Docs.** browser-checks.md: "ten browsers at once" (CI runs one), nav's
  "Seven" sections (ten), no `offline` section; testing.md:62 "seven" checks
  (eight); shots.md:29's count. `copy.settings.notify.means.all` says "Every
  edit" where only money-moving edits notify. design-review.md:27 names
  "Advanced" in the wrong shot. CLAUDE.md's core list omits rates. README.md:97
  (the owner's) says self-host for your own Gemini key, which Advanced takes.
- **Dead or stale.** `.ratecell` CSS; `activeSplit`, `weightsFromItems`,
  `maxHlc` used by tests alone; `demoStamp`'s `asOf`; a second `bare` in
  `app/g/entry/page.tsx:385`; `changeKind`'s Reimbursement branch (settle-up
  never seeds the form); `applyTheme`'s unreachable `"system"`. Comments that
  outlived their code: `lib/fold.ts:14` (Save slides), `entry-check.ts:59-61`,
  `app/g/history/page.tsx:139`, `copy.ts:814`, `icons.tsx:131`,
  `history-copy.ts:127` (JSDoc now on a const), `import-shape.ts:32-35` (the
  seed search is bounded, not the same on every phone).

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

- **What a foreign amount is worth belongs to the entry, fetched for its day.**
  The group-wide registry it replaced still folds, unwritten; a group's first
  sync of the session writes its rate onto entries that predate the move
  (`entriesCarryTheirOwnRate`), and only a new currency with no feed asks
  ([ADR-0005](decisions/0005-money-and-currency.md)).
- **An entry is merged whole, a member per field.** An expense op
  carries the entity as its saver saw it, so an amount can never sit beside
  another phone's split; `deletedAt` and `createdAt` are the exceptions that
  keep the healers working ([sync.md](sync.md#the-operation)).
- **History is read, never rewound; a deleted entry comes back whole.** Restore
  is on the deleted entry's own screen and writes `deletedAt: null`, not the
  `restore` op kind, which folds only because production groups hold some
  ([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md)).
