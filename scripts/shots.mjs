#!/usr/bin/env node
/**
 * `pnpm shots` — photograph every screen in one browser launch.
 *
 * The owner asked for this loop and asked us not to lean on it: use it after
 * building or changing a screen, or when something looks wrong. Not after every
 * edit. See docs/standing-instructions.md.
 *
 * What it does, in order:
 *   0. builds the static export if it is missing or stale;
 *   1. serves it over http — not `next dev`, because the export is what
 *      actually ships and it has its own quirks;
 *   2. drives the real UI to seed a group, members and expenses, so the shots
 *      show a populated ledger rather than eight empty states. Seeding through
 *      the UI rather than by poking IndexedDB means the harness also fails when
 *      a screen it isn't photographing is broken;
 *   3. walks every route in both themes and writes one PNG each into shots/.
 *
 * Chromium comes from PLAYWRIGHT_BROWSERS_PATH (already on disk in the agent
 * environment). Never run `playwright install`.
 */
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, ensureBuild, serveExport, launch, newPhone, pick, newGroup }
  from "./lib/harness.mjs";
import { PHOTO, stubScan } from "./lib/receipts.mjs";

const SHOTS = join(ROOT, "shots");

/** Build a group with three people and one of each kind of entry, via the UI. */
async function seed(page, base) {
  const groupId = await newGroup(page, base, {
    name: "Marrakech", me: "Theo", members: ["Marie", "Sam"],
  });

  // A plain expense, then a co-sponsored one.
  await addExpense(page, base, groupId, { amount: "4800", what: "Riad Jnane" });
  await addExpense(page, base, groupId, { amount: "6200", what: "Dinner", coSponsor: true });
  // Then the two rows the personal lens exists for: one somebody else paid
  // that you owe a share of (red), and one with nothing to do with you (faded).
  await addExpense(page, base, groupId, { amount: "900", what: "Taxi", paidBy: "Marie" });
  // One in the currency the trip is actually spent in, so the ledger shows a
  // converted figure and the registry has a row worth photographing.
  await addExpense(page, base, groupId, {
    amount: "62000", what: "Café Clock", currency: "MAD", rate: "0.0921",
  });
  await addExpense(page, base, groupId, {
    amount: "450", what: "Marie's sunglasses", paidBy: "Marie", exclude: "Theo",
  });

  // One of each of the other two kinds, so the ledger shot shows what the
  // ledger actually holds: an income's verb and signed figure, and a transfer
  // between two people (ADR-0010).
  await addEntry(page, base, groupId, { kind: "Income", amount: "1500", what: "Deposit back" });
  await addTransfer(page, base, groupId, { amount: "800", from: "Sam", to: "Theo" });

  // ...and one edit, so the history screens have a revision that is not just a
  // create: something with a diff to render. Two fields, because an entry is
  // saved whole and that is what a revision usually looks like — the shot
  // should show the sentence *and* the line under it.
  await page.getByText("Riad Jnane").click();
  await page.waitForURL(/\/g\/entry\?/);
  await page.getByRole("link", { name: "Edit" }).click();
  await page.waitForURL(/entry\/edit/);
  await page.locator("input.amount").fill("5100");
  await page.locator("#what").fill("Riad Jnane, two nights");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\?id=/);
  return groupId;
}

const addExpense = (page, base, groupId, opts) => addEntry(page, base, groupId, opts);

