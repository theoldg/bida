# Design review — open findings

*For: anyone picking up visual or interaction polish. A child of
[design-system.md](design-system.md). Each finding names the `pnpm shots` scene
that shows it ([shots.md](shots.md)). Delete a finding when it is fixed or
decided against, so this stays a list of what is still open.*

Taken from the 2026-09-28 shots, light and dark. Dark mode matched light
throughout and passed every contrast check made. Ordered by what each one costs
a user.

## Inconsistent

- **The add-member field's focus box.** When focused, it draws a box at a 16px
  gutter instead of 32px. *`members`, `add-member`*
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
- **Wording.** The import plan counts "Entries 4 · Transfers 1", but everywhere
  else a transfer is one of the three kinds of entry
  ([ADR-0010](decisions/0010-what-an-entry-is.md)). The quick-split subtitle is
  "SLICE HOUSE - PIZZA" with a hyphen, where every other screen uses " · ".
  *`import-plan`, `quick-result`*
- **Dialogs are narrower than the page content.** The Save button and the
  reimbursement cards stick out on both sides of the dialog.
  *`transfer-who`, `settle-record`*
- **Dialog titles.** "Delete this expense?" is a question; "Forget group" is not.
  *`delete-entry`, `forget`*

## Polish

- **The amount placeholder looks like a toggle switch.** JetBrains Mono's
  slashed zero, at hero size in light grey, reads as a switch icon, not "0". It
  is the first thing on every new entry. *`entry-expense`, `entry-transfer`*
- **Times have a leading zero.** They show as "06:14 PM" because
  `apps/web/lib/format.ts` asks for `hour: "2-digit"`. `"numeric"` gives
  "6:14 PM" in US English and still "18:14" in French or UK English.
  *`history`, `delete-entry`*
- **Content placed mid-screen.** Scan and Support place their content in the
  middle of the screen, leaving a gap under the title; every other screen starts
  at the top. *`scan`, `tip`*
- **Quick-split result.** Names (Ana, Bo, Cy) are grey while their totals are
  black, so the person reads as the secondary item. *`quick-result`*
- **Labels that say too little.** "rest" on every row of the split and payer
  editors; "yours" alone in the rate dialog; "the other side: picking swaps
  them" in the transfer picker; "Advanced" in the home menu.
  *`expense-split-amounts`, `payers`, `rate`, `transfer-who`, `groups-menu`*
- **Dollars in a euro group.** The Support page and its button use `$` ("$1.67
  each") in a euro group. This is deliberate (the donation is in USD) but
  clashes. The header comment in `apps/web/app/g/tip/page.tsx` is also stale: it
  says 10,000 scans and four ways, while the screen says 4,000 and the group's
  own size. *`tip`, `group-balances`*

## Keep

Worth protecting when fixing the above:

- The ledger's two lines per entry (the total, then what it means for you, with
  "not yours" faded).
- The payer editor's subtitle, which shows the amount to reach.
- Inline, specific errors: "€15.00 left to split", "€25.00 more than the entry".
- History's strike-through edits.
- The import error that names the line and the format it expected.
- The About page's table of what the server can see.
