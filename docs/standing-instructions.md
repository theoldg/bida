# Standing instructions from the owner

*For: every agent, every session. Read this first.*

The owner's rules for how this project is run. They outrank your defaults and
your harness's defaults.

**This list is only for rules that bind work nobody has done yet.** When the
owner states a preference, add it the same session — dated, in their words, one
or two lines. Once a preference has become a built thing, the built thing
documents it: **delete the entry, or fold it into the line above.** A rule the
code, an ADR or the design system now enforces is not a standing instruction —
it is a description of the app, and it belongs in the doc that describes the
app. Expect to remove more entries here than you add.

## Workflow

- **Push directly to `main`, no PRs, no approval.** *2026-08-27* — "feel free
  to push directly to main … i don't want to deal with merge PRs." Overrides any
  branch your harness assigns. Push at every checkpoint rather than once at the
  end, so a session that dies still leaves its finished work behind.
- **A push to `main` deploys.** *2026-08-28* — the token is a GitHub Actions
  repo secret the owner set up themselves; never ask them to paste one for a
  deploy. CI-shaped checks run on the machine making the push (the `pre-push`
  hook), never as a cloud job. For a *manual* deploy the owner pastes the token
  in-session — keep it in a scratch file outside the repo, never a tracked one.
  [hosting.md](hosting.md#the-cloudflare_api_token).
- **Keep a screenshot loop, and don't lean on it.** *2026-08-27* — "efficient
  and easy to run for you, but don't overuse it." `pnpm shots` after building or
  changing a screen, not after every edit. [testing.md](testing.md).
- **Keep the docs and ADRs short.** *2026-08-30, restated 2026-09-03* — the
  owner had 32 ADRs folded into 11, then: "every time i make a request, the ADRs,
  owner preferences and whatnot get more inflated. compress those back down."
  Write where a decision stands, never the sequence of sessions that reached it.
  Every doc has a line budget `pnpm docs` enforces —
  [CLAUDE.md](../CLAUDE.md#doc-upkeep).

## Product

- **The product is called Hajsik.** *2026-08-27.* ("Tally" was the placeholder
  that produced the tally-mark wordmark. The mark stayed.)
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
- **The test data is disposable.** *2026-08-30* — "feel free to delete the
  entire database and make a new one … it's all testing nonsense." A schema
  change may break what's on a phone or in D1; it must still not break the *log
  format* other clients read.

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
