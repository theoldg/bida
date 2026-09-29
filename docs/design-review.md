# Design review

*For: anyone reviewing a screen for visual or interaction polish. A child of
[design-system.md](design-system.md); each scene named is a `pnpm shots` shot
([shots.md](shots.md)). A finding goes under **Open** and is deleted when
fixed. One the owner rules intended moves to **Ruled intended**, so the next
review doesn't file it again.*

## Open

Nothing. The 2026-09-28 review of every shot, light and dark, is closed.

## Ruled intended

The owner looked at each of these and kept it:

- Three section-header styles: letter-spaced caps, the entry form's grey
  sentence case, the ledger's full-width day band. *`new`, `entry-expense`,
  `group-ledger`*
- The payer value sitting further right than "What" and "When" on the entry
  form. *`entry-expense`*
- Different bottom-of-screen buttons on home, the ledger and balances.
  *`groups`, `group-ledger`, `group-balances`*
- Dialog cards narrower than the page behind them. *`settle-record`*
- The slashed zero in the empty amount field. *`entry-expense`*
- Scan and Support centred on the screen. *`scan`, `tip`*
- "rest", "yours", "the other side: picking swaps them" and "Advanced" as
  labels. *`expense-split-amounts`, `rate`, `transfer-who`, `groups-menu`*
- `$` on the tip jar in a group of another currency. *`tip`*
- Times with a leading zero ("06:14 PM"), and the quick split's grey names.

## Keep

Worth protecting in any future pass:

- The ledger's two lines per entry (the total, then what it means for you, with
  "not yours" faded).
- The payer editor's subtitle, which shows the amount to reach.
- Inline, specific errors: "€15.00 left to split", "€25.00 more than the entry".
- History's strike-through edits.
- The import error that names the line and the format it expected.
- The About page's table of what the server can see.
