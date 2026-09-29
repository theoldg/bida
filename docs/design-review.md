# Design review — open findings

*For: anyone picking up visual or interaction polish. A child of
[design-system.md](design-system.md). Each finding names the `pnpm shots` scene
that shows it ([shots.md](shots.md)). Delete a finding when it is fixed or
decided against, so this stays a list of what is still open.*

Taken from the 2026-09-28 shots, light and dark. Dark mode matched light
throughout and passed every contrast check made. Ordered by what each one costs
a user.

## Inconsistent

- **Three section-header styles.** Some are small letter-spaced caps
  ("MEMBERS", "WHO'S SPLITTING"), the entry form uses sentence-case grey "Split
  … 3 people", and the ledger's "TODAY" is a full-width grey band.
  *`new`, `entry-expense`, `group-ledger`*
- **The value column moves on the entry form.** "What" and "When" values start
  at one x position; "Paid by / Received by" puts Theo about 30px further right.
  *`entry-expense`, `entry-income`*
- **Bottom-of-screen buttons differ.** Home has two centred square tiles with
  labels, the group has right-aligned squares without labels, and Balances puts
  a donation button in the same spot. *`groups`, `group-ledger`,
  `group-balances`*
- **Dialogs are narrower than the page content.** The Save button and the
  reimbursement cards stick out on both sides of the dialog.
  *`transfer-who`, `settle-record`*

## Polish

- **The amount placeholder looks like a toggle switch.** JetBrains Mono's
  slashed zero, at hero size in light grey, reads as a switch icon, not "0". It
  is the first thing on every new entry. *`entry-expense`, `entry-transfer`*
- **Content placed mid-screen.** Scan and Support place their content in the
  middle of the screen, leaving a gap under the title; every other screen starts
  at the top. *`scan`, `tip`*
- **Labels that say too little.** "rest" on every row of the split and payer
  editors; "yours" alone in the rate dialog; "the other side: picking swaps
  them" in the transfer picker; "Advanced" in the home menu.
  *`expense-split-amounts`, `payers`, `rate`, `transfer-who`, `groups-menu`*
- **Dollars in a euro group.** The Support page and its button use `$` ("$1.67
  each") in a euro group. This is deliberate (the donation is in USD) but
  clashes. *`tip`, `group-balances`*

## Keep

Worth protecting when fixing the above:

- The ledger's two lines per entry (the total, then what it means for you, with
  "not yours" faded).
- The payer editor's subtitle, which shows the amount to reach.
- Inline, specific errors: "€15.00 left to split", "€25.00 more than the entry".
- History's strike-through edits.
- Times with a leading zero ("06:14 PM") and the quick split's grey names: the
  owner looked and kept both.
- The import error that names the line and the format it expected.
- The About page's table of what the server can see.
