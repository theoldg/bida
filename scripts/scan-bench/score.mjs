#!/usr/bin/env node
/**
 * Scores runs against WildReceipt's labels, side by side. By hand —
 * docs/scan-bench.md, which says what each line means and what it cannot see.
 *
 *   node scripts/scan-bench/score.mjs LABEL [LABEL…]
 *
 * WildReceipt labels boxes, not records: a name, a count and a price are not
 * linked, and every box has its spaces stripped. So text is compared with
 * spaces, punctuation and accents removed; lines are scored as bags; and a
 * labelled box counts as found inside a longer line, since the labels split a
 * wrapped or two-language line, and a modifier ("Medium"), into boxes of
 * their own.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DATA = join(import.meta.dirname, "data");
const labels = process.argv.slice(2);
if (!labels.length) {
  const runs = join(DATA, "runs");
  console.log(`usage: score.mjs LABEL [LABEL…]\nruns: ${existsSync(runs) ? readdirSync(runs).join(" ") : "none"}`);
  process.exit(1);
}
const { receipts } = JSON.parse(readFileSync(join(DATA, "sample/truth.json"), "utf8"));

const norm = (s) => (s ?? "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** A printed amount ("$1,234.50", "Eur154,40", "12.00-") in cents; the last one in the box. */
function cents(s) {
  if (s == null) return null;
  const all = String(s).replace(/O/g, "0").match(/\d[\d.,]*[.,]\d{2}(?!\d)/g);
  if (!all) return null;
  const m = all.at(-1);
  return Number(m.slice(0, -3).replace(/\D/g, "") || 0) * 100 + Number(m.slice(-2));
}

/** Levenshtein-based similarity, 0–1. */
function similar(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length, 1);
}

/** Each month as English, French, Spanish, Italian and German tills shorten it, accents dropped. */
const MONTHS = [
  ["jan", "janv", "ene", "gen"], ["feb", "fev"], ["mar", "mars"], ["apr", "avr", "abr"],
  ["may", "mai", "mag"], ["jun", "juin", "giu"], ["jul", "juil", "lug"], ["aug", "aout", "ago"],
  ["sep", "set"], ["oct", "okt", "ott"], ["nov"], ["dec", "dic", "dez"],
];

/** Does the printed date read as the model's day, in any order a till prints one? */
function dateRight(model, printed) {
  if (!printed.length) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(model ?? "");
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return false;
  // The labels' own misreading: "0ct25'14".
  const p = norm(printed.join(" ")).replace(/0(?=ct)/g, "o");
  const [y, mo, d] = [m[1], m[2], m[3]];
  const forms = [];
  for (const Y of [y, y.slice(2)]) {
    for (const M of [mo, String(Number(mo))]) {
      for (const D of [d, String(Number(d))]) forms.push(M + D + Y, D + M + Y, Y + M + D);
    }
    for (const D of [d, String(Number(d))]) {
      for (const mon of MONTHS[Number(mo) - 1]) forms.push(mon + D + Y, D + mon + Y, mon + D);
    }
  }
  return forms.some((f) => p.includes(f));
}

const labelMatch = (a, b) => {
  [a, b] = [norm(a), norm(b)];
  if (!a || !b) return false;
  return a.includes(b) || (b.includes(a) && a.length >= 4) || similar(a, b) >= 0.8;
};
const holds = (line, box) => norm(box).length >= 4 && norm(line).includes(norm(box));

/** The merchant anywhere the receipt prints it: the labels hold a legal name where the model gives the shop's. */
function titleRight(title, receipt) {
  const name = norm(title.split(" - ")[0]);
  if (name.length < 3) return false;
  if (norm(receipt.boxes.join("")).includes(name)) return true;
  const store = norm(receipt.store.join(""));
  return store.length > 0 && similar(name, store) >= 0.7;
}

