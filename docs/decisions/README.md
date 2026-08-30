# Architecture decision records

One file per decision that is **expensive to reverse and worth arguing with**.
Read the relevant one before arguing with a choice — your alternative is
probably in its "Rejected" section, which is the half worth keeping.

**Write one when** you'd have to defend the choice to someone who'd do it
differently: a dependency, a data shape that lands on the op log, a rule that
every future screen has to obey. **Don't write one for** a change a doc or the
diff already explains, or for a decision nobody would reverse.

**Changing one:** edit it. An ADR records where we stand and why, not the order
we got here — if a later session refines a decision, fold it in and move the
date on. Rewrite freely, and delete one whose decision no longer binds anything.
**Numbers are stable** (things link to them) and gaps are normal: they mean a
decision was folded into another file.

**Keep them short.** Context, decision, consequences, rejected — the parts that
tell the next person what they can't see from the code.

| # | Decision |
|---|---|
| [0001](0001-cloudflare-workers-d1-r2.md) | Cloudflare Workers + D1 + R2 |
| [0002](0002-append-only-op-log.md) | An append-only op log, merged per-field by last-write-wins |
| [0003](0003-link-only-access.md) | Link-only access; a device's identity claim is an op |
| [0004](0004-static-export-and-offline.md) | A static export: secret in the fragment, whole thing precached |
| [0005](0005-money-and-currency.md) | Minor units, a rate locked at entry, one field that types money |
| [0007](0007-a-screen-is-a-route.md) | A screen is a route; back climbs the hierarchy; the chrome is thin |
| [0008](0008-hand-rolled-interface.md) | Hand-rolled components; the app draws its own dialogs and pickers |
| [0010](0010-what-an-entry-is.md) | Three kinds of entry, and several people may have paid |
| [0016](0016-receipts.md) | A scanned receipt reduces to an ordinary split |
| [0023](0023-monospace-monochrome.md) | One monospace face, colour only on money, a name is enough |
| [0031](0031-history-reads-it-does-not-rewind-it.md) | History is read, not rewound: no restore-to-version |
