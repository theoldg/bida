/**
 * CSV bytes into rows, and nothing beyond that. Here rather than in core
 * because a CSV dialect is a parsing decision, not domain arithmetic;
 * `core/import.ts` takes the rows.
 *
 * **Liberal on input**, unlike `core/export.ts`'s one exact byte shape: CRLF,
 * a lone CR, a BOM and a missing trailing newline are all accepted.
 *
 * **A real state machine, never `split("\n")`** — RFC 4180 allows a newline
 * inside a quoted cell, and a phone-typed description is where one turns up.
 */

/**
 * Every record in the file, cells unquoted, in order. Blank lines are kept as
 * rows of one empty cell: they are structure (the shape has three), and
 * keeping them makes a refusal's line numbers match the spreadsheet.
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
 * Far above any plausible ledger (1000 entries × 20 people is under 1 MB).
 * **Not a security boundary** — the file never leaves the phone; it is so a
 * mis-picked video is refused rather than freezing the tab.
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
 * The group name a file arrives with: Splitwise and `exportFilename` both name
 * the file after the group. Suffixes off, separators to spaces. **A suggestion
 * in an editable field, never a fact** — mail clients rename files.
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
