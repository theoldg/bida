#!/usr/bin/env node
/**
 * `pnpm entries` — can you add, edit and read back all three kinds of entry?
 *
 * The command layer's own tests prove an income's sign reaches the balances and
 * that a transfer edit writes only what changed. What they structurally cannot
 * prove is that the *form* is wired to them: a Save button stuck disabled, a
 * segmented control that writes the wrong field, a detail screen that can't
 * find a settlement by id. This walks that wiring against the real export.
 *
 * Run it after touching /g/entry, /g/entry/edit or lib/entry-kind.ts —
 * `pnpm entries` builds first if it has to. ADR-0010.
 */
import { ensureBuild, serveExport, launch, newPhone, reporter, pick, newGroup }
  from "./lib/harness.mjs";

ensureBuild();
const { base, close } = await serveExport();
const browser = await launch();
const ctx = await newPhone(browser);
const page = await ctx.newPage();
const { report, finish } = reporter(page);

/**
 * Save, then wait for the ledger to have redrawn from Dexie. `waitForURL`
 * alone lands on the previous render, which is what makes a check like this
 * flaky if you let it.
 */
async function save(expectRows) {
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\?id=/);
  await page.waitForFunction(
    (n) => document.querySelectorAll(".rows a.row").length >= n, expectRows, { timeout: 8000 },
  );
}

// ---- seed --------------------------------------------------------------
const g = await newGroup(page, base, {
  name: "Trip", me: "Theo", members: ["Marie", "Sam"],
  async onForm() {
    // "Other…" is the one row that hands one dialog to the next rather than
    // closing: the picker has to stay out of the prompt's way.
    await pick(page, "#g-cur", "Other");
    await page.locator(".dinput").fill("uzs");
    await page.getByRole("button", { name: "Use it" }).click();
    await page.waitForTimeout(120);
    report((await page.locator("#g-cur").innerText()).includes("UZS"),
      "an unlisted currency is typed, not scrolled to");
    await pick(page, "#g-cur", "EUR");
  },
});

// ---- an expense --------------------------------------------------------
await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.locator("input.amount").fill("9000");
await page.locator("#what").fill("Dinner");

// The currency and the payer are the same dialog the transfer's sides use.
// Introducing a currency the group has no rate for asks for one on the spot —
// this is the whole point of the registry, and the state that used to sail
// through with rateToBase stuck at "1" (ADR-0005).
await pick(page, '[aria-label="Currency"]', "USD");
report((await page.locator('[aria-label="Currency"]').innerText()).includes("USD"),
  "the currency picker sets the currency");
await page.waitForSelector('dialog[aria-label="USD rate"]');
report(true, "a currency the group has no rate for opens the rate dialog by itself");

// Both directions of one number, and they move together. There is no feed
// behind the static export, so this is also the path a phone with no signal
// takes: the fields are typeable and the dialog says so.
const forward = page.getByRole("textbox", { name: "Rate, USD to EUR" });
const inverse = page.getByRole("textbox", { name: "Rate, EUR to USD" });
report(await forward.count() === 1 && await inverse.count() === 1,
  "the rate dialog offers the rate both ways round");
await forward.fill("0.8");
await page.waitForTimeout(80);
report((await inverse.inputValue()) === "1.25", "typing one direction fills in the other");
await inverse.fill("4");
await page.waitForTimeout(80);
report((await forward.inputValue()) === "0.25", "and it works the other way too");
await forward.fill("0.8");
await page.waitForTimeout(80);
await page.getByRole("button", { name: "Save" }).last().click();
await page.waitForTimeout(200);
report(await page.locator("dialog.scrim").count() === 0, "saving the rate closes the dialog");
report((await page.getByLabel("Set the USD rate").innerText()).includes("0.8"),
  "the form's rate line shows what the group now says");

// Picked a second time, the rate is already the group's, so nothing is asked.
await pick(page, '[aria-label="Currency"]', "EUR");
report(await page.getByLabel("Set the USD rate").count() === 0,
  "picking the base currency puts the rate away");
await pick(page, '[aria-label="Currency"]', "USD");
await page.waitForTimeout(150);
report(await page.locator("dialog.scrim").count() === 0,
  "a currency the group already has a rate for asks nothing");
await pick(page, '[aria-label="Currency"]', "EUR");

