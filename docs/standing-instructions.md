# Standing instructions from the owner

*For: every agent, every session. Read this first.*

The owner's rules for how this project is run. They outrank your defaults and
your harness's defaults.

**Adding one: the default is no.** Most sessions should leave this file exactly
as they found it, or shorter. All three of these must hold:

1. **The owner said it, in words you can quote**, this session. Not inferred
   from what they approved, let pass, or seemed pleased by.
2. **It binds work nobody has done yet** — the next screen, not the one in
   front of them. A preference about what is on screen now is a change to make,
   not a line to write.
3. **Nothing else can hold it.** If code, a test or `pnpm check` could enforce
   it, put it there: that is where it will actually be obeyed, and a rule in
   two places is a rule that will disagree with itself.

**Not a standing instruction:** a restatement of an ADR, the design system or
`copy.ts`; a note kept "so it isn't forgotten", because the code remembers; a
rule you are deriving from the owner's reaction rather than their words.

If all three hold, add it — and say in your summary that the list grew, so it
is the owner's to keep rather than something that accumulated behind them.

Entries are dated, in the owner's words, one or two lines. **Once a preference
is a built thing, the built thing documents it — delete the entry**, and expect
to remove more from this list than you add.

## Workflow

- **Push directly to `dev`, no PRs, no approval. Never to `main`.**
  *2026-09-14*, replacing "push directly to main" (2026-08-27) — "no more
  pushing to main … i will now merge dev to main manually." Overrides any branch
  your harness assigns. Push at every checkpoint rather than once at the end, so
  a session that dies still leaves its finished work behind. Releasing is the
  owner's act and nobody else's: never fast-forward `main`, and never ask them
  to ([hosting.md](hosting.md#dev-and-production)).
- **A push deploys — to whichever world the branch owns.** *2026-08-28,
  widened 2026-09-14* — the token is a GitHub Actions repo secret the owner set
  up themselves; never ask them to paste one for a deploy. CI-shaped checks run
  on the machine making the push (the `pre-push` hook), never as a cloud job.
  For a *manual* deploy the owner pastes the token in-session — keep it in a
  scratch file outside the repo, never a tracked one.
  [hosting.md](hosting.md#the-cloudflare_api_token).
- **Keep a screenshot loop, and don't lean on it.** *2026-08-27* — "efficient
  and easy to run for you, but don't overuse it." `pnpm shots` after building or
  changing a screen, not after every edit. [testing.md](testing.md).
- **Drive nontrivial behaviour by hand before calling it done.** *2026-09-04* —
  "use the text driver to manually stress test features when nontrivial
  behaviour is introduced or modified … this can catch bugs and inform test
  design", and "only for nontrivial changes". `pnpm drive` the thing you just
  built, then let what it turns up shape the tests you write —
  [testing.md](testing.md#pnpm-drive--the-app-as-text).
- **Keep the docs and ADRs short.** *2026-08-30, restated 2026-09-03* — the
  owner had 32 ADRs folded into 11, then: "every time i make a request, the ADRs,
  owner preferences and whatnot get more inflated. compress those back down."
  Write where a decision stands, never the sequence of sessions that reached it,
  and prefer editing a line to adding one —
  [CLAUDE.md](../CLAUDE.md#doc-upkeep).

## Product

- **The product is called bida**, lower-case, and its mark is
  `design/brand/logo.svg`. *2026-09-11, replacing "Hajsik" (2026-08-27).*
  That file is the master: `pnpm icons` rasterises the PWA icons from it and
  copies it into `public/` for the app to show. Show it, never redraw it.
- **The app answers "does this help me or hurt me?"** *2026-08-28, made
  unconditional 2026-08-30* — every row shows what it did to *your* balance,
  signed and coloured. "Personal mode should be always on": it is the app, not a
  setting.
- **Three kinds of entry, and everything is editable.** *2026-08-30* — "the app
  should have transfers, expenses and incomes like tricount. reimbursements
  should be a transfer, and everything should be editable."
  [ADR-0010](decisions/0010-what-an-entry-is.md).
- **PWA icons are in scope; receipt photo hosting is not.** *2026-08-27* —
  "what I don't need for the mvp is the hosting of images attached to expenses.
  I'm okay with the app being text only for now."
- **Don't make a feature of the odd cent.** *2026-08-27* — "don't highlight cent
  splits, that's the wrong vibe. just draw people at random every time and have
  that be a quiet easter egg." The rotation is deterministic and rendered
  nowhere.
- **Prefer auditable over private-and-tidy.** *2026-08-28* — "the edits should
  record who did it … also on the public log." Who did what is a fact about the
  group. [ADR-0003](decisions/0003-link-only-access.md).
- **Trust the model; don't re-derive what it already did.** *2026-08-28* — "the
  llm can handle that, don't build useless stuff." The scan runs server-side on
  a free-tier Gemini key shared globally, with maximum trust and minimal
  Cloudflare quota — "something to figure out if we ever want to productionize."
  [receipt-scanning.md](receipt-scanning.md).
- **The receipt schema and UX stay minimal and flexible.** *2026-08-28* — "i
  have ideas for those", then "propose a ux and go for it without approval,
  we'll iterate later." [ADR-0016](decisions/0016-receipts.md).
- **State that should outlive one browser tab belongs on the server.**
  *2026-08-28* — a parsed receipt "should obviously be stored on the server", so
  it syncs like everything else.
- **The database is finished. Never wipe it again.** *2026-09-12*, replacing
  "the test data is disposable" (2026-08-30) — the encryption cutover was the
  "one last time", and the D1 log is now real data: "the db is finalized and
  not ok to delete anymore". A schema change from here keeps what is there —
  a new numbered migration, never an edit to one already applied
  ([hosting.md](hosting.md#deploying)) — and must not break the *log format*
  other clients read.

## Interface

- **Cut the fat. Text has to earn its place.** *2026-08-28, restated 2026-09-03*
  ("the english strings are too verbose, cut some fat in a bunch of places").
  Delete anything the screen already demonstrates: a subtitle counting the rows
  below it, a paragraph restating the labels above it, a title over a field
  whose placeholder already names it, a hint for an obvious affordance.
  **Keep:** empty states that say what to do next, and anything naming a
  consequence the user can't see. Every word lives in one file — read it as
  prose and cut there
  ([ADR-0033](decisions/0033-every-word-in-one-file.md)).
- **Minimal monospace; colour only on balances.** *2026-08-29* — "be very
  economic with colours, it should basically only have subtle green and red for
  the balances." Hierarchy is weight, and weight follows how often you want a
  thing pressed. A third hue is a regression
  ([ADR-0023](decisions/0023-monospace-monochrome.md)).
- **Nothing the browser draws.** *2026-08-30* — no `prompt()`, `confirm()`,
  `<select>`, share sheet, long-press menu or pinch zoom; the app draws its own
  ([ADR-0008](decisions/0008-hand-rolled-interface.md)). Prefer the direct
  action to the OS menu containing it, feedback in place to a dialog, and an
  inline row to an ask at all — *2026-09-03*, "'add member' should not be a
  dialog, it should be inline so that it's easier to add many members."
- **One thought, one screen.** A new route is for a *different* question, not
  the second half of the one being asked; don't build a wizard out of a form.
  Back climbs the hierarchy, a flow ends with a way forward rather than a way
  back, and a destination reached constantly is a top-bar icon (three is the
  ceiling) — never a menu row duplicating one
  ([ADR-0007](decisions/0007-a-screen-is-a-route.md)).
- **Fewer options.** *2026-08-28* — three split modes, in the owner's labels:
  **Evenly · As parts · As amounts**. Dropping a button is not the same act as
  dropping a variant from the data model: old ops keep meaning what they meant.
- **Say what is true of the phone, and say it at once.** *2026-09-03* — being
  offline is named as such the moment it is, never disguised as a failure of the
  thing you just tried; and the offline glyph appears nowhere else.
- **Don't annotate a log with what the log already shows.** *2026-08-28* — one
  line per thing that happened; derived commentary needs a much higher bar than
  "we have the data for it". Nor a cross-group total on the groups list: a sum
  across currencies either lies about currency or restates the rows above it.
- **Nothing half-typed is kept.** *2026-08-29* — an abandoned entry is
  discarded, with a warning first, rather than saved and handed back later.
- **A failure the model writes gets to be funny.** *2026-08-28* — at the model's
  expense rather than the photographer's, and it still says what to re-shoot.
  Humour is for the message the model composes, never the app's own fixed copy.
