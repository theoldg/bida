# Scan benchmark log

*What each run of the [scan benchmark](../../docs/scan-bench.md) found, newest
first. An entry names the prompt it measured (the run's label), the sample and
the reads, then every failure judged by eye — the score alone can't tell a
right refusal from a wrong one, nor the model's mistake from the labels'.
Receipt ids are the default sample's (`--seed 20261022`); the images are in
`data/sample/imgs/` once `fetch.mjs` has run.*

## 2026-10-22 — `b1b055c7`, receipts r50–r149, one read each, refusals read twice

| | |
|---|---|
| accepted on the first read | 72/100 — r120 passed its second |
| accepted but wrong | 0 — the 2 reads flagged were the labels' dates (r62 prints 13/07/2016, r69 09/03/12) |
| total · date · title | 96% · 96% · 96% |
| line amounts right · found | 93% · 98% |

**18 good receipts refused, none accepted wrong.** All but r120 refused twice.

- **Lines printed without a price** (6) — modifiers and set-meal parts
  (r57 "Sunrsr", r71 a McDonald's meal's "L Sprite", r74 "Vittel", r95 German
  "mit Koriander"), a delivery docket pricing only its subtotal (r86), r120 on
  its first read. Each comes back as an item with no amount, refused as
  unreadable; counted as nothing, every one of these bills adds up.
- **A misread figure** (4) — r87 (CVS: a "SAVED" column beside the prices),
  r90 (an angled shot, one line doubled), r136 and r148 (450px photos; a GST of
  12.05 read 12.06).
- **Tax already included, charged again** (2) — r55 (Shell Canada, "Fuel
  includes GST 1.57"), r101 (Spanish "I.V.A. 10.00%" under prices that include
  it).
- **Cash rounding** (2) — r83 (subtotal 37.01, "Bal due 37.00", no adjustment
  line), r124 ("Roundup amount 1,971.00" against 1,971.11). The stated total is
  the rounded one, and checkScan allows no difference at all.
- **A discount already taken off, subtracted again** (1) — r127 ("1.99 Dsc"
  notes under lines already discounted).
- **A credit printed without a minus, read as an item** (1) — r65 (Walmart
  "Container tend", a bottle-return credit).
- **The subtotal read as a charge** (1) — r100 ("Mdse st 25.98").
- **A slip with a total and no items, refused** (1) — r73 ("Grand Total
  $61.56"); r08's slip in the first 50 was accepted 4/4.

**Refused rightly** (10): r52, r78, r82, r91, r112, r117 are cut off above
their total; r54 is a card slip with no total, r84 a printer test page; r104
is cut off too, though refused for reading the Visa line as a charge; r137 is
cut off above its total and the model **invented one** (71.87) — refused only
because its "Water" line has no price.

## 2026-10-22 — `b1b055c7`, receipts r00–r49, three reads each

| | |
|---|---|
| accepted by checkScan | 116/150 reads |
| accepted but wrong | 0 — the 6 reads flagged were the labels' dates (r29 prints 22-09-2014, r40 07-13-2017) |
| total · date · title | 100% · 93% · 93% (the remaining misses are the labels') |
| line amounts right · found | 96% · 99% |

**7 good receipts refused, none accepted wrong.**

- **A discount already taken off, subtracted again** — r01 (Spanish "Pagado
  25% Fanta", "Pagado Vale Dto"), r42 ("BB savings"), r48 ("20% off 1 item",
  already inside the subtotal). 9/9 reads; the lines alone come to the total.
- **A tip printed after the total** — r12: "Order Total 19.38", then "+ Tip:
  3.00". The tip comes back as a charge, the total as 19.38. 3/3.
- **A misread figure, caught by `checkScan`** — r17 (a set's iced tea read as
  $2.50 on a 300×400 photo), r49 (a 49-line Morrisons roll, off by £0.16).
  3/3 each.
- **Unpriced modifier lines** — r18: "White", "Medium", "Smokey Ranch" as items
  with no amount, refused as unreadable. 1/3.

**Refused rightly:** r22, r25, r46 print a $0.00 total — though `checkScan`
calls that a `mismatch`, whose message asks for a flatter photo; r26 is a stock
image whose figures don't add up; r38 is cut off above its total.
