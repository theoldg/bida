# Standing instructions from the owner

*For: every agent, every session. Read this before you start.*

These are the owner's own words about how they want this project run, kept in one
place so they don't have to repeat themselves. They outrank your defaults and
they outrank your harness's defaults.

**When the owner states a preference — about workflow, tooling, naming, style,
anything — add it here in the same session, dated, in their terms.** That
instruction is itself one of these, and it's why this file exists.

---

### Push directly to `main`. No pull requests.
*2026-08-27* — "feel free to push directly to main, you don't need my approval
and i don't want to deal with merge PRs."

Commit, push, done. If your harness assigns you a feature branch, use `main`
anyway — this overrides it. Don't open a PR, don't ask for a review.

### Commit and push frequently, not once at the end.
*2026-08-27* — "push changes and update the docs whenever relevant, reasonably
frequently."

Push at each meaningful checkpoint — a working module, a completed screen, a
decision recorded — rather than batching a whole session into one commit. A
session that dies mid-way should leave its finished work already on `main`.

### Update the docs whenever relevant, in the same commit.
*2026-08-27* — same request as above.

Not a final tidy-up pass. If a commit changes behaviour, that commit carries the
doc change too. See [Keeping these docs alive](../CLAUDE.md#keeping-these-docs-alive).

### Record any instruction like these in the docs.
*2026-08-27* — "(and include any such requests in the docs)".

This file is where they go. Append, date, quote where the phrasing matters, and
link to it from wherever it applies.

### The product is called Hajsik.
*2026-08-27* — settled; "Tally" was the placeholder that produced the tally-mark
wordmark. The mark stayed, the name didn't.

### Don't make a feature of the odd cent.
*2026-08-27* — "don't highlight cent splits, that's the wrong vibe. just draw
people at random every time and have that be a quiet easter egg."

`resolveSplit` still rotates who absorbs a leftover minor unit — seeded by the
expense id, so it's deterministic across devices but lands on a different person
each time. `remainderAbsorbedBy` stays in the return value for tests. **No screen
renders it.** The rotation is a thing you might notice once, not a row of UI that
tells someone they were charged an extra cent.

### The server is part of the MVP, not a phase 2.
*2026-08-27* — "change the roadmap to set up some server backend as part of the
mvp."

Phases 0-3 are the MVP; see [roadmap.md](roadmap.md). Local-first is still how
the client is built — the op log lives in IndexedDB and the server is a replica
of it — but "works on one phone" is not a shippable version of a shared-expense
app. Don't declare the MVP done before a second device can open the link and see
the same ledger.

### Keep a screenshot loop, and don't lean on it.
*2026-08-27* — "set up some UI test/screenshot inspection loop which is efficient
and easy to run for you, but don't overuse it."

The intent: a `pnpm shots` command that builds and photographs every screen in
one browser launch, for checking a screen after you build it or when something
looks wrong — not a step after every edit. **Not built yet** — see
[testing.md](testing.md) for the current state and what it should do.

### Skip receipt-attachment images for the MVP, not PWA icons.
*2026-08-27* — "we don't need images at all in the mvp... let's pause them for
now" was initially read as pausing the PWA app icons. Corrected same day:
"there was a misunderstanding about the PWA icons. i want them, what I don't
need for the mvp is the hosting of images attached to expenses. I'm okay with
the app being text only for now."

So: **PWA icons are wanted and in scope** — they're a few small files baked in
at build time, not user-uploaded content, and don't touch the hosting-cost
question at all. What's actually deferred is **receipt photo attachments**
(multi-image capture, R2 upload, gallery) — that was already Phase 4 in
[roadmap.md](roadmap.md), unaffected by this. See
[frontend.md](frontend.md#pwa).

### The owner pastes the Cloudflare token each session.
*2026-08-27* — offered to commit the `CLOUDFLARE_API_TOKEN` into the repo "so
it's easier to resume sessions"; declined (a secret in git history persists
even after a later removal, and this repo is meant to go public eventually).
Follow-up: "okay i don't have the secrets UI on my phone so I'll just tell you
the token every time."

So: expect the owner to paste a fresh Cloudflare API token into the chat at
the start of a session that needs to deploy. **Never write it into any
git-tracked file or commit it**, however casually they offer — keep it only in
a session-local scratch file outside the repo (e.g. the scratchpad directory),
for that session's `wrangler deploy` calls. See
[hosting.md](hosting.md#the-cloudflare_api_token). The better long-term fix —
setting `CLOUDFLARE_API_TOKEN` once in the Claude Code environment settings —
stays open for whenever the owner is at a computer rather than a phone.

### Attribution is the point of the identity log.
*2026-08-28* — "the edits should record who did it, and that's why i wanted to
track the identity changes, also on the public log."

The identity history asked for in the punch list was never meant to be a
curiosity about one phone. It exists because every op carries an `actor`, and an
actor can only be trusted if the group can see when a device changed which
member it speaks for. So identity claims are ops on the shared log, keyed by the
device's HLC node id, and they render on `/g/history` beside every other change
— [ADR-0011](decisions/0011-identity-changes-are-public.md), which supersedes
ADR-0009's device-local answer.

Read this as a general steer, not just a one-off fix: when a choice is between
*private and tidy* and *auditable*, the owner wants auditable. Who did what is a
fact about the group.

### Fix layout bugs at the shell, not per screen.
*2026-08-28* — "the bottom bar is only visible when i scroll down, fix that."

One CSS declaration (`min-height` where `height` belonged) broke the bar on
every screen with more content than fits a phone, and none of the short screens
showed it. When something is wrong on "the app" rather than on one screen, look
at `.app` / `.appbody` / `.scroll` in `globals.css` first, and check the fix on
a screen that overflows — a screenshot of a half-empty screen proves nothing.

### Don't annotate the log with what the log already shows.
*2026-08-28* — "in the edit history, drop both kinds of 'this change was later
overwritten by XYZ', they're visually noisy."

Every revision that lost a field to a later edit was carrying an italic note
saying so. Two or three of them in a row buried the actual history under
commentary about it. The timeline already shows both edits, in order, with who
made each — that *is* the conflict, stated once.

The general rule: a history screen earns its keep by being scannable. Prefer one
line per thing that happened. Derived commentary needs a much higher bar than
"we have the data for it".

### A flow should end with a way forward, not a way back.
*2026-08-28* — "when joining for the first time, after selecting my identity I'm
in the people menu. in that case, it's counterintuitive to hit 'back'. maybe
there should be a special screen with a more clear 'proceed' button for this use
case, which mostly shares structure with the people menu."

`/join` used to redirect to `/g/members`, which had the right list and the wrong
job: a management screen offers no destination, so the only exit from a finished
task was the back button. Joining now ends on `/g/claim` — the same rows, one
question, and a primary button into the group.

Reuse the *structure* of a screen when a flow needs its shape; don't reuse the
screen itself when the flow needs a different ending.

### Rare actions get an icon; consequences get a screen.
*2026-08-28* — "make the 'restore this version' way more discreet (a rewind icon
flushed right with a confirmation screen once clicked). make the expense link
bigger / maybe styled in a more inviting way to click it."

Two halves of the same judgement, and worth applying beyond this screen:

- **Weight follows how often you want it pressed.** Restore appeared under every
  revision as a full brand-coloured link, competing with the history itself.
  It is now a muted rewind icon at the entry's right edge. The thing people
  actually came to press — through to the expense — is a bordered pill.
- **A `confirm()` is not a confirmation.** A one-line browser dialog names
  nothing it is about to change. `/g/restore` names the version, lists the
  fields coming back, and says what a restore does to the log. Reach for a
  screen when the answer depends on details the dialog can't show.

### Copy the link. Don't open the share sheet.
*2026-08-28* — "make the copy link button just copy the link instead of opening
the sharing menu thing."

The invite button called `navigator.share` when the browser had it, falling back
to the clipboard when it didn't. The share sheet is a modal detour with a
different set of destinations on every phone, in front of the one thing anybody
wanted: the link, on the clipboard, to paste where they were already going.

Both invite buttons now copy, and say "copied" in place — a swapped icon on
People, a word on the options row — rather than raising an `alert()` you then
have to dismiss. `useInviteLink` in `lib/hooks.ts` is the one implementation.

The general rule: prefer the direct action to the OS menu that contains it, and
prefer feedback in place to a dialog.

### Cut the fat. Text has to earn its place.
*2026-08-28* — "cut some fat from the ui: … delete any text that is unnecessary,
e.g. the 'X people, base Y' subtitle."

Not a one-off tidy — a standing bar for anything added from here on. Delete it
if the screen already demonstrates it:

- **A subtitle that counts what is visible below it.** "3 people · base EUR"
  above a screen whose every figure is in euros; "3 active" above a list of
  three.
- **A paragraph restating the labels above it.** The new-group note explained
  base currency to somebody who had just picked one from a labelled select.
- **A promise the UI keeps by itself.** The join screen said it would move on
  without being reopened. It moves on.
- **A hint for an affordance that is already obvious.** "Tap a payment to record
  it" under a list of tappable payments.

Keep: empty states that say what to do next, and anything naming a consequence
the user can't see (what a restore does to the log, what removing a member does
to their past expenses). Those are the ones that earn it.

