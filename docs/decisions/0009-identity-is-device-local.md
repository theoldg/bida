# 0009 — Who you are is device-local, and so is its history

**Status:** Superseded by [0011](0011-identity-changes-are-public.md) · 2026-08-27

**Decision (as it stood).** Which member a phone says it is, and the log of
changes to that, stay device-local: `meByGroup` plus a Dexie `identityLog` table
rendered by the in-group options screen. Neither is ever an op.

**Why, at the time.** It is not a fact about the group; a synced identity log
would leak how many devices a person uses and when a phone changed hands; there
is nothing to converge (two devices both claiming to be Sam is not a conflict);
and clearing site data ought to erase who this phone said it was.

**Superseded 2026-08-28.** The owner's point — *"the edits should record who did
it, and that's why i wanted to track the identity changes, also on the public
log"* — is that identity is not a standalone fact: it is what makes every op's
`actor` readable. And the leak this ADR feared was already in the log, in the
node id at the end of every HLC. See
[0011](0011-identity-changes-are-public.md).
