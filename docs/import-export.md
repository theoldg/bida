# Groups in and out

*For: anyone touching import, export, deleting a group, or anything handed to
the clipboard. Part of the [frontend](frontend.md) docs. The file formats
themselves are [data-model.md](data-model.md#the-group-as-a-spreadsheet); what
the other phones do when a group is deleted is
[sync.md](sync.md#deleting-a-group).*

## Bringing a group onto the phone

**Import a group**, in the groups list's kebab above About, is the other
direction: somebody else's ledger read into a new group. The kebab is the whole
of the entry point.

**Two sources, one readout.** A CSV in the shape
[data-model.md](data-model.md#the-group-as-a-spreadsheet) describes, chosen as
a file — or **a Tricount link**, fetched. Both land in the same `ImportPlan`,
and past that moment the screen cannot tell which it was. There is no box to
paste CSV text into.

**Three steps, and the source is read on the first.** Pick or fetch, look at
what was found, say which of those people you are. Reading writes
nothing — `core/import.ts` and `core/tricount.ts` both hand back a plan — so
the people, the currency, the counts and the rows that will be left out are all
on screen before an op exists. Once a plan is up it is the screen, and the two ways in
collapse to one button back to them, with what was typed still in place.

**Fetching a link says what it costs, under the button.** *Sent through bida's
server, unencrypted. Not stored.* — centred under the button, and one of the
two things in the app that leave the phone readable, because the browser cannot
call bunq itself. `/about` names both in its privacy section, this one in
`about.privacy.import`; it is the same admission it makes about a receipt
photo, in the same place a person can still change their mind
(`apps/api/src/index.ts`).

Five pieces, each in the layer that owns it:

| | |
| --- | --- |
| `core/import.ts` | Rows to a plan, and every refusal. Pure, and takes `dayToTimestamp` the way `export.ts` takes `formatDay`. `checkStated` (the plan against the stated balances) and the member, currency, figure and day checks are shared with the reader below |
| `core/tricount.ts` | A tricount's JSON to the same plan ([data-model.md](data-model.md#reading-a-tricount-back)). Pure for the same reason, and it fetches nothing |
| `lib/import/csv.ts` | The bytes: an RFC 4180 state machine, the size guard, and the group name off the filename. A dialect is a parsing decision about somebody else's file, not domain arithmetic, so it is not in core — and it is not a dependency, since a library that auto-detects the delimiter is working against a reader whose whole rule is to refuse rather than guess. `parseCsv` is one swappable function if that changes |
| `lib/import/tricount.ts` | The link: the key out of whatever was pasted, a throwaway RSA public key the handshake wants, and one POST to `/api/tricount`. The private half is dropped where it is made, since nothing in that protocol signs anything |
| `lib/db/commands/import.ts` | The plan as **one `appendOps` batch** under one actor: a hundred rows are not a hundred things somebody did a millisecond apart, and one batch is also the only atomic shape |

**A refusal is whole-source, and says what to fix.** Every code in
`ImportRefusalCode` has a sentence in `copy.importData.refused`, interpolating
the `line` (1-based, as a spreadsheet counts, blank lines included) and the one
fact that code carries; the tricount codes name the entry instead, which is
what a person sees when they open it. The refusals are the most-read words the
feature has, which is why they are in `copy.ts` and the `ImportError` messages
are terse developer strings ([ADR-0033](decisions/0033-every-word-in-one-file.md)).
Three sentences beside them are not refusals of a ledger at all and say so:
that was not a Tricount link, this phone is offline, and **Tricount is not
answering** — the last one saying plainly that bida reads tricounts the way
Tricount's own app does and that this can stop working without warning.

The group's **name** is asked either way, prefilled and editable: a tricount
states its title, and a file can only be guessed at from its filename, since
both exporters name the file after the group and a mail client may have renamed
it since.

## Deleting a group

`/delete-my-data` is the app's answer to "take my data off your server", and the
only screen that destroys anything. It takes an **invite link**, not a group id
or a row on the list: holding the link is the whole of authority
([ADR-0003](decisions/0003-link-only-access.md)), so it is also the authority to
end the group, and asking for it means the screen works from a phone that was
never in that group.

The link is used to pull the whole log and open it, so what stands on screen
before the button is the real group, named, counted and dated
(`lib/db/erase.ts`). Then four deliberate frictions: typing the address to get
here, finding the link, typing the group's name, and a dialog that names the
group again. What is deleted is the server's copy, for everybody, plus this
phone's.

**The other phones learn from the 410.** Their next sync erases the group there
too and drops it off their list, wherever the app happened to be standing; the
group screen and `/join` say it was deleted, and `/g/claim` sends them back to
the list ([sync.md](sync.md#deleting-a-group)).

**Not linked from anywhere.** A screen whose job is deleting other people's
data has no business one tap from a ledger, so `/about` writes the address out
unlinked (`AboutDelete`, naming the host the app was opened from, since the dev
Worker holds its own groups), and the screen itself names the gentler thing
most people are actually after — Export data — before it asks for a link.

## Getting a group off the phone

**Export data**, above Forget group in the group menu, hands over one CSV in
Splitwise's export shape — the only format anything else imports, Tricount
included, whose import *is* "import from Splitwise". The file is
`core/export.ts`; `lib/export.ts` is the part with a platform in it.

There is no format question and no JSON: a data dump is what `/diag` is for,
and `application/json` is not a file type the share sheet carries.

**Three rungs, and only *unavailability* descends** (`handoffPlan`, taking its
facts as arguments so the table can be stated and tested):

| | | When |
|---|---|---|
| 1 | `navigator.share` with a file | Wherever `canShare` takes one. The only way out of an iOS home-screen app, and the nicest anywhere: the sheet holds Save to Files, Mail and every messaging app, and it comes back to bida |
| 2 | `<a download>` | Everywhere except an iOS home-screen app — there a download is not unsupported but *hostile*, replacing the app with a full-screen "Open in …" that has no way back ([ios.md](ios.md#the-problem)). An iOS tab is fine |
| 3 | `/g/export` | Neither of the above exists |

A cancelled share sheet is **not** a failed one: it throws `AbortError`, means
"no thanks", and answering it with a fallback screen is the app insisting.
Only a share that never opened descends, because it leaves the phone exactly
where an absent sheet would have.

**Nothing says "Saved."** No rung can know: the share sheet doesn't report
which destination was picked and a download has no completion event. A
confirmation would be a guess on every platform, so the only outcome with
anything to add is the one that has a screen.

This narrows the "copying, not `navigator.share`" rule in `useInviteLink` —
that was about a *link*, where the clipboard is the destination and the sheet
is a detour. A file has no clipboard.

## The clipboard

Four screens hand a string over — the invite link, a quick split, the CSV,
the `/diag` report — and every one of them was written for a clipboard that
**refuses**: `writeText` rejects on an insecure context or a denied
permission, and the answer is to put the text on screen to be read instead
(`InviteFallback`, and the same shape on the other three).

A browser can also have **no clipboard at all** (in-app browsers such as
Messenger's). `navigator.clipboard` is then `undefined`, so
`navigator.clipboard.writeText(…)` throws before there is a promise to reject,
and a rejection handler does not catch it. The way out of an in-app browser
(`components/embedded.tsx`) copies the link on arrival and renders *outside*
`ReadErrorBoundary`, so there it is Next's "Application error".

So writing goes through **one door**, `lib/clipboard.ts`, where a missing
clipboard is the same *no* as a refused one — the shape every caller already
had. `hasClipboard()` is for the control that should say something else
without one: `CopyLink` drops the button and says *Hold to copy* over the
selectable link, rather than answering a press with nothing. Reading has its
own door for its own reasons (`lib/paste.ts`, whose calls are all already
inside the `try` that awaits them). `rules-check` holds the pair, because it
costs a line to lose and is invisible until it is somebody else's phone.