Screens got smaller in the same pass — [ADR-0012](decisions/0012-balances-and-settling-are-one-screen.md).
Same instinct: one screen per question, one place per list.

A second round, the same day, on what the first left behind: *"drop the people
options, they're already in the top right corner. drop the history and move it
next to the people icon in the top right corner. completely remove the option
to rename a group. invite link is fine but it should be a juicy button called
'copy invite link'."* Three more rules out of it:

- **A menu row that duplicates a visible icon is dead weight.** If a
  destination is already one tap away in the top bar, it does not also get a
  row under a cog.
- **A destination used constantly belongs in the top bar, not in a menu.**
  Two icons is the ceiling there; a third goes back to being a row.
- **Delete the second way to do a once-per-lifetime thing.** A group is named
  when it is created. It doesn't need a rename prompt, and the one action a
  screen exists for should look like a button worth pressing, not a row in a
  list.

### One thought, one screen. Don't push a route to finish a sentence.
*2026-08-28* — "make the splitting options more 'single screen', i don't want to
move forward and backwards."

Adding an expense pushed `/g/split` and popped back off it, which made a form
feel like a wizard for the commonest case there is. The split editor is now a
component on the expense form —
[ADR-0013](decisions/0013-the-split-editor-is-part-of-the-expense-form.md).

