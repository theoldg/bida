# Standing instructions from the owner

*For: every agent, every session. Read this first.*

The owner's rules for how this project is run. They outrank your defaults and
your harness's defaults. **When the owner states a preference, add it here in
the same session, dated, in their words — and keep the entry short.** One-off
fixes belong in the code and its ADR, not on this list; only put a rule here if
it applies to work nobody has done yet.

## Workflow

- **Push directly to `main`, no PRs.** *2026-08-27* — "feel free to push
  directly to main, you don't need my approval and i don't want to deal with
  merge PRs." Overrides any branch your harness assigns.
- **Push frequently, not once at the end.** At each meaningful checkpoint, so a
  session that dies leaves its finished work on `main`.
- **Docs change in the same commit as the code**, and any instruction like these
  gets recorded here.
- **The owner pastes the Cloudflare API token each session.** *2026-08-27* —
  they declined committing it and can't reach the environment-settings UI from
  a phone. **Never write it to a git-tracked file.** Keep it in a session-local
  scratch file outside the repo. [hosting.md](hosting.md#the-cloudflare_api_token).
- **Push to `main` triggers an automatic deploy.** *2026-08-28* — "a deploy job
  from main would be great," with the token added as the `CLOUDFLARE_API_TOKEN`
  GitHub Actions repo secret (the owner set this up themselves; never ask them
  to paste a token into a session for this). Lint/typecheck/test run locally as
  a pre-push hook, not as a GitHub Actions job — the owner wants CI-shaped
  checks to run on the machine making the push, not the cloud side.
  [hosting.md](hosting.md#deploying).
- **Keep a screenshot loop, and don't lean on it.** *2026-08-27* — "efficient
  and easy to run for you, but don't overuse it." `pnpm shots` after building or
  changing a screen, not after every edit. [testing.md](testing.md).

## Product

- **The product is called Hajsik.** *2026-08-27.* ("Tally" was the placeholder
  that produced the tally-mark wordmark. The mark stayed.)
- **The server is part of the MVP, not a phase 2.** *2026-08-27* — the app isn't
  done until a second device opens the link and sees the same ledger.
- **PWA icons are in scope; receipt photo hosting is not.** *2026-08-27* —
  "what I don't need for the mvp is the hosting of images attached to expenses.
  I'm okay with the app being text only for now." Icons are build-time files and
  unrelated to hosting cost.
- **Personal mode answers "does this help me or hurt me?"** *2026-08-28* — every
  row shows what it did to *your* balance, signed and coloured, not just your
  share. It ships **on by default**.
- **Don't make a feature of the odd cent.** *2026-08-27* — "don't highlight cent
  splits, that's the wrong vibe. just draw people at random every time and have
  that be a quiet easter egg." The rotation is deterministic and rendered
  nowhere.
- **The receipt scan runs on a free tier, with maximum trust.** *2026-08-28* —
  "let's try it with a free tier gemini api token, server side, shared globally
  across all users … we'll flag it as something to figure out if we ever want to
  productionize", and "optimize for minimal cloudflare quota usage and assume
  maximum trust for now (we don't need per group throttling etc)". The owner
  wanted the call to leave from the phone, not the server; only CORS stopped it.
  So the Worker adds a key and touches nothing else —
  [receipt-scanning.md](receipt-scanning.md).
- **Prefer auditable over private-and-tidy.** *2026-08-28* — "the edits should
  record who did it … also on the public log." Who did what is a fact about the
  group. [ADR-0011](decisions/0011-identity-changes-are-public.md).
- **Trust the model, don't re-derive what it already did.** *2026-08-28* — on
  the receipt scan: "we don't need date parsing + the llm can handle that,
  don't build useless stuff." The model is asked for `YYYY-MM-DD` directly;
  don't add a multi-format date parser on top of a value that's already
  normalised. [receipt-scanning.md](receipt-scanning.md).
- **Receipt scan's schema and UX are the owner's to design.** *2026-08-28* —
  "keep the schema and ux minimal/flexible, i have ideas for those." Built:
  core normaliser, Worker passthrough, client scan lib. *2026-08-28, later* —
  "propose a ux and go for it without approval, we'll iterate later": the
  button, its states, and a who-had-what item-assignment screen shipped;
  [ADR-0016](decisions/0016-receipt-scan-ux-and-item-assignment.md).
  [receipt-scanning.md](receipt-scanning.md).
- **State that should outlive one browser tab belongs on the server, not just
  the local draft.** *2026-08-28* — on keeping the parsed receipt around to
  re-edit the split: "it should obviously be stored on the server." The parsed
  items and who-had-what grid are now plain fields on the expense, synced like
  everything else. [ADR-0017](decisions/0017-receipt-items-persist-on-the-expense.md).
- **Receipt splitting has to handle the awkward table, not just the easy one.**
  *2026-08-28* — "add an option to unfold many items for nontrivial sub-splits,
  e.g. salad (x2) → salad, Alice + Bob / salad, Charlie … this should be well
  designed graphically."
  [ADR-0022](decisions/0022-unfolding-a-receipt-line-into-portions.md).

## Interface

- **Cut the fat. Text has to earn its place.** *2026-08-28.* Delete anything the
  screen already demonstrates: a subtitle counting what's visible below it, a
  paragraph restating the labels above it, a promise the UI keeps by itself, a
  hint for an obvious affordance. **Keep:** empty states that say what to do
  next, and anything naming a consequence the user can't see.
- **One thought, one screen.** A new route is for a *different* question, not
  the second half of the one being asked. Don't build a wizard out of a form.
  [ADR-0013](decisions/0013-the-split-editor-is-part-of-the-expense-form.md).
- **Weight follows how often you want it pressed**, and consequences get a
  screen, not a `confirm()` — a dialog can't name what it's about to change.
- **A destination reached constantly belongs in the top bar** (three icons is
  the ceiling), never as a menu row duplicating a visible icon. Delete the
  second way to do a once-per-lifetime thing.
- **A flow ends with a way forward, not a way back.** Reuse a screen's
  *structure* when a flow needs its shape; don't reuse the screen when the flow
  needs a different ending.
- **Prefer the direct action to the OS menu containing it**, and feedback in
  place to a dialog. *2026-08-28* — copy the invite link; no share sheet, no
  `alert()`.
- **Don't annotate a log with what the log already shows.** *2026-08-28* —
  derived commentary needs a much higher bar than "we have the data for it".
  One line per thing that happened.
- **Fix layout bugs at the shell, not per screen.** When something is wrong on
  "the app" rather than one screen, look at `.app` / `.appbody` / `.scroll` in
  `globals.css` first — and check the fix on a screen that overflows.
- **Money fields are one component, and core never speaks in minor units.**
  *2026-08-28* — a real input with a caret; the screen writes the sentence
  because only it knows the currency.
  [ADR-0015](decisions/0015-one-money-field-core-reports-numbers.md).
- **Fewer options.** *2026-08-28* — three split modes, in the owner's labels:
  **Evenly · As parts · As amounts**. Dropping a button is not the same act as
  dropping a variant from the data model: old ops keep meaning what they meant.
- **A failure the model writes gets to be funny.** *2026-08-28* — the scan's
  rejection sentence is slightly humorous, at the model's expense rather than
  the photographer's, and still says what to re-shoot. Humour is for the
  message the model composes, not the app's own fixed copy.
- **Members are named, never "You".** *2026-08-29* — every screen prints a
  member's own name; the amber "mine" highlight is what says which one is you.
