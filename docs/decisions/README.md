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
| [0007](0007-per-screen-routes-not-drawers.md) | Per-screen static routes, not drawers/sheets within `/g` | Accepted |
| [0008](0008-hand-rolled-css-not-shadcn.md) | Hand-rolled components from the mockup, not shadcn/ui | Accepted |
| [0009](0009-identity-is-device-local.md) | Who you are is device-local, and so is its history | Superseded by [0011](0011-identity-changes-are-public.md) |
| [0010](0010-co-sponsored-expenses.md) | Co-sponsored expenses: `payers` beside `paidBy` | Accepted |
| [0011](0011-identity-changes-are-public.md) | A device's identity claim is an op, so `actor` can be read | Accepted |
| [0012](0012-balances-and-settling-are-one-screen.md) | Balances and settling are one screen; identity lives with the people | Accepted |
| [0013](0013-the-split-editor-is-part-of-the-expense-form.md) | The split editor is part of the expense form, and there are three modes | Accepted |
| [0014](0014-settings-belong-to-the-phone.md) | Settings belong to the phone, beside the group list | Accepted |