await pick(page, "#paidby", "Marie");
report((await page.locator("#paidby").innerText()).includes("Marie"), "the payer picker sets the payer");
await pick(page, "#paidby", "Theo");

await save(1);
report(await page.getByText("Dinner").count() > 0, "an expense saves and lists");

// ---- an income ---------------------------------------------------------
await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.getByRole("tab", { name: "Income" }).click();
await page.locator("input.amount").fill("300");
await page.locator("#what").fill("Deposit back");
report(await page.getByText("Received by").count() > 0, "an income relabels the payer picker");
report(await page.getByText("Shared with").count() > 0, "an income relabels the split");
report(await page.getByRole("button", { name: "Receipt" }).count() === 0, "an income offers no Receipt tab");

// Who put the money in is a different question on an income, and the screen
// that asks it has to be asked in the same voice throughout: the title used to
// switch on its own, so "Who received it" was followed by "didn't pay".
await page.getByRole("link", { name: "Multi-recipient" }).click();
await page.waitForURL(/\/g\/payers/);
const payerScreen = await page.locator(".rows").innerText();
report(/receive/.test(payerScreen) && !/pay/.test(payerScreen),
  "the payers screen asks an income in the income's voice");
await page.getByRole("button", { name: "Done" }).click();
await page.waitForURL(/entry\/edit/);
await save(2);
// No avatar marks it any more (ADR-0023): the verb and the sign are the two
// signals that an entry runs the other way.
report((await page.locator(".rmeta").first().innerText()).includes("received"), "the income row says received");
report((await page.locator(".ramt .big").first().innerText()).includes("+"), "the income row signs its figure");
report(await page.locator(".avatar").count() === 0, "no screen of the ledger draws a person's initials");

// ---- a transfer, reached the way a reimbursement is ---------------------
await page.goto(`${base}/g?id=${g}&tab=balances`);
await page.waitForSelector("a.card");
report(await page.locator("a.card").count() === 2, "settle-up suggests the payments");
await page.locator("a.card").first().click();
await page.waitForURL(/entry\/edit/);
await page.waitForSelector(".transfer");
// (9000 − 300) ÷ 3. If this figure moves, an income stopped reducing the debt.
report((await page.locator("input.amount").inputValue()).replace(/\s/g, "") === "2900.00",
  "settle-up pre-fills the transfer, income already netted off");
const wasFrom = await page.locator(".tside .who").first().innerText();
await page.locator(".tswap").click();
await page.waitForTimeout(100);
report((await page.locator(".tside .who").last().innerText()) === wasFrom, "the arrow swaps the two sides");
await page.locator(".tswap").click();
await page.waitForTimeout(100);
// Either side opens the app's own picker, never a <select> (ADR-0008), and the
// person already on the other side is in it as a reversal rather than an error.
// Nothing on this form is a native picker any more — the currency and the payer
// went the same way — so the assertion is the whole screen, not the card.
report(await page.locator("select").count() === 0, "no screen of the form has a <select>");
await page.getByLabel("Who sent it").click();
await page.waitForSelector(".dlist");
const otherSide = await page.locator(".tside .who").last().innerText();
report((await page.locator(".drow-pick").filter({ hasText: otherSide }).innerText()).includes("swaps"),
  "the picker offers the other side as a swap");
await page.locator(".drow-pick").filter({ hasText: otherSide }).click();
await page.waitForTimeout(100);
report((await page.locator(".tside .who").first().innerText()) === otherSide
  && (await page.locator(".tside .who").last().innerText()) === wasFrom,
  "picking the other side swaps them");
await page.locator(".tswap").click();
await page.waitForTimeout(100);
await save(3);
report((await page.locator(".rmeta").allInnerTexts()).some((t) => t.startsWith("Transfer")),
  "a transfer saves and lists");

// ---- and every one of them is editable ---------------------------------
await page.locator("a.row").filter({ hasText: "paid" }).first().click();
await page.waitForURL(/\/g\/entry\?/);
await page.waitForSelector(".transfer");
report((await page.locator(".topbar h3").innerText()) === "Transfer", "a transfer has a detail screen");
await page.getByRole("link", { name: "Edit" }).click();
await page.waitForURL(/entry\/edit/);
await page.waitForSelector(".transfer");
report(await page.getByRole("tab").count() === 0, "editing a transfer offers no kind control");
await page.locator("input.amount").fill("12");
await save(3);
report((await page.locator(".ramt .big").allInnerTexts()).some((t) => t.includes("12")),
  "the transfer edit stuck");

