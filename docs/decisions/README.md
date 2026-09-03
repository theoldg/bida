# Architecture decision records

One file per decision that is **expensive to reverse and worth arguing with**.
Read the relevant one before arguing with a choice — your alternative is
probably in its "Rejected" section, which is the half worth keeping.

## Adding one: the default is no

**Most sessions add none, and a session that adds two is documenting its work
rather than deciding anything.** There are twelve, and that number should move
about as often as the architecture does. All four of these must hold:

1. **It is built and shipped**, not proposed. An ADR records a decision the
   code already obeys; a plan goes in the roadmap.
2. **Reversing it would cost far more than the diff that made it** — other
   packages, every future screen, or ops already written to a log.
3. **You can name the alternative a competent person would have chosen**, and
   why it lost. If the "Rejected" section needs a straw man, there is no ADR
   here.
4. **No existing ADR covers the subject.** If one does, edit it. A new file is
   for a new subject, never for a new session's take on an old one.

**Not an ADR:** anything the owner asked for — that is a standing instruction,
or nothing at all; a choice the diff or a doc already explains; a bug fix,
however clever (that is a **Gotcha**); wording, layout or naming on a screen
([design-system.md](../design-system.md), `copy.ts`); *how* something works, as
opposed to why it is this and not that; a dependency you decided **not** to add,
which is the default rather than a decision.

If all four hold, write it — and say in your summary that the set grew, so the
owner sees a thirteenth arrive rather than finding it later.

**Changing one:** edit it. An ADR records where we stand and why, not the order
we got here — if a later session refines a decision, fold it in and move the
date on. Rewrite freely, and delete one whose decision no longer binds anything.
**Numbers are stable** (things link to them) and gaps are normal: they mean a
decision was folded into another file. Every ADR on disk is a row in the table
below, and `pnpm run docs` checks that both ways.

**Keep them short.** Context, decision, consequences, rejected, nothing else.
Not how the built thing looks or reads, which is the design system's and the
feature docs' job — link rather than say it twice. A consequence that restates
the decision, or a rejected option nobody would propose, is a line to cut.

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
| [0033](0033-every-word-in-one-file.md) | Every word the app says lives in one file |
