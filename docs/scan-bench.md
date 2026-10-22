# Scan benchmark

*For: whoever changes the scan prompt and wants to know what it did to a
stranger's receipts. Part of the [receipt-scanning](receipt-scanning.md) docs.
Run by hand, once per question — nothing in the gate runs it, and it spends
real money on the owner's Vertex key (cents a run).*

```bash
node scripts/scan-bench/fetch.mjs                 # once: WildReceipt (~185 MB) and a 50-receipt sample
node scripts/scan-bench/run.mjs                   # every receipt three times, labelled with the commit
node scripts/scan-bench/score.mjs LABEL [LABEL…]  # side by side, then every receipt not always accepted
```

Everything lands in `scripts/scan-bench/data/`, gitignored: the dataset's
licence is unstated, so its images never enter the repo. The key is
`VERTEX_API_TOKEN`, from the environment or `.env`.

## What it runs

**The scan as the working tree has it**, minus the network around it:
`buildScanRequestBody` to the Worker's Vertex endpoint, then
`parseScanResponse`, `correctOneLine` and `checkScan`, exactly as
`scanReceipt` does. Each image is first shrunk the way the phone shrinks a
photo — a megapixel, JPEG at 0.7, in Chromium — but not cropped to the bill:
these are photos of the bill already. A run's label defaults to the commit,
`-dirty` when the prompt has unsaved edits, so a change is measured by running
before and after and scoring both labels together.

**Three reads per receipt, because Gemini doesn't answer the same way twice.**
One read of 50 moves a receipt or two either way with no change at all; a
receipt accepted 3/3 before and 0/3 after has changed.

## The dataset

[WildReceipt](https://download.openmmlab.com/mmocr/data/wildreceipt.tar): 1,740
receipts photographed in the wild, 472 in the test split the sample is drawn
from (`--count`, `--seed`; the same seed draws the same receipts anywhere).
Mostly English and American — a handful in euros, none Polish — so it says
the scan reads well, and little about the bills this app's people bring.

Its labels are **boxes, not records**: a name, a count and a price are not
linked, and each box has its spaces stripped. So `score.mjs` compares text
with spaces, punctuation and accents removed, scores lines as bags, and counts
a labelled box as found inside a longer line the model read — the labels split
a wrapped or two-language line, and a modifier ("Medium"), into boxes of their
own.

## Reading a score

| Line | Right when |
|---|---|
| accepted by checkScan | the phone would have used the reading at all |
| accepted but wrong | **the one that costs money**: accepted, with a total or date that disagrees with the labels — each listed under the table, since the labels misread a date as often as the model does |
| total, date | the figure, or the day in any order a till prints one, matches a labelled box |
| title | the merchant's name appears anywhere on the receipt — the labels hold the legal name where the model gives the shop's |
| tax consistent | a taxed bill was accepted: the labels can't say whether a tax was on top or included, but an accepted reading adds up to the printed total |
| lines right / found | a model line matches a labelled item, and the reverse |
| amounts right / found | line amounts against the labelled prices, exactly |

**The table cannot say whether a refusal was right.** A photo cut off above
its total should be refused, and is scored as a miss. The list under the table
names every receipt some run did not always accept: open those images
(`data/sample/imgs/`) and judge each by eye before calling a change better or
worse.

## Gotchas

- **WildReceipt is old enough to be in Gemini's training data.** A score here
  is an upper bound on a bill it has never seen.
- **The labels are wrong too.** A shop name only in a logo, a web address left
  blank, a "0ct" for "Oct": every miss the table reports is worth a look
  before it is believed.
