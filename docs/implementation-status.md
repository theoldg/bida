# Implementation status

*For: an agent starting a cold session. Where the project stands, and the next
thing to do. Everything here is a pointer — the doc that owns a subject
describes it, and this file says only where we stand against it. **It is not a
log of what sessions built.** Update it in the same commit as the code.*

## Where it stands

**The app is built, deployed and in use.** Nothing is queued: what is not built
was cut rather than postponed — receipt photo storage and categories are seams
in [product.md](product.md#deliberately-not-in-the-mvp), not work in progress.

| | |
|---|---|
| **Production** | <https://bida.bid> — one Worker serving the static export *and* the sync API, on the `hajsik` D1 ([hosting.md](hosting.md)) |
| **Dev** | <https://hajsik-dev.hajsik-api.workers.dev>, its own D1 and scan secrets, deployed by every push to `dev`. Production moves only when the owner releases ([hosting.md](hosting.md#dev-and-production)) |
| **Sealed** | The server cannot read a group ([ADR-0036](decisions/0036-the-server-cannot-read-a-group.md)); the D1 log is finished data, so a schema change is a new migration ([hosting.md](hosting.md#a-schema-change-from-here-on)) |
| **Scanning** | A photographed bill, read by the Worker under a budget, or straight from Google on a phone's own key; or its items typed by hand ([receipt-scanning.md](receipt-scanning.md), [scan-worker.md](scan-worker.md)) |
| **Versioned** | `major.semi.minor`, bumped by every push; the major is the owner's ([hosting.md](hosting.md#versions)) |
| **The tip jar** | `/g/tip` off the balances screen, `/tip` off `/about` ([product.md](product.md#the-mvp)) |
| **Deletable** | `/delete-my-data`, from an invite link, for everybody in the group ([import-export.md](import-export.md#deleting-a-group)) |
| **Searchable** | The ledger's search bar ([frontend.md](frontend.md#the-ledgers-search)) |
| **Installable** | Install and join work on a real iPhone, names included; Android offered, in-app browsers a one-off visit under a banner ([ios.md](ios.md), [pwa.md](pwa.md)) |
| **Demoable** | `bida.bid/demo`, a keyless group that cannot sync, linked from nowhere ([product.md](product.md), [sync.md](sync.md#the-demo-group-has-no-key)) |
| **Exportable** | One Splitwise-shaped CSV; Tricount imports it, and the share sheet hands it over from an iOS home-screen app ([import-export.md](import-export.md#getting-a-group-off-the-phone)) |
| **Importable** | A CSV or a Tricount link into a new group; the CSV round trip is driven and a real Tricount link works ([import-export.md](import-export.md#bringing-a-group-onto-the-phone)) |

## What is open

Six things: Next 16, unchecked on a phone; push notifications, built and unchecked on a phone, the ledger's windowing experiment, Polish, a quick split's link, and a bill's charges on older phones. The visual review is closed
([design-review.md](design-review.md)).

- **A quick split goes out as a link** (ADR-0035), built, driven against a
  local Worker, migrated on both D1s (`0005_splits.sql`) and working on a
  real phone (the owner, 2026-10-16); production serves it once `main` moves.

- **A bill's charges are invisible to a build before them** (`receiptCharges`,
  [who-had-what.md](who-had-what.md#tip-charges-and-discounts)), on `dev` only:
  such a phone works a bill's amount out without them, and its next save of
  that entry writes it so. The owner's call before `main` moves.

- **Next 16 on Turbopack** passes every browser check; untried on a real
  iPhone, where a payload once opened as a page ([pwa.md](pwa.md)).

- **Push notifications are built and work on dev**
  ([notifications.md](notifications.md), ADR-0037): an edit from an incognito
  tab reached the owner's installed app (2026-09-23). The rest of the phone
  checklist in [on-a-phone.md](on-a-phone.md) is unrun.
  VAPID keys are set on both Workers. A notification also pulls its group
  ahead ([sync.md](sync.md#the-pull-ahead)), untried on a phone — `/diag`'s
  `pull ahead:` lines now say whether it ran. Settings' Off · Just me · All
  is built; All is untried on a phone.

- **A 10,000-entry group on a slow phone** (4× CPU): the ledger opens and
  moves between screens in under a second, drawing only what is near the
  screen ([rows.md](rows.md#the-ledger-draws-what-is-near-the-screen)), and a
  save lands mid-list in about 1.4s with its longest freeze near 300ms — read
  once, then moved by the entries it changed rather than added up again
  ([live-reads.md](live-reads.md#a-save-moves-a-few-entries)); a search keeps
  up with typing. Still slow there: the save's whole re-read of the group, and
  history's first open, ~0.7–1s, and an import of that size, ~14s with its
  button a bar ([import-export.md](import-export.md#bringing-a-group-onto-the-phone)). A group whose rows predate the `rev` stamp is
  added up whole until its next pull rebuilds it. 5,000 entries are quick on a
  Pixel 9a (the owner, 2026-10-13).

- **Polish is being translated with the owner, a section at a time**
  ([frontend.md](frontend.md#every-word-in-libcopyts)): `lib/copy-pl.ts`,
  `"???"` where not yet done, reached only from `/diag`. Undecided before it
  ships: how a phone gets it, and whether a past tense agrees with a name's
  gender. **Needs thought, flagged by the owner: text one phone writes and
  another reads**, which lands in the writer's language, not the reader's:
  notifications (ADR-0037), where the owner would rather each went in the
  recipient's; the scan's translate toggle, whose "In English" labels the model
  wrote, and the English words it adds to a title ("Lidl - barbecue"); its
  failure messages; a recorded settle-up's note (`copy.form.reimbursement`);
  and the tip's entry title (`copy.tip.split.entryTitle`).

### Found by the audit of 2026-10-11, not yet fixed

A read of the hundred commits to 1.3.65; each item names where to start. Delete
a line in the push that fixes it.

- **Docs.** README.md:97 (the owner's) says self-host for your own Gemini
  key, which Advanced takes.

**Four things are closed as decisions, not as work**, so a session that
rediscovers one is rediscovering a call the owner has already made:
**no per-caller counter on `POST /ops`**, because counting callers means
storing a row about each of them ([sync.md](sync.md#the-push-has-a-ceiling));
**no hard quota on the Cloud project**, because the owner watches the spend
with alerts of their own ([hosting.md](hosting.md#cost-tripwires)); **Settings'
All says "Every edit in your groups"** though only money-moving edits notify —
the owner: *"I don't care that it's imprecise about non-money edits, and
neither does the user"*; and **an
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
