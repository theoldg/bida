# Architecture decision records

One file per decision that would be expensive to reverse. Read the relevant one
before arguing with a choice — the alternative you're about to propose is
probably in the "Rejected" section with a reason.

**Writing a new one:** copy the shape of any existing file. Number it next in
sequence. Keep it short — context, decision, consequences, rejected
alternatives.

**Changing one:** never edit an accepted decision. Write a new ADR and mark the
old one `Superseded by NNNN` at the top.

| # | Decision | Status |
|---|---|---|
| [0001](0001-cloudflare-workers-d1-r2.md) | Cloudflare Workers + D1 + R2 | Accepted |
| [0002](0002-append-only-op-log.md) | Local-first, append-only operation log | Accepted |
| [0003](0003-link-only-access.md) | Link-only access, no user accounts | Accepted |
| [0004](0004-static-export-fragment-routing.md) | Static export, secrets in the URL fragment | Accepted |
| [0005](0005-locked-fx-rate.md) | Per-expense currency with a rate locked at entry | Accepted |
| [0006](0006-lww-not-crdt.md) | Per-field last-write-wins, not a CRDT library | Accepted |