await page.getByText("Dinner").first().click();
await page.waitForURL(/\/g\/entry\?/);
await page.getByRole("link", { name: "Edit" }).click();
await page.waitForURL(/entry\/edit/);
await page.waitForSelector("[role=tab]");
report(await page.getByRole("tab").count() === 2, "editing an expense offers expense and income only");
await page.getByRole("tab", { name: "Income" }).click();
await save(3);
report((await page.locator(".ramt .big").allInnerTexts()).filter((t) => t.includes("+")).length === 2,
  "an expense can become an income");

// ---- and a transfer's row answers a long press, as an expense's does ---
// It didn't: the delete menu was on the expense row only, so the one entry
// with no other way to remove it from the ledger was the transfer.
await page.locator("a.row").filter({ hasText: "paid" }).first().click({ button: "right" });
await page.waitForSelector(".rowmenu");
report(await page.getByRole("menuitem", { name: "Delete" }).count() === 1,
  "a long press on a transfer row offers to delete it");
await page.getByRole("menuitem", { name: "Delete" }).click();
await page.getByRole("button", { name: "Delete" }).click();
await page.waitForFunction(() => document.querySelectorAll(".rows a.row").length === 2, null, { timeout: 8000 })
  .catch(() => {});
report(!(await page.locator(".rmeta").allInnerTexts()).some((t) => t.startsWith("Transfer")),
  "and the transfer leaves the ledger");

// ---- and the log says what happened, in the app's own words ------------
await page.goto(`${base}/g/history?id=${g}`);
await page.waitForSelector(".tle");
const feed = (await page.locator(".what").allInnerTexts()).join(" | ");
for (const line of ["created this expense", "created this income", "recorded a transfer",
  "turned this into an income"]) {
  report(feed.includes(line), `history says "${line}"`);
}

// ---- the registry, and the thing it exists to do -----------------------
// A rate is the group's, not the entry's: correcting it moves every entry
// already written in that currency, which is what a per-entry frozen rate
// could never do (ADR-0005).
await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.locator("input.amount").fill("100");
await page.locator("#what").fill("Cab");
await pick(page, '[aria-label="Currency"]', "USD");
await page.waitForTimeout(150);
// The group already has a USD rate by now, so nothing is asked and the line
// under the amount reads it back: 100 USD at 0.8 is €80.00.
report((await page.getByLabel("Set the USD rate").innerText()).includes("80"),
  "the form converts at the group's rate");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForURL(/\/g\?id=/);
await page.waitForFunction(() => document.querySelectorAll(".rows a.row").length >= 3,
  null, { timeout: 8000 });
const cabBefore = await page.locator("a.row").filter({ hasText: "Cab" })
  .locator(".ramt .big").innerText();
report(cabBefore.includes("80"), "and banks it in the group's currency");

// Rates is in the group's top-bar menu now, not an icon of its own.
await page.locator(".topbar .iconbtn[aria-label='Group menu']").click();
await page.getByRole("menuitem", { name: "Rates" }).click();
await page.waitForURL(/\/g\/rates/);
await page.waitForSelector(".rows button.row");
report((await page.locator(".rows").first().innerText()).includes("USD"),
  "the registry lists the currency the group spent in");
await page.locator("button.row").filter({ hasText: "USD" }).click();
await page.waitForSelector('dialog[aria-label="USD rate"]');
await page.getByRole("textbox", { name: "Rate, USD to EUR" }).fill("0.4");
await page.waitForTimeout(100);
report(/re-values/i.test(await page.locator(".dbody").innerText()),
  "the dialog says how much of the ledger the change moves");
await page.getByRole("button", { name: "Save" }).last().click();
await page.waitForTimeout(300);

await page.goto(`${base}/g?id=${g}`);
await page.waitForSelector(".rows a.row");
const cabAfter = await page.locator("a.row").filter({ hasText: "Cab" })
  .locator(".ramt .big").innerText();
report(cabAfter.includes("40"),
  "correcting the rate re-values an entry that was already written");

