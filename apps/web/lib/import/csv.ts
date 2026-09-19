/**
 * CSV bytes into rows, and nothing beyond that.
 *
 * This lives in `apps/web` rather than `packages/core` for the reason core is
 * pure: a CSV dialect is a parsing decision about somebody else's file, not
 * domain arithmetic. `core/import.ts` takes the rows this hands over and is
 * where the money lives.
 *
 * **Liberal on input, strict on output.** `core/export.ts` writes one exact
 * byte shape — LF, no BOM, blank lines where Splitwise puts them — because
 * Tricount refuses the whole file over any of them. Reading has the opposite
 * job: a file arriving here has been through somebody else's export, possibly
 * Excel, possibly a mail client, and CRLF, a lone CR, a BOM and a missing
 * trailing newline are all things it may carry. Every one is accepted.
 *
 * A real state machine, and not `split("\n")` then `split(",")`, for one
 * reason worth the forty lines: RFC 4180 allows a newline **inside** a quoted
 * cell, and a description somebody typed on a phone is exactly where one
 * turns up. Our own writer folds those to spaces, so our own files never need
 * this — someone else's do, and splitting on LF first turns one description
 * into two broken rows that then fail the row-sums-to-zero check with nothing
 * useful to say about why.
 */

/**
 * Every record in the file, cells unquoted, in order.
 *
 * Blank lines are kept as rows of one empty cell rather than dropped: they are
 * structure in this format (the shape has three), `core/import.ts` skips them
 * by value, and keeping them is what makes the line numbers in a refusal match
 * what the person sees in their spreadsheet.
 */
export function parseCsv(text: string): string[][] {
  // The BOM, if there is one, belongs to the file and not to the first cell.
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;

  const endCell = () => { cells.push(cell); cell = ""; };
  const endRow = () => { endCell(); rows.push(cells); cells = []; };

  while (i < src.length) {
    const ch = src[i]!;

    if (quoted) {
      if (ch === '"') {
        // A doubled quote is one quote; a single one closes the cell.
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      // Only at the start of a cell is a quote a quote. Mid-cell it is a
      // character somebody typed, in a file whose writer didn't escape it —
      // treating it as an opener there swallows the rest of the file.
      if (cell === "") { quoted = true; i += 1; continue; }
      cell += ch;
      i += 1;
      continue;
    }

    if (ch === ",") { endCell(); i += 1; continue; }

    // CRLF, LF and a lone CR are all one record break. The last is a file off
    // a very old Mac or a very confused exporter, and costs one branch.
    if (ch === "\r") { endRow(); i += src[i + 1] === "\n" ? 2 : 1; continue; }
    if (ch === "\n") { endRow(); i += 1; continue; }

    cell += ch;
    i += 1;
  }

  // Whatever is still in hand is the last record — unless the file ended on a
  // newline, in which case there is nothing there and adding a row would
  // invent a blank line the file does not have.
  if (cell !== "" || cells.length > 0) endRow();
  return rows;
}

/**
 * As big as a group's ledger could plausibly be, and then some — a thousand
 * entries across twenty people is under a megabyte.
 *
 * Not a security boundary: the file never leaves the phone and no server ever
 * sees it, so the only thing at risk is this tab. It is so a mis-picked video
 * is refused with a sentence instead of freezing the app on the way to the
 * same answer.
 */
const MAX_CSV_BYTES = 8 * 1024 * 1024;

/** Too big to be a ledger — see `MAX_CSV_BYTES`. */
export function tooBig(bytes: number): boolean {
  return bytes > MAX_CSV_BYTES;
}

/** A CSV this could be: the extension or the media type, either will do. */
export function looksLikeCsv(file: File): boolean {
  return /\.(csv|txt)$/i.test(file.name)
    || file.type === "text/csv"
    || file.type === "text/plain"
    // Safari hands over a CSV from Files with no type at all, which is not a
    // reason to refuse the one file the person went and picked.
    || file.type === "";
}

/**
 * The group name a file arrives with, since the shape has nowhere to say it.
 *
 * Splitwise names the export after the group, and so does `exportFilename`.
 * Both suffixes come off, the separators become spaces, and what's left is a
 * suggestion in an editable field — never a fact, because a file renamed by a
 * mail client says nothing about the trip.
 */
export function groupNameFrom(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\bexport\b/gi, "")
    // The date our own filename ends with, which is the day it left and not
    // part of what the group is called.
    .replace(/\b\d{4}[- ]\d{2}[- ]\d{2}\b/g, "")
    .replace(/^\s*bida\b/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
