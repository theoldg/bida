#!/usr/bin/env node
/**
 * `pnpm shots` — photograph every screen, both themes, into shots/
 * (docs/shots.md). Serves the built export, not `next dev`, whose quirks differ
 * from what ships; seeds through the real UI. Never run `playwright install`.
 */
import { Buffer } from "node:buffer";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, ensureBuild, serveExport, launch, newPhone, PIXEL_9A, openGroupsList, pick, newGroup }
  from "./lib/harness.mjs";
import { PHOTO, stubScan } from "./lib/receipts.mjs";

const SHOTS = join(ROOT, "shots");

async function seed(page, base) {
  const groupId = await newGroup(page, base, {
    name: "Marrakech", me: "Theo", members: ["Marie", "Sam"],
  });

  await addExpense(page, base, groupId, { amount: "4800", what: "Riad Jnane" });
  await addExpense(page, base, groupId, { amount: "6200", what: "Dinner", coSponsor: true });
  // The two rows the personal lens exists for: one you owe a share of, one with
  // nothing to do with you.
  await addExpense(page, base, groupId, { amount: "900", what: "Taxi", paidBy: "Marie" });
  await addExpense(page, base, groupId, {
    amount: "62000", what: "Café Clock", currency: "MAD", rate: "0.0921",
  });
  await addExpense(page, base, groupId, {
    amount: "450", what: "Marie's sunglasses", paidBy: "Marie", exclude: "Theo",
  });

  await addEntry(page, base, groupId, { kind: "Income", amount: "1500", what: "Deposit back" });
  await addTransfer(page, base, groupId, { amount: "800", from: "Sam", to: "Theo" });

  // Two fields, as an entry is saved whole: the shot shows the sentence *and* the
  // line under it.
  await page.getByText("Riad Jnane").click();
  await page.waitForURL(/\/g\/entry\?/);
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.waitForURL(/entry\/edit/);
  await page.locator("input.amount").fill("5100");
  await page.locator("#what").fill("Riad Jnane, two nights");
  await page.getByRole("button", { name: "Save" }).click();
  // Save goes back to where the form was opened from.
  await page.waitForURL(/\/g\/entry\?/);
  return groupId;
}

const addExpense = (page, base, groupId, opts) => addEntry(page, base, groupId, opts);

async function addEntry(
  page, base, groupId, { kind, amount, what, coSponsor, paidBy, exclude, currency, rate },
) {
  await page.goto(`${base}/g/entry/edit?id=${groupId}`);
  if (kind) await pick(page, '[aria-label="What kind of entry"]', kind);
  // No feed behind the static export, so the rate dialog opens and the number is
  // typed.
  if (currency) {
    await pick(page, '[aria-label="Currency"]', currency);
    const dialog = page.locator("dialog.scrim");
    await dialog.waitFor({ timeout: 8000 }).catch(() => {});
    if (await dialog.count() > 0) {
      await page.getByRole("textbox", { name: `Rate, ${currency} to EUR` }).fill(rate);
      await page.getByRole("button", { name: "Save" }).last().click();
      await page.waitForTimeout(200);
    }
  }
  await page.locator("input.amount").fill(amount);
  await page.locator("#what").fill(what);
  if (paidBy) await pick(page, "#paidby", paidBy);
  if (exclude) await page.getByRole("button", { name: `Leave ${exclude} out` }).click();
  if (coSponsor) {
    await page.locator("#paidby").click();
    await page.getByRole("option", { name: "Multiple people" }).click();
    await page.waitForURL(/\/g\/payers/);
    await page.locator(".rows .row").filter({ hasText: "Marie" })
      .getByLabel(/contribution/).fill("2000");
    // A tap on the name clears what they held, a second hands them the rest.
    const theo = page.locator(".rows .row").filter({ hasText: "Theo" });
    await theo.getByRole("button", { name: /^Clear/ }).click();
    await theo.getByRole("button", { name: /the rest$/i }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForURL(/entry\/edit/);
  }
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\?id=/);
}

async function addTransfer(page, base, groupId, { amount, from, to }) {
  await page.goto(`${base}/g/entry/edit?id=${groupId}&kind=transfer`);
  await page.waitForSelector(".transfer");
  await page.locator("input.amount").fill(amount);
  await pickSide(page, "Who sent it", from);
  await pickSide(page, "Who received it", to);
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\?id=/);
}

const pickSide = (page, label, name) => pick(page, `[aria-label="${label}"]`, name);

/**
 * The refused twin differs by one cell: a date the spreadsheet wrote its own way.
 */
const CSV = [
  "Date,Description,Category,Cost,Currency,Ada,Sam,Theo",
  "",
  "2026-04-03,Riad,Lodging,300.00,EUR,200.00,-100.00,-100.00",
  "2026-04-04,Dinner,Dining out,60.00,EUR,-20.00,-20.00,40.00",
  "2026-04-05,Deposit back,General,-30.00,EUR,10.00,10.00,-20.00",
  "2026-04-06,Boat,General,100.00,EUR,20.00,30.00,-50.00",
  "2026-04-07,Cash at the airport,Payment,25.00,EUR,25.00,0.00,-25.00",
  "2026-04-08,Unapportionable,General,10.00,EUR,0.00,0.00,0.00",
  "",
  "2026-09-18,Total balance, , ,EUR,235.00,-80.00,-155.00",
  "",
].join("\n");