// ---- the cent the form quotes is the cent the ledger keeps -------------
// A total that doesn't divide hands its leftover minor unit to somebody by
// `tiebreakSeed`, which is the entry's id. A form pricing its rows under a
// placeholder therefore showed the cent on one person's row and wrote it to
// another's — an arithmetic that was right both times and still disagreed with
// the screen that asked. The draft now carries the id it will be written
// under, so these two readings are the same reading.
await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.locator("input.amount").fill("10");
await page.locator("#what").fill("Coffee");
await page.waitForTimeout(120);
const rows = () => page.locator(".splitrow").allInnerTexts()
  .then((all) => all.map((t) => t.replace(/\s+/g, " ").trim()).join(" | "));
const quoted = await rows();
report(/3\.34/.test(quoted) && /3\.33/.test(quoted),
  "a total that doesn't divide shows somebody the extra cent");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForURL(/\/g\?id=/);
await page.waitForFunction(() => document.querySelectorAll(".rows a.row").length >= 4,
  null, { timeout: 8000 });
await page.locator("a.row").filter({ hasText: "Coffee" }).click();
await page.waitForURL(/\/g\/entry\?/);
await page.getByRole("link", { name: "Edit" }).click();
await page.waitForSelector(".splitrow");
report(await rows() === quoted, "and it is the same person once the entry is written");

// ---- an entry that isn't there any more still has a name ----------------
// Half the reason to open history is an entry that has been deleted, and the
// screen looked it up in the alive-only list — so every one of them was
// titled "Transfer", the branch a missing subject fell through to.
await page.goto(`${base}/g?id=${g}`);
await page.locator("a.row").filter({ hasText: "Coffee" }).click();
await page.waitForURL(/\/g\/entry\?/);
await page.getByRole("button", { name: "Delete" }).first().click();
await page.getByRole("button", { name: "Delete" }).last().click();
await page.waitForURL(/\/g\?id=/);
await page.goto(`${base}/g/history?id=${g}`);
await page.waitForSelector(".tle");
await page.getByRole("link", { name: /Coffee/ }).first().click();
await page.waitForURL(/\/g\/history\?.*e=/);
const titled = await page.locator(".sub").first().innerText();
report(/coffee/i.test(titled), `a deleted entry's history is titled by what it was — ${titled}`);

// ---- one press on Save is one entry ------------------------------------
// Save asked `ready`, which is a question about the form, not about whether a
// press is already spending it — so two taps landing before `router.replace`
// did both went through. A transfer was written twice, for twice the money,
// and an expense picked up a second create op that said nothing. Sent from the
// keyboard because two `click()`s are two waits with a settled screen between
// them; this is the one press arriving twice, which is what a thumb does.
async function pressSaveTwice() {
  await page.getByRole("button", { name: "Save" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/g\?id=/);
}

await page.goto(`${base}/g?id=${g}`);
await page.waitForSelector(".rows a.row");
const beforeDouble = await page.locator(".rows a.row").count();

await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.getByRole("tab", { name: "Transfer" }).click();
await page.waitForSelector(".transfer");
await page.locator("input.amount").fill("5");
await page.waitForTimeout(120);
await pressSaveTwice();
await page.waitForFunction(
  (n) => document.querySelectorAll(".rows a.row").length > n, beforeDouble, { timeout: 8000 },
);
await page.waitForTimeout(400);
report(await page.locator(".rows a.row").count() === beforeDouble + 1,
  "two presses on Save record one transfer, not two");

// The same press against a create that *is* idempotent — the draft's id makes
// the entry one entry either way — still had a revision to spare.
await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.locator("input.amount").fill("6");
await page.locator("#what").fill("Twice");
await page.waitForTimeout(120);
await pressSaveTwice();
await page.waitForFunction(
  () => [...document.querySelectorAll(".rows a.row")].some((r) => r.innerText.includes("Twice")),
  null, { timeout: 8000 },
);
await page.locator("a.row").filter({ hasText: "Twice" }).click();
await page.waitForURL(/\/g\/entry\?/);
await page.getByRole("link", { name: "History" }).click();
await page.waitForSelector(".tle");
const creates = (await page.locator(".what").allInnerTexts())
  .filter((t) => /created this expense/i.test(t)).length;
report(creates === 1, `one press creates the entry once — ${creates} create(s) in its history`);

await browser.close();
close();
finish();
