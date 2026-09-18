#!/usr/bin/env node
/**
 * `pnpm demo` — `bida.bid/demo` lands on a group somebody already used, and
 * that group holds no key.
 *
 * Three of the four things worth checking here are invisible to a unit test.
 * The seed's arithmetic is core's own (`packages/core/src/demo.test.ts`); what
 * this asks is whether the group a person actually walks into is populated,
 * whether it says what it is, and — the one that matters most — whether the
 * key table stayed empty. That last one is the whole hinge: a key row is what
 * `runSyncAll` iterates, so a demo with one would push a tourist's ops into a
 * D1 that gets no further resets (docs/sync.md#the-demo-group-has-no-key). It
 * is also exactly the kind of regression nothing else would notice, because
 * the demo would carry on looking perfect.
 *
 * Then the two ends of it: Invite has to refuse out loud rather than go
 * missing, and clearing has to take the group off the phone and leave the
 * address able to bring it back.
 */
import { ensureBuild, serveExport, launch, newPhone, reporter } from "./lib/harness.mjs";

ensureBuild();
const { base, close } = await serveExport();
const browser = await launch();
const ctx = await newPhone(browser);
const page = await ctx.newPage();
const { report, finish } = reporter(page);

/** Every group this phone holds a secret for, straight out of IndexedDB. */
const keysHeld = (page) => page.evaluate(() => new Promise((ok, fail) => {
  const open = indexedDB.open("hajsik");
  open.onerror = () => fail(open.error);
  open.onsuccess = () => {
    const rows = open.result.transaction("groupKeys").objectStore("groupKeys").getAll();
    rows.onsuccess = () => ok(rows.result.map((row) => row.groupId));
    rows.onerror = () => fail(rows.error);
  };
}));

/** The group menu is the same card a long press opens on a row (`RowMenu`). */
const openMenu = async () => {
  await page.locator('[aria-label="Group menu"]').click();
  await page.waitForSelector(".rowmenu-item");
};
const menuItem = (text) => page.locator(".rowmenu-item").filter({ hasText: text }).first();

// ---- the address is the whole door -------------------------------------
await page.goto(`${base}/demo`);
await page.waitForURL(/\/g\?id=/, { timeout: 12000 });
const groupId = new URL(page.url()).searchParams.get("id");
report(groupId === "demodemodemo", "/demo lands in the demo group's ledger", groupId);
// No claim gate on the way in: the device is one of the four, which is what
// the personal lens on this screen is for.
report(!page.url().includes("/g/claim"), "and is not stopped at the claim gate");

await page.waitForSelector(".rows .row");
const rows = await page.locator(".rows .row").count();
report(rows >= 6, `the ledger is populated, not an empty state (${rows} rows)`);
report(await page.getByText("Marrakech").count() > 0, "and it is the Marrakech trip");
report(await page.getByText("Demo group").count() === 1,
  "with the mark at its head, which does not fold away");

// ---- the hinge: no key, so no path to the server ------------------------
report((await keysHeld(page)).length === 0,
  "the phone holds no key for it, so `runSyncAll` can never see it",
  JSON.stringify(await keysHeld(page)));

// ---- a real group: the balances are real too ----------------------------
await page.goto(`${base}/g?id=${groupId}&tab=balances`);
await page.waitForSelector(".bignum");
const figures = await page.locator(".bignum").allInnerTexts();
const nonZero = figures.filter((text) => /[1-9]/.test(text));
report(nonZero.length >= 3, "balances do not cancel, so settle-up has work to propose",
  figures.join(" · "));

// ---- the one thing it genuinely cannot do -------------------------------
await page.goto(`${base}/g?id=${groupId}`);
await openMenu();
await menuItem("Copy invite link").click();
await page.waitForSelector(".dbody");
report(await page.getByText("No invite link").count() === 1,
  "Invite refuses out loud rather than going missing");
await page.getByRole("button", { name: "Close" }).click();

// ---- and the way out ----------------------------------------------------
await openMenu();
await menuItem("Clear the demo").click();
await page.getByRole("button", { name: "Clear the demo" }).click();
await page.waitForURL((url) => url.pathname === "/", { timeout: 8000 });
await page.waitForTimeout(400);
report(await page.getByText("Marrakech").count() === 0,
  "clearing takes it off the phone, not merely off the list");

// Deterministic seed, so the address is also the reset: reopening builds the
// same group again rather than a second one beside it.
await page.goto(`${base}/demo`);
await page.waitForURL(/\/g\?id=/, { timeout: 12000 });
await page.waitForSelector(".rows .row");
report(new URL(page.url()).searchParams.get("id") === "demodemodemo"
  && await page.locator(".rows .row").count() === rows,
  "and the address brings the same group back, entry for entry");
report((await keysHeld(page)).length === 0, "still with no key to its name");

await browser.close();
close();
finish();