async function addEntry(
  page, base, groupId, { kind, amount, what, coSponsor, paidBy, exclude, currency, rate },
) {
  await page.goto(`${base}/g/entry/edit?id=${groupId}`);
  if (kind) await page.getByRole("tab", { name: kind }).click();
  // Currency first: picking one the group has no rate for opens the rate
  // dialog on the spot, and there is no feed behind the static export, so the
  // number is typed the way a phone with no signal would have to type it.
  if (currency) {
    await pick(page, '[aria-label="Currency"]', currency);
    const dialog = page.locator("dialog.scrim");
    if (await dialog.count() > 0) {
      await page.getByRole("textbox", { name: `Rate, ${currency} to EUR` }).fill(rate);
      await page.getByRole("button", { name: "Save" }).last().click();
      await page.waitForTimeout(200);
    }
  }
  await page.locator("input.amount").fill(amount);
  await page.locator("#what").fill(what);
  if (paidBy) await pick(page, "#paidby", paidBy);
  // The split editor is on this form now (ADR-0010), so leaving somebody out
  // is a tap here rather than a trip to a screen and back.
  if (exclude) await page.getByRole("button", { name: `Leave ${exclude} out` }).click();
  if (coSponsor) {
    await page.getByRole("link", { name: /several people put money in/i }).click();
    await page.waitForURL(/\/g\/payers/);
    // Marie chips in 20,00; whoever was already paying takes the rest.
    const marie = page.locator(".rows .row").filter({ hasText: "Marie" });
    await marie.getByRole("button", { name: /put money in too/i }).click();
    await marie.getByLabel(/contribution/).fill("2000");
    // ...and the person who was already paying takes the remainder.
    await page.locator(".rows .row").filter({ hasText: "Theo" })
      .getByRole("button", { name: /the rest$/i }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForURL(/entry\/edit/);
  }
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\?id=/);
}

/** A transfer: no split, no payer picker, two sides and an arrow. */
async function addTransfer(page, base, groupId, { amount, from, to }) {
  await page.goto(`${base}/g/entry/edit?id=${groupId}&kind=transfer`);
  await page.waitForSelector(".transfer");
  await page.locator("input.amount").fill(amount);
  await pickSide(page, "Who sent it", from);
  await pickSide(page, "Who received it", to);
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\?id=/);
}

/** Each side of a transfer opens our own picker now, not a <select> (ADR-0008). */
const pickSide = (page, label, name) => pick(page, `[aria-label="${label}"]`, name);

const routes = (g) => [
  ["groups", "/"],
  ["new", "/new"],
  ["group-ledger", `/g?id=${g}`],
  ["group-balances", `/g?id=${g}&tab=balances`],
  ["members", `/g/members?id=${g}`],
  ["claim", `/g/claim?id=${g}`],
  ["history", `/g/history?id=${g}`],
  ["rates", `/g/rates?id=${g}`],
  ["entry-expense", `/g/entry/edit?id=${g}`],
  ["entry-transfer", `/g/entry/edit?id=${g}&kind=transfer`],
];

