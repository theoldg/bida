# History

*For: anyone touching what history says, the clock's dot on the ledger, or the
screen a deleted entry keeps. History falls out of the op log
([sync.md](sync.md)) with no storage of its own.*

## What a revision is

Falls out of the log with no extra storage. **Per expense**: `ops` filtered by
`entityId`, newest first, each revision being the **difference between the fold
before the op and the fold after it** — never a reading of the patch's keys, or
a whole-entity write would read as "changed everything". **Group feed**: all ops, same renderer. Both are read
only: there is no restore-to-version, and undoing an edit is editing it. A
deleted entry comes back whole, from its own screen, as `update { deletedAt:
null }` ([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md)).

## What a revision says

The sentence for a revision lives in `lib/history-copy.ts` (`describe`), from
`copy.history` — the app's vocabulary for the log. It names the member a
membership revision is *about* rather than the actor, or adding three people
reads as one person joining three times. It must be **total**: it runs inside a
render over every patch the log holds, so one throw is a white screen, not a
missing line. People are listed **by name**, not in the order they are stored:
an id is a hash of the name ([ADR-0034](decisions/0034-a-member-is-their-name.md)),
so sorting by it puts a was/now pair in two unrelated orders.

**Under the sentence goes what moved, never both whole states.** Where a
revision moved a list — people in a split, payers, lines of a bill, who had
which line — it gets **rows** (`lib/history-rows.ts`, drawn by `components/revision.tsx`, the sixth and later folded behind "Show N more"), one per *kind* of move:
"+ Chewie 20.00", "− Cy ~~25.00~~", and the people who moved alike on one row,
"Everyone else 25.00 → 33.33" — "else" once everyone left out is named on a
row above, "everyone but Cy" where not. Taking one of ten out of a split is two
rows, not two lists of ten for the reader to compare. A **split** is read as what each
person owes, in money — the one reading that survives a change of mode and the
only one that says anything about a split by items — so "changed who's
involved" and "changed how it's split" both answer with figures, and a new mode
is said ("Theo split it by items"). Where nobody's proportion moved it says
nothing and the next field speaks (a new amount moves every share, and its own
line says so) — except where a rewrite is the whole of the save, which gets the
mode ("Evenly" → "By items") as a last resort. The **payer** side is the same
rows over what each put in, in the entry's own currency; one payer for another
is just the two names. A **bill** reads line by line, paired by what a line
says, so a reorder is no news and a reprice is a move; a **who-had-what** change
says in words what happened to each line ("Blue milk: Ben → Chewie", "Jawa
juice: Chewie joined Han, Luke"), then one line of who now owes more and who
less ("Chewie +17.00 · Ben −9.00 · Han, Luke −4.00"). A **new entry** is one
line, the amount and who it was for ("CRD 81.00 · for everyone"): who paid and
each share are a tap away, and three lines per entry drowned the feed.

**"Everyone" is about the group as it was.** Each revision carries its
`roster` — who was in the group as its op landed (`rosterOf`) — so a later
joiner never turns last month's "Everyone" into "Everyone but Zoe". An even
split's spare cent is laid flat, so "33.34, 33.33, 33.33" doesn't read as three
shares. Figures in the group's currency go bare, the amount above them carrying
the symbol; anything else keeps its code.

A revision therefore carries the **whole entity either side of it**
(`Revision.before` / `after`), not only the fields that moved: a co-payer added
beside the largest contributor moves `payers` alone, and the name they join is
on the entity rather than in the change. The same reading is what makes the
noun exact — an income is called one on every later edit of it, not only on the
revision that crossed — and what prices each figure in its own currency.

A revision is regularly **several** fields, since an entry is saved whole: a
merge can revert somebody's amount in the same op that changes the description.
So the sentences above are for a revision that moved exactly one field. Where
more than one moved, **no field outranks another**: the line says only that the
entry was edited, and each field that moved gets a labelled was/now line under
it. Ranking them would caption a revision "changed who's involved" and hide
that the amount had gone back — the one thing an audit trail exists to answer.
A labelled line carries its rows like a sentence does.

## Deleted entries

**The history screen reads the deleted entries too.** Both its subject links
and its title come from maps built over every entry the group has ever had —
half the reason to open it is one that is gone. A deleted entry's line ("Dinner
· deleted") opens the entry itself, and its own history backs up to it. Its
line is `components/revision.tsx`, shared with the ledger.

### A deleted entry keeps its screen

[ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md): drawn as it
was, at the rates it was saved at, from `useGroupData`'s `withTombstones`. Drawn
as it was, it read as live, so the state leads: the bar says "Deleted expense",
and an inverted band above the title says "Deleted by {name}", and holds
**Restore** — which asks nothing and turns the screen back into the live entry
in place. The trash and Edit are gone. What else it brings back, a removed
person, is named under the band before the press (`restoreEntryDrafts`).
Deleting goes up to whichever screen linked in, as back would — the ledger,
where the row folds out ([rows.md](rows.md#the-ledger-moves)), or history,
where the delete is the newest line — and the screen never turns into its
deleted self on the way: the live read lands before the navigation does on a
phone, so from the answer on it keeps drawing the entry as it was. "Gone" is
only an id this phone has never had.

## The clock and its dot

The ledger's history clock (`components/history-button.tsx`) stands in the top
bar beside the menu, wearing an ink dot while there is something new. History
pulls those revisions above a torn line labelled "↑ New" (`.torn`) — pulled up
rather than marked in place, since a phone that was offline lands changes
stamped days back. New is `unseenRevisions` (`core/history.ts`): an op numbered
past `groupKeys.seenSeq` whose stamp is another phone's, your own laptop
included, less a device claiming a name.

**Opening history is seeing it** (`useCatchUp`, `lib/catch-up.ts`): the dot
stays, across visits, until the group's history is opened, which moves the mark
past everything there and everything landing while it is open. The mark from
before is held in memory for that look, so the line survives a trip into an
entry and back; the ledger or the groups list ends the look. What waits on a
group nobody opens ages out after a week (`CATCH_UP_MS`) rather than sitting on
the groups list forever. The first pull sets the mark at the cursor, so a joined
group opens with nothing new, and the mark is device-local, never an op.

The groups list is ordered by when each group last changed — its newest op, an
edit or a delete as much as a new entry — never by its latest entry's date. It
leads a row's meta with the same count, reading the log only for a group whose
cursor is past its mark.

## Gotchas

- **A revision's `changes` are only the fields that actually differed.** Saving
  an expense in a new currency at the same rate writes `currency` and no amount
  field at all, so history copy must never read one field because a sibling
  changed.
