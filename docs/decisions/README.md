# Architecture decision records

One file per decision that would be expensive to reverse. Read the relevant one
before arguing with a choice — your alternative is probably in its "Rejected"
section.

**New one:** copy an existing file's shape, number next in sequence, keep it
short — context, decision, consequences, rejected.
**Changing one:** never edit an accepted decision. Write a new ADR and mark the
old one `Superseded by NNNN`.

| # | Decision | Status |
|---|---|---|
| [0001](0001-cloudflare-workers-d1-r2.md) | Cloudflare Workers + D1 + R2 | Accepted |
| [0002](0002-append-only-op-log.md) | Local-first, append-only operation log | Accepted |
| [0003](0003-link-only-access.md) | Link-only access, no user accounts | Accepted |
| [0004](0004-static-export-fragment-routing.md) | Static export, secrets in the URL fragment | Accepted |
| [0005](0005-locked-fx-rate.md) | Per-expense currency with a rate locked at entry | Accepted |
| [0006](0006-lww-not-crdt.md) | Per-field last-write-wins, not a CRDT library | Accepted |
| [0007](0007-per-screen-routes-not-drawers.md) | Per-screen static routes, not drawers | Accepted |
| [0008](0008-hand-rolled-css-not-shadcn.md) | Hand-rolled components, not shadcn/ui | Accepted |
| [0009](0009-identity-is-device-local.md) | Identity is device-local | Superseded by [0011](0011-identity-changes-are-public.md) |
| [0010](0010-co-sponsored-expenses.md) | Co-sponsored expenses: `payers` beside `paidBy` | Accepted |
| [0011](0011-identity-changes-are-public.md) | Identity claims are ops, so `actor` is auditable | Accepted |
| [0012](0012-balances-and-settling-are-one-screen.md) | Balances and settling are one screen | Accepted |
| [0013](0013-the-split-editor-is-part-of-the-expense-form.md) | The split editor is part of the expense form; three modes | Accepted |
| [0014](0014-settings-belong-to-the-phone.md) | Settings belong to the phone, beside the group list | Accepted |
| [0015](0015-one-money-field-core-reports-numbers.md) | One money field; core reports numbers, screens write sentences | Accepted |
| [0016](0016-receipt-scan-ux-and-item-assignment.md) | Receipt scan UX: item assignment writes an ordinary `shares` split | Accepted |
| [0017](0017-receipt-items-persist-on-the-expense.md) | Receipt items persist on the expense, not just the draft | Accepted |
| [0018](0018-receipt-as-a-fourth-split-tab.md) | Receipt scan and who-had-what move into a fourth split tab | Accepted |
| [0019](0019-receipt-mode-owns-the-total.md) | Receipt mode owns the total; the tab choice persists | Accepted |
| [0020](0020-receipt-total-and-split-are-derived-not-cached.md) | Receipt's total and split are derived at read time, never cached | Accepted |
| [0021](0021-leaving-receipt-mode-hands-the-total-back.md) | Leaving Receipt hands the total back; a zero total is never "allocated" | Accepted |
| [0022](0022-unfolding-a-receipt-line-into-portions.md) | A "×2" line unfolds into portions; a portion is an ordinary line | Accepted |
| [0023](0023-monospace-monochrome.md) | One monospace face; colour only on money | Accepted |
| [0024](0024-precache-the-whole-export-cache-first.md) | The service worker precaches the whole export and serves it cache-first | Accepted |
| [0025](0025-our-own-dialogs.md) | The app draws its own dialogs; a consequence doesn't always need a route | Accepted |