async function main() {
  ensureBuild();
  await rm(SHOTS, { recursive: true, force: true });
  await mkdir(SHOTS, { recursive: true });

  const { base, close } = await serveExport();
  const browser = await launch();
  try {
    for (const theme of ["light", "dark"]) {
      const context = await newPhone(browser, { deviceScaleFactor: 2, colorScheme: theme });
      const page = await context.newPage();
      const groupId = await seed(page, base);

      for (const [name, path] of routes(groupId)) {
        await page.goto(base + path);
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(SHOTS, `${theme}-${name}.png`) });
        process.stdout.write(`${theme}/${name} `);
      }

      // Settling up is entering a transfer, so tapping a suggested payment
      // lands on the entry form with the kind, both sides and the amount
      // already filled — the one place that state gets photographed.
      await page.goto(`${base}/g?id=${groupId}&tab=balances`);
      await page.locator("a.card").first().click();
      await page.waitForURL(/entry\/edit/);
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(SHOTS, `${theme}-entry-transfer-prefilled.png`) });
      process.stdout.write(`${theme}/entry-transfer-prefilled `);

      // ...and the picker behind either side of it, which is a <dialog> rather
      // than the browser's wheel (ADR-0008), so it has no URL of its own.
      await page.getByLabel("Who received it").click();
      await page.waitForSelector(".dlist");
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-transfer-who.png`) });
      process.stdout.write(`${theme}/transfer-who `);
      await page.keyboard.press("Escape");

      // An income: the same form with the segmented control flipped, so the
      // relabelled payer picker and the missing Receipt tab are visible.
      await page.goto(`${base}/g/entry/edit?id=${groupId}`);
      await page.getByRole("tab", { name: "Income" }).click();
      await page.locator("input.amount").fill("300");
      await page.locator("#what").fill("Deposit back");
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-entry-income.png`) });
      process.stdout.write(`${theme}/entry-income `);

      // A half-finished "as amounts" split: the one state where the editor has
      // something to say about money that doesn't add up, and the field you
      // type that money into is in it.
      await page.goto(`${base}/g/entry/edit?id=${groupId}`);
      await page.locator("input.amount").fill("120");
      await page.locator("#what").fill("Hammam");
      await page.getByRole("button", { name: "As amounts" }).click();
      // 25 of the 120, deliberately: the shot is there to catch the shortfall
      // line, which is the sentence that used to say "9500 minor units".
      await page.getByLabel(/Marie.s amount/).fill("25");
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-expense-split-amounts.png`) });
      process.stdout.write(`${theme}/expense-split-amounts `);

      // Who paid, mid-allocation: the payer side's verdict line, in the two
      // colours the split editor's own footer uses. It hangs off the draft the
      // block above just typed, which is why it can't be reached by URL.
      await page.getByRole("link", { name: /several people put money in/i }).click();
      await page.waitForURL(/\/g\/payers/);
      await page.locator(".rows .row").filter({ hasText: "Marie" })
        .getByRole("button", { name: /put money in too/i }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-payers.png`) });
      process.stdout.write(`${theme}/payers `);

      // Who had what — the one screen only a scan leads to. The draft is in
      // memory, so it is reached by really uploading a photo, with the model's
      // answer stubbed from the same canned bill `pnpm drive` uses
      // (`lib/receipts.mjs`). It is long on purpose: the header of initials
      // freezing over a bill that outruns the screen is what the shot shows.
      // Shot twice: the bill as printed, then with its "×2" salad unfolded
      // into two separately assignable portions.
      await stubScan(page, "cafe-clock");
      await page.goto(`${base}/g/entry/edit?id=${groupId}`);
      await page.waitForTimeout(200);
      await page.locator('input[aria-label="Upload a receipt photo"]')
        .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PHOTO });
      await page.waitForURL(/entry\/items/);
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(SHOTS, `${theme}-who-had-what.png`) });
      process.stdout.write(`${theme}/who-had-what `);
      await page.getByRole("button", { name: /^Split Salade marocaine/ }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-who-had-what-unfolded.png`) });
      process.stdout.write(`${theme}/who-had-what-unfolded `);

      // Adding someone is the last row of the list, mid-name — boxed, because
      // that name is not on the list until its plus is pressed.
      await page.goto(`${base}/g/members?id=${groupId}`);
      await page.getByLabel("Add someone").fill("Nadia");
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-add-member.png`) });
      process.stdout.write(`${theme}/add-member `);

      // Forgetting lives only in the groups list's row menu, so the shot goes
      // through it: a right click opens the menu, and the confirmation is the
      // dialog this app draws in place of confirm() (ADR-0008).
      await page.goto(`${base}/`);
      await page.locator(".rows .row").first().click({ button: "right" });
      await page.getByRole("menuitem", { name: "Forget group" }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-forget.png`) });
      process.stdout.write(`${theme}/forget `);

      // The rate dialog: one number, both ways round, and the sentence saying
      // how much of the ledger moves if it changes.
      await page.goto(`${base}/g/rates?id=${groupId}`);
      await page.waitForSelector(".rows button.row");
      await page.locator("button.row").filter({ hasText: "MAD" }).click();
      await page.waitForSelector("dialog.scrim");
      await page.getByRole("textbox", { name: "Rate, MAD to EUR" }).fill("0.093");
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-rate.png`) });
      process.stdout.write(`${theme}/rate `);

      // Deleting an entry — the last thing in the app that asked with the
      // browser's own confirm(). Opened and photographed, never confirmed.
      await page.goto(`${base}/g?id=${groupId}`);
      await page.getByText("Riad Jnane").click();
      await page.waitForURL(/\/g\/entry\?/);
      await page.getByRole("button", { name: "Delete" }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-delete-entry.png`) });
      process.stdout.write(`${theme}/delete-entry `);
      await context.close();
    }
    console.log(`\nshots written to ${SHOTS}`);
  } finally {
    await browser.close();
    close();
  }
}

await main();