const BAD_CSV = CSV.replace("2026-04-04,Dinner", "04/04/2026,Dinner");

const routes = (g) => [
  ["groups", "/"],
  ["about", "/about"],
  ["settings", "/settings"],
  ["advanced", "/advanced"],
  ["new", "/new"],
  ["import", "/import"],
  ["group-ledger", `/g?id=${g}`],
  ["group-balances", `/g/balances?id=${g}`],
  ["members", `/g/members?id=${g}`],
  ["claim", `/g/claim?id=${g}`],
  ["history", `/g/history?id=${g}`],
  ["tip", `/g/tip?id=${g}`],
  ["export", `/g/export?id=${g}`],
  ["entry-expense", `/g/entry/edit?id=${g}`],
  ["entry-transfer", `/g/entry/edit?id=${g}&kind=transfer`],
  ["quick", "/quick"],
];

async function main() {
  ensureBuild();
  await rm(SHOTS, { recursive: true, force: true });
  await mkdir(SHOTS, { recursive: true });

  const { base, close } = await serveExport();
  const browser = await launch();
  try {
    for (const theme of ["light", "dark"]) {
      const context = await newPhone(browser, { ...PIXEL_9A, colorScheme: theme });
      const page = await context.newPage();
      const groupId = await seed(page, base);

      for (const [name, path] of routes(groupId)) {
        // The way a phone that has been in a group reaches it: launch, then back
        // out.
        if (path === "/") await openGroupsList(page, base);
        else await page.goto(base + path);
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(SHOTS, `${theme}-${name}.png`) });
        process.stdout.write(`${theme}/${name} `);
      }

      // The settle-up card has no URL of its own.
      await page.goto(`${base}/g/balances?id=${groupId}`);
      await page.locator("button.card").first().click();
      await page.waitForSelector("dialog.scrim .settle");
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(SHOTS, `${theme}-settle-record.png`) });
      process.stdout.write(`${theme}/settle-record `);
      await page.keyboard.press("Escape");

      // A <dialog>, so it has no URL either.
      await page.goto(`${base}/g/entry/edit?id=${groupId}&kind=transfer`);
      await page.waitForSelector(".transfer");
      await page.getByLabel("Who received it").click();
      await page.waitForSelector(".dlist");
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-transfer-who.png`) });
      process.stdout.write(`${theme}/transfer-who `);
      await page.keyboard.press("Escape");

      await page.goto(`${base}/g/entry/edit?id=${groupId}`);
      await pick(page, '[aria-label="What kind of entry"]', "Income");
      await page.locator("input.amount").fill("300");
      await page.locator("#what").fill("Deposit back");
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-entry-income.png`) });
      process.stdout.write(`${theme}/entry-income `);

      await page.goto(`${base}/g/entry/edit?id=${groupId}`);
      await page.locator("input.amount").fill("120");
      await page.locator("#what").fill("Hammam");
      await page.getByRole("button", { name: "As amounts" }).click();
      // The docked line reads the €95 the rest shares in money.
      await page.getByRole("textbox", { name: /Marie.s amount/ }).fill("25");
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-expense-split-amounts.png`) });
      process.stdout.write(`${theme}/expense-split-amounts `);

      // Hangs off the draft typed above, so it can't be reached by URL.
      await page.locator("#paidby").click();
    await page.getByRole("option", { name: "Multiple people" }).click();
      await page.waitForURL(/\/g\/payers/);
      await page.locator(".rows .row").filter({ hasText: "Marie" })
        .getByLabel(/contribution/).fill("25");
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-payers.png`) });
      process.stdout.write(`${theme}/payers `);

      // Reached only by a scan, the answer stubbed from `pnpm drive`'s canned
      // bill. Long, to show the header freezing over a tall bill.
      await stubScan(page, "cafe-clock");

      await page.goto(`${base}/g/scan?id=${groupId}`);
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-scan.png`) });
      process.stdout.write(`${theme}/scan `);

      await page.goto(`${base}/g/entry/edit?id=${groupId}`);
      await page.waitForTimeout(200);
      await page.locator('input[aria-label="Upload a receipt photo"]')
        .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PHOTO });
      // A scan fills the form and stops there; the grid is the tap after it.
      await page.getByRole("link", { name: /(Assign|Edit) who.had.what/ }).click();
      await page.waitForURL(/entry\/items/);
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(SHOTS, `${theme}-who-had-what.png`) });
      process.stdout.write(`${theme}/who-had-what `);
      await page.getByRole("button", { name: /^Show the \d+ Salade marocaine portions/ }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-who-had-what-unfolded.png`) });
      process.stdout.write(`${theme}/who-had-what-unfolded `);

      // Bare figures throughout: nothing in a quick split converts.
      await stubScan(page, "two-for-one");
      await page.goto(`${base}/quick`);
      for (const who of ["Ana", "Bo", "Cy"]) {
        await page.getByLabel("Add someone").fill(who);
        await page.getByLabel("Add someone").press("Enter");
      }
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(SHOTS, `${theme}-quick-people.png`) });
      process.stdout.write(`${theme}/quick-people `);
      await page.locator('input[aria-label="Upload a receipt photo"]')
        .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PHOTO });
      await page.getByRole("button", { name: /Assign who had what/ }).click();
      await page.waitForURL(/quick\/items/);
      const any = (who, item) => new RegExp(`^${who} (had (all \\d+ )?|shared the \\d+ )${item}`);
      for (const label of [
        /^Ana had Ham pizza/, /^Bo had Cheese pizza/,
        any("Ana", "Garlic knots"), any("Bo", "Garlic knots"), any("Cy", "Garlic knots"),
        any("Ana", "Soda"), any("Bo", "Soda"), any("Cy", "Soda"),
      ]) await page.getByRole("button", { name: label }).click();
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(SHOTS, `${theme}-quick-items.png`) });
      process.stdout.write(`${theme}/quick-items `);
      await page.getByRole("button", { name: "Done" }).click();
      await page.waitForURL(/quick\/result/);
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-quick-result.png`) });
      process.stdout.write(`${theme}/quick-result `);

      // The OS picker can't be driven, so the file goes straight to its input.
      await page.goto(`${base}/import`);
      await page.setInputFiles('input[type="file"]', {
        name: "Marrakech.csv", mimeType: "text/csv", buffer: Buffer.from(CSV),
      });
      await page.waitForSelector(".rows .row");
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-import-plan.png`) });
      process.stdout.write(`${theme}/import-plan `);

      await page.getByRole("button", { name: "Create the group" }).click();
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(SHOTS, `${theme}-import-who.png`) });
      process.stdout.write(`${theme}/import-who `);

      await page.goto(`${base}/import`);
      await page.setInputFiles('input[type="file"]', {
        name: "Marrakech.csv", mimeType: "text/csv", buffer: Buffer.from(BAD_CSV),
      });
      await page.waitForSelector("p.failure");
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-import-refused.png`) });
      process.stdout.write(`${theme}/import-refused `);

      await page.goto(`${base}/g/members?id=${groupId}`);
      await page.getByLabel("Add someone").fill("Nadia");
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-add-member.png`) });
      process.stdout.write(`${theme}/add-member `);

      // The group's kebab carries as many items as a menu ever holds.
      await page.goto(`${base}/g?id=${groupId}`);

      await page.locator(".entryrow").nth(1).click({ button: "right" });
      await page.waitForSelector(".rowmenu");
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(SHOTS, `${theme}-row-menu.png`) });
      process.stdout.write(`${theme}/row-menu `);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Group menu" }).click();
      await page.waitForSelector(".rowmenu");
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(SHOTS, `${theme}-group-menu.png`) });
      process.stdout.write(`${theme}/group-menu `);

      await openGroupsList(page, base);
      await page.locator(".rows .row").first().click({ button: "right" });
      await page.getByRole("menuitem", { name: "Forget group" }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-forget.png`) });
      process.stdout.write(`${theme}/forget `);

      await page.goto(`${base}/g?id=${groupId}`);
      await page.locator("a.row").filter({ hasText: "Café Clock" }).click();
      await page.waitForURL(/\/g\/entry\?/);
      await page.getByRole("button", { name: "MAD rate", exact: true }).click();
      await page.waitForSelector("dialog.scrim");
      await page.getByRole("textbox", { name: "Rate, MAD to EUR" }).fill("0.093");
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-rate.png`) });
      process.stdout.write(`${theme}/rate `);

      // Opened and photographed, never confirmed.
      await page.goto(`${base}/g?id=${groupId}`);
      await page.getByText("Riad Jnane").click();
      await page.waitForURL(/\/g\/entry\?/);
      await page.getByRole("button", { name: "Delete" }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-delete-entry.png`) });
      process.stdout.write(`${theme}/delete-entry `);

      // A phone of its own: the one above has a trip in it.
      const fresh = await newPhone(browser, { ...PIXEL_9A, colorScheme: theme });
      const blank = await fresh.newPage();
      await blank.goto(`${base}/`);
      await blank.waitForSelector(".empty");
      await blank.waitForTimeout(200);
      await blank.screenshot({ path: join(SHOTS, `${theme}-groups-empty.png`) });
      process.stdout.write(`${theme}/groups-empty `);
      await blank.getByRole("button", { name: "Menu" }).click();
      await blank.waitForTimeout(250);
      await blank.screenshot({ path: join(SHOTS, `${theme}-groups-menu.png`) });
      process.stdout.write(`${theme}/groups-menu `);
      await fresh.close();

      await context.close();
    }
    console.log(`\nshots written to ${SHOTS}`);
  } finally {
    await browser.close();
    close();
  }
}

await main();