function score(receipt, run) {
  const s = { id: `${run.id}.${run.n}`, outcome: run.outcome };
  if (run.outcome === "rejected") return s;
  const r = run.result;
  const accepted = run.outcome === "ok" || run.outcome === "corrected";

  const totals = new Set(receipt.total.map(cents).filter((c) => c !== null));
  s.total = totals.size ? totals.has(cents(r.total)) : null;
  s.date = dateRight(r.date, receipt.date);
  s.title = r.title ? titleRight(r.title, receipt) : null;

  // Included VAT is not a charge, and the labels can't say which a tax was;
  // checkScan can: an accepted scan comes to its printed total, so its tax was
  // treated consistently, and a mismatch on a taxed bill counts against it.
  const taxed = receipt.tax.map(cents).some((c) => c);
  s.tax = !taxed || !(accepted || run.outcome === "mismatch") ? null : accepted && s.total !== false;

  const model = r.lineItems.map((li) => li.label);
  s.linesRight = model.filter((m) => receipt.item.some((g) => labelMatch(m, g) || holds(m, g))).length;
  s.lines = model.length;
  s.boxesFound = receipt.item.filter((g) => model.some((m) => labelMatch(m, g) || holds(m, g))).length;
  s.boxes = receipt.item.length;

  // Prices as bags: the labels' price boxes may hold unit prices too.
  const gold = receipt.price.map(cents).filter((c) => c !== null);
  const mine = run.lines.filter((c) => c !== null);
  const pool = [...gold];
  s.amountsRight = mine.filter((c) => {
    const i = pool.indexOf(c);
    return i >= 0 && pool.splice(i, 1);
  }).length;
  s.amounts = mine.length;
  s.prices = gold.length;
  // The failure that costs money: accepted, and wrong.
  s.silentlyWrong = accepted && (s.total === false || s.date === false);
  if (s.silentlyWrong) {
    s.why = `total ${r.total} (labels ${receipt.total.join(" ")}), date ${r.date} (labels ${receipt.date.join(" ")})`;
  }
  return s;
}

function load(label) {
  const dir = join(DATA, "runs", label);
  const byId = new Map(receipts.map((r) => [r.id, []]));
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const run = JSON.parse(readFileSync(join(dir, file), "utf8"));
    byId.get(run.id)?.push(run);
  }
  const scores = receipts.flatMap((r) => byId.get(r.id).map((run) => score(r, run)));
  return { label, byId, scores };
}

const runs = labels.map(load);
const pct = (a, b) => (b ? `${a}/${b} ${String(Math.round((100 * a) / b)).padStart(3)}%` : "n/a");
const rate = (scores, k) => {
  const v = scores.filter((s) => s[k] != null);
  return pct(v.filter((s) => s[k]).length, v.length);
};
const sum = (scores, k) => scores.reduce((n, s) => n + (s[k] ?? 0), 0);
const accepted = (s) => s.outcome === "ok" || s.outcome === "corrected";

const ROWS = [
  ["reads", (s) => String(s.length)],
  ["accepted by checkScan", (s) => pct(s.filter(accepted).length, s.length)],
  ["accepted but wrong", (s) => String(s.filter((x) => x.silentlyWrong).length)],
  ["total", (s) => rate(s, "total")],
  ["date", (s) => rate(s, "date")],
  ["title", (s) => rate(s, "title")],
  ["tax consistent", (s) => rate(s, "tax")],
  ["lines right", (s) => pct(sum(s, "linesRight"), sum(s, "lines"))],
  ["labelled lines found", (s) => pct(sum(s, "boxesFound"), sum(s, "boxes"))],
  ["amounts right", (s) => pct(sum(s, "amountsRight"), sum(s, "amounts"))],
  ["labelled prices found", (s) => pct(sum(s, "amountsRight"), sum(s, "prices"))],
];
const W = 20;
console.log("".padEnd(24) + runs.map((r) => r.label.padStart(W)).join(""));
for (const [name, f] of ROWS) console.log(name.padEnd(24) + runs.map((r) => f(r.scores).padStart(W)).join(""));
const outcomes = [...new Set(runs.flatMap((r) => r.scores.map((s) => s.outcome)))].sort();
for (const o of outcomes) {
  console.log(`  ${o}`.padEnd(24) + runs.map((r) => String(r.scores.filter((s) => s.outcome === o).length).padStart(W)).join(""));
}

for (const { label, scores } of runs) {
  const wrong = scores.filter((s) => s.silentlyWrong);
  if (wrong.length) console.log(`\naccepted but wrong, ${label}:\n${wrong.map((s) => `  ${s.id}  ${s.why}`).join("\n")}`);
}

/** Every receipt some run did not accept every time: the ones to look at, by eye. */
console.log("\nnot always accepted (accepted/reads, then each read's outcome):");
for (const { id, file } of receipts) {
  const cells = runs.map(({ byId }) => {
    const rs = byId.get(id);
    return `${rs.filter((x) => x.outcome === "ok" || x.outcome === "corrected").length}/${rs.length} ${rs.map((x) => x.outcome).join(",")}`;
  });
  if (cells.every((c) => /^(\d+)\/\1 /.test(c))) continue;
  const why = runs.map(({ byId }) => byId.get(id).find((x) => x.result.error)?.result.error).find(Boolean);
  console.log(`  ${id}  ${cells.map((c) => c.padEnd(40)).join("")}${file}${why ? `\n        "${why}"` : ""}`);
}