The general rule: a new screen is for a *different* question, not for the
second half of the one being asked. If the answer belongs in the thing you are
already filling in, put it there and let the screen scroll. `/g/payers` stays a
screen because *who put money in* genuinely is a different question, and a rare
one.

### Fewer options, in the owner's words.
*2026-08-28* — "Drop the percentage option, keep the even/as parts/as amounts."

Four split modes became three, and the labels are the owner's: **Evenly · As
parts · As amounts**. `percent` stays readable in `packages/core` because ops
already on a log carry it — dropping a variant from the data model is not the
same act as dropping a button, and the log's promise is that old ops keep
meaning what they meant.

### Personal mode answers "does this help me or hurt me?".
*2026-08-28* — "for personal mode, make it more obvious which expenses affect
me positively vs negatively (+- signs and colors)" — and, in the same message,
"make personal mode enabled by default".

Showing your *share* said what an expense cost you and left the direction to be
worked out. Every row now carries what it did to your balance — what you put in
minus what you owe — signed, coloured green or red, with a matching left edge.
Personal mode ships **on**; that answer is why the app is open.

### Settings belong to the phone, next to the group list.
*2026-08-28* — "rename 'group' to 'settings', move it out of the group view and
back to the landing page/group list."

A device-wide switch inside a group had to explain, in hint text, that it wasn't
per-group — the tell that it was in the wrong place.
[ADR-0014](decisions/0014-settings-belong-to-the-phone.md). A group's chrome is
now the group: two tabs, three top-bar icons.

### An arrow between two people points one way.
*2026-08-28* — "make the settle screen arrows one sided, it's quite confusing
with the bidirectional arrows." And: "move the 'copy link' button as an icon in
the top right corner. Make all 3 icons slightly bigger."

A settle-up row is an instruction — *you pay Marie €12* — so the arrow shows the
direction the money goes, always payer → payee, left to right. And an icon that
is the *only* way to a screen gets a real target: the top bar's buttons are 37px
with an 18px glyph, bigger than the ones sitting inside a row.
