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
import { Buffer } from "node:buffer";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, ensureBuild, serveExport, launch, newPhone, openGroupsList, pick, newGroup }
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
  // Save goes back to where the form was opened from — here, the entry we
  // tapped Edit on, not the ledger.
  await page.waitForURL(/\/g\/entry\?/);
  return groupId;
}

const addExpense = (page, base, groupId, opts) => addEntry(page, base, groupId, opts);

async function addEntry(
  page, base, groupId, { kind, amount, what, coSponsor, paidBy, exclude, currency, rate },
) {
  await page.goto(`${base}/g/entry/edit?id=${groupId}`);
  if (kind) await pick(page, '[aria-label="What kind of entry"]', kind);
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
    await page.getByRole("button", { name: "Multi-payer" }).click();
    await page.waitForURL(/\/g\/payers/);
    // Marie chips in 20,00; whoever was already paying takes the rest.
    await page.locator(".rows .row").filter({ hasText: "Marie" })
      .getByLabel(/contribution/).fill("2000");
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

/**
 * A Splitwise export, as `/import` reads one: three people, an uneven expense,
 * an income, a co-sponsored row, a transfer, and a row carrying no money. The
 * refused twin differs by one cell, so the shot shows what a person sees when
 * they have a date their spreadsheet wrote its own way.
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
  ["new", "/new"],
  ["import", "/import"],
  ["group-ledger", `/g?id=${g}`],
  ["group-balances", `/g?id=${g}&tab=balances`],
  ["members", `/g/members?id=${g}`],
  ["claim", `/g/claim?id=${g}`],
  ["history", `/g/history?id=${g}`],
  ["rates", `/g/rates?id=${g}`],
  ["tip", `/g/tip?id=${g}`],
  ["export", `/g/export?id=${g}`],
  ["entry-expense", `/g/entry/edit?id=${g}`],
  ["entry-transfer", `/g/entry/edit?id=${g}&kind=transfer`],
  // A quick split has no group in it at all (ADR-0035) — the id is ignored.
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
      const context = await newPhone(browser, { deviceScaleFactor: 2, colorScheme: theme });
      const page = await context.newPage();
      const groupId = await seed(page, base);

      for (const [name, path] of routes(groupId)) {
        // The groups list is reached the way a person reaches it on a phone
        // that has been in a group: launch, then back out of the group the
        // launch reopens (apps/web/lib/launch.ts).
        if (path === "/") await openGroupsList(page, base);
        else await page.goto(base + path);
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
      await pick(page, '[aria-label="What kind of entry"]', "Income");
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
      await page.getByRole("button", { name: "Multi-payer" }).click();
      await page.waitForURL(/\/g\/payers/);
      // Marie's field, typed into without touching Theo's — the same shortfall
      // the split screen shot above catches, on the payer side this time.
      await page.locator(".rows .row").filter({ hasText: "Marie" })
        .getByLabel(/contribution/).fill("25");
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

      // Scan first: the whole screen behind the camera above the ledger's "+".
      await page.goto(`${base}/g/scan?id=${groupId}`);
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-scan.png`) });
      process.stdout.write(`${theme}/scan `);

      await page.goto(`${base}/g/entry/edit?id=${groupId}`);
      await page.waitForTimeout(200);
      await page.locator('input[aria-label="Upload a receipt photo"]')
        .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PHOTO });
      // A scan fills the form and stops there — the grid is the tap after it,
      // never a place the scan sends you (docs/receipt-scanning.md). On a
      // bill nobody has been assigned a line of, that tap says "Assign".
      await page.getByRole("link", { name: /(Assign|Edit) who.had.what/ }).click();
      await page.waitForURL(/entry\/items/);
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(SHOTS, `${theme}-who-had-what.png`) });
      process.stdout.write(`${theme}/who-had-what `);
      await page.getByRole("button", { name: /^Split Moroccan salad/ }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-who-had-what-unfolded.png`) });
      process.stdout.write(`${theme}/who-had-what-unfolded `);

      // A quick split, all the way through: the same grid with nobody's
      // group behind it, and the answer it ends on (ADR-0035). Bare figures
      // throughout — nothing here converts, so a currency would be a label.
      await stubScan(page, "two-for-one");
      await page.goto(`${base}/quick`);
      for (const who of ["Ana", "Bo", "Cy"]) {
        await page.getByLabel("Add someone").fill(who);
        await page.getByLabel("Add someone").press("Enter");
      }
      await page.waitForTimeout(150);
      // The empty screen is in `routes` above; this is the same one with a
      // table's worth of people on it and the camera live.
      await page.screenshot({ path: join(SHOTS, `${theme}-quick-people.png`) });
      process.stdout.write(`${theme}/quick-people `);
      await page.locator('input[aria-label="Upload a receipt photo"]')
        .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PHOTO });
      await page.waitForURL(/quick\/items/);
      // Everybody had the knots and the soda; a pizza each for the other two.
      for (const label of [
        /^Ana had Ham pizza/, /^Bo had Cheese pizza/,
        /^Ana had Garlic knots/, /^Bo had Garlic knots/, /^Cy had Garlic knots/,
        /^Ana had Soda/, /^Bo had Soda/, /^Cy had Soda/,
      ]) await page.getByRole("button", { name: label }).click();
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(SHOTS, `${theme}-quick-items.png`) });
      process.stdout.write(`${theme}/quick-items `);
      await page.getByRole("button", { name: "Done" }).click();
      await page.waitForURL(/quick\/result/);
      // Every row open, which is how the screen arrives: the answer is the
      // bill, not a summary of one.
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-quick-result.png`) });
      process.stdout.write(`${theme}/quick-result `);

      // The import, past its first screen (which is in `routes` above): the
      // plan a file is read into before anything is written, the same screen
      // refused, and the question it ends on. The picker is the OS's, so the
      // file goes straight to the input it opens — which is the real path, and
      // the only one now that the paste box is gone.
      await page.goto(`${base}/import`);
      await page.setInputFiles('input[type="file"]', {
        name: "Marrakech.csv", mimeType: "text/csv", buffer: Buffer.from(CSV),
      });
      await page.waitForSelector(".rows .row");
      // The name field is left as the file filled it: a Splitwise export is
      // named after the group, and the shot should show what a person actually
      // arrives at rather than a field typed into for the camera.
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

      // Adding someone is the last row of the list, mid-name — boxed, because
      // that name is not on the list until its plus is pressed.
      await page.goto(`${base}/g/members?id=${groupId}`);
      await page.getByLabel("Add someone").fill("Nadia");
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${theme}-add-member.png`) });
      process.stdout.write(`${theme}/add-member `);

      // The group's kebab, open: the menu card carrying as many items as it
      // ever holds, a destructive one last. The groups list's is the same card
      // with two rows on it, so this is the shot that shows the whole of it.
      await page.goto(`${base}/g?id=${groupId}`);
      await page.getByRole("button", { name: "Group menu" }).click();
      await page.waitForSelector(".rowmenu");
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(SHOTS, `${theme}-group-menu.png`) });
      process.stdout.write(`${theme}/group-menu `);

      // Forgetting lives only in the groups list's row menu, so the shot goes
      // through it: a right click opens the menu, and the confirmation is the
      // dialog this app draws in place of confirm() (ADR-0008).
      await openGroupsList(page, base);
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

      // The kebab that holds the import, and the empty list behind it: a
      // phone that holds no groups at all, in a context of its own, because
      // the one above has a trip in it.
      const fresh = await newPhone(browser, { deviceScaleFactor: 2, colorScheme: theme });
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
