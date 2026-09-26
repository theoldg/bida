#!/usr/bin/env node
/**
 * `pnpm demo` — `bida.bid/demo` lands on a group somebody already used, and
 * that group holds no key.
 *
 * The seed's arithmetic is core's (`packages/core/src/demo.test.ts`). This
 * asks whether the group a person walks into is populated, says what it is,
 * and — the hinge — left the key table empty: `runSyncAll` iterates key rows,
 * so a demo with one would push tourists into D1
 * (docs/sync.md#the-demo-group-has-no-key), and the demo would still look
 * perfect.
 *
 * Then: Invite refuses out loud, and clearing takes the group (and your
 * additions) off the phone while leaving `/demo` able to lay a fresh one.
 */
import { ensureBuild, serveExport, launch, newPhone, PATIENCE, reporter } from "./lib/harness.mjs";
import { PHOTO, stubScan } from "./lib/receipts.mjs";

ensureBuild();
const { base, close } = await serveExport();
const browser = await launch();
const ctx = await newPhone(browser);
const page = await ctx.newPage();
const { report, finish } = reporter(page);

/** One store, read whole, straight out of IndexedDB. */
const readStore = (page, store) => page.evaluate((name) => new Promise((ok, fail) => {
  const open = indexedDB.open("hajsik");
  open.onerror = () => fail(open.error);
  open.onsuccess = () => {
    const rows = open.result.transaction(name).objectStore(name).getAll();
    rows.onsuccess = () => ok(rows.result);
    rows.onerror = () => fail(rows.error);
  };
}), store);

/** Say this phone was given some older build's demo, without shipping one. */
const stampAs = (page, seed) => page.evaluate((demoSeed) => new Promise((ok, fail) => {
  const open = indexedDB.open("hajsik");
  open.onerror = () => fail(open.error);
  open.onsuccess = () => {
    const store = open.result.transaction("device", "readwrite").objectStore("device");
    const got = store.get("device");
    got.onsuccess = () => {
      const put = store.put({ ...got.result, demoSeed });
      put.onsuccess = () => ok();
      put.onerror = () => fail(put.error);
    };
    got.onerror = () => fail(got.error);
  };
}), seed);

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
await page.waitForURL(/\/g\?id=/, { timeout: PATIENCE });
const groupId = new URL(page.url()).searchParams.get("id");
report(groupId === "demodemodemo", "/demo lands in the demo group's ledger", groupId);
// No claim gate on the way in: the device is one of the four, which is what
// the personal lens on this screen is for.
report(!page.url().includes("/g/claim"), "and is not stopped at the claim gate");

await page.waitForSelector(".rows .row");
const rows = await page.locator(".rows .row").count();
report(rows >= 6, `the ledger is populated, not an empty state (${rows} rows)`);
report(await page.getByText("Passage to Alderaan").count() > 0, "and it is the cantina group");
report(await page.getByText("Demo group").count() === 1,
  "with the mark at its head, which does not fold away");

// ---- a bill, not a quarter each -----------------------------------------
// The dinner keeps the receipt it was split from (ADR-0016), which only shows
// up by opening it: the row says the same thing either way.
await page.locator(".rows .row").filter({ hasText: "Chalmun’s cantina" }).first().click();
await page.waitForSelector(".billgroup");
report(await page.getByText("By items").count() > 0,
  "the tab is split by the bill, not a quarter each");
// Each person's row opens onto their own lines — the grid kept on the entry.
await page.locator(".billgroup .kv").filter({ hasText: "Ben" }).first().click();
await page.waitForSelector(".billline");
// In the cantina's own tongue, which is how a bill reads until the grid's
// translation icon is pressed (docs/scan-reading.md).
report(await page.getByText("Bunta koosa").count() > 0,
  "and Ben's row opens onto what Ben ordered, as the cantina wrote it");
await page.goBack();
await page.waitForSelector(".rows .row");

// ---- the camera works here too, and says nothing about this group -------
// The demo holds no key, and `/api/groups/:id/scan` authenticates a bearer
// against a row in D1 — so scanning here goes out under this phone's own scan
// credential, the one a quick split uses (`useScanAs`). The demo's id must
// not appear in any request: a row under it is the thing that must never
// exist (docs/sync.md#the-demo-group-has-no-key).
const apiCalls = [];
page.on("request", (req) => {
  const url = new URL(req.url());
  if (url.pathname.startsWith("/api/")) apiCalls.push(url.pathname);
});
await stubScan(page, "cafe-clock");
await page.goto(`${base}/g/scan?id=${groupId}`);
await page.waitForFunction(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Upload"));
  return btn && !btn.disabled;
}, null, { timeout: PATIENCE }).catch(() => {});
report(!await page.getByRole("button", { name: "Upload" }).isDisabled(),
  "the scan is offered in the demo, not greyed out for want of a key");
await page.locator('input[type=file]').last()
  .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PHOTO });
await page.waitForURL(/\/g\/entry\/edit/, { timeout: PATIENCE });
await page.waitForSelector('input[aria-label="What"]');
const what = await page.locator('input[aria-label="What"]').inputValue();
const amount = await page.locator('input[aria-label^="Amount"]').inputValue();
report(what === "Caf\u00e9 Clock" && amount === "76.50" && await page.getByText("9 items").count() > 0,
  "and the bill it read comes back as an expense form, filled in", `${what} ${amount}`);
report(apiCalls.some((path) => path.endsWith("/scan")) && !apiCalls.some((path) => path.includes(groupId)),
  "with the demo's id in none of it", apiCalls.join(" "));
await page.goto(`${base}/g?id=${groupId}`);
await page.waitForSelector(".rows .row");

// ---- the hinge: no key, so no path to the server ------------------------
report((await keysHeld(page)).length === 0,
  "the phone holds no key for it, so `runSyncAll` can never see it",
  JSON.stringify(await keysHeld(page)));

// ---- a real group: the balances are real too ----------------------------
await page.goto(`${base}/g/balances?id=${groupId}`);
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
// Play with it first: an untouched demo clears and reopens identically
// whether the address re-seeds or merely un-hides, so only a changed one
// tests anything — and it is what the dialog promises about.
await page.goto(`${base}/g/entry/edit?id=${groupId}`);
await page.locator("input.amount").fill("12");
await page.locator("#what").fill("Droid oil");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForURL(/\/g\?id=/, { timeout: PATIENCE });
await page.waitForFunction(
  (n) => document.querySelectorAll(".rows .row").length > n, rows, { timeout: PATIENCE },
);
report(await page.getByText("Droid oil").count() > 0,
  "the demo takes an entry of your own, like any other group");

await openMenu();
await menuItem("Clear the demo").click();
// The dialog names the address to come back to, and the host in it is the
// browser's own (`useHost`): a static export cannot know which server it is
// being read from, so an unwired host would leave a bare "/demo" here.
await page.waitForSelector(".dbody");
const promise = await page.locator(".dbody").innerText();
report(promise.includes(`Visit ${new URL(base).host}/demo to create a fresh one.`),
  "the clear dialog sends you to this server's own /demo", promise);
await page.getByRole("button", { name: "Clear the demo" }).click();
await page.waitForURL((url) => url.pathname === "/", { timeout: PATIENCE });
// The list, drawn: asserting an absence over a screen that has not read Dexie
// yet is a pass for the wrong reason, and on a slow machine that is all it is.
await page.waitForFunction(() => !document.querySelector(".skelrow"), null, { timeout: PATIENCE });
report(await page.getByText("Passage to Alderaan").count() === 0,
  "clearing takes it off the phone, not merely off the list");

// ---- a copied address is a door too ------------------------------------
// What a friend gets sent is the address bar, not `/demo`, and from any screen.
// On a phone that never had the demo it must lay one down rather than say "bad
// link" (`BadLink`) — and land in the ledger, `/demo`'s own way out, whose
// skeleton is `.rows .row` too, hence the real rows back on `/g`.
const friend = await (await newPhone(browser)).newPage();
await friend.goto(`${base}/g/balances?id=demodemodemo`);
await friend.waitForFunction(
  () => location.pathname === "/g" && document.querySelector(".rows .row:not(.skelrow)"),
  null, { timeout: PATIENCE },
);
report(await friend.locator(".rows .row").count() === rows && (await keysHeld(friend)).length === 0,
  "a demo address copied off another phone opens the demo, still with no key");
await friend.close();
// Not on the phone that cleared it, though: the screen draws "no group" there
// before the menu has left, and re-seeding on that would undo the clear.
await page.goto(`${base}/g?id=demodemodemo`);
await page.waitForTimeout(1500);
report(new URL(page.url()).pathname === "/g" && await page.getByText("Passage to Alderaan").count() === 0,
  "while the phone that cleared it is not handed it back unasked", page.url());

// Deterministic seed, so the address is also the reset: reopening builds the
// story as shipped, rather than the one that was played with or a second copy
// beside it. This is what the clear dialog promises, in as many words.
const reopenedAt = Date.now();
await page.goto(`${base}/demo`);
await page.waitForURL(/\/g\?id=/, { timeout: PATIENCE });
await page.waitForSelector(".rows .row");
report(new URL(page.url()).searchParams.get("id") === "demodemodemo"
  && await page.locator(".rows .row").count() === rows,
  "and the address brings the same group back, entry for entry");
report(await page.getByText("Droid oil").count() === 0,
  "as it was shipped: the entry added before clearing is not in it");
report((await keysHeld(page)).length === 0, "still with no key to its name");

// ---- and it does not accuse itself of being stuck ----------------------
// A group with no key row is what the demo *is*, and `useGroupSecret` reading
// that as "the read never answered" put "Still reading this phone's data…"
// over a ledger that had drawn twelve seconds earlier — the one bug on this
// screen that takes longer than a glance to show up, so the check waits.
await page.waitForTimeout(Math.max(0, 14_000 - (Date.now() - reopenedAt)));
report(await page.getByText("Still reading this phone").count() === 0,
  "and no read gives up on it: no stall notice, a watchdog later");

// ---- a new build lays its demo down over the old one -------------------
// The demo is this version's pitch; without `demoStamp`, `/demo` being
// idempotent by id would keep a phone on its first story forever. Given an
// older build's seed, the address must replace the group
// (lib/db/commands/demo.ts).
const before = (await readStore(page, "ops")).filter((op) => op.groupId === "demodemodemo");
await stampAs(page, "some-older-build");
await page.goto(`${base}/demo`);
await page.waitForURL(/\/g\?id=/, { timeout: PATIENCE });
await page.waitForSelector(".rows .row");
const after = (await readStore(page, "ops")).filter((op) => op.groupId === "demodemodemo");
const kept = new Set(before.map((op) => op.id));
report(after.length === before.length && !after.some((op) => kept.has(op.id)),
  "a phone holding an older seed is re-seeded, not handed the group it had",
  `${before.length} ops before, ${after.length} after`);
report(await page.locator(".rows .row").count() === rows && (await keysHeld(page)).length === 0,
  "and what it lands on is the same populated ledger, still with no key");
// ...and only once: the stamp it just stored makes the next visit ordinary.
const third = (await readStore(page, "ops")).filter((op) => op.groupId === "demodemodemo");
await page.goto(`${base}/demo`);
await page.waitForURL(/\/g\?id=/, { timeout: PATIENCE });
await page.waitForSelector(".rows .row");
const fourth = (await readStore(page, "ops")).filter((op) => op.groupId === "demodemodemo");
report(fourth.map((op) => op.id).sort().join() === third.map((op) => op.id).sort().join(),
  "while a visit on the seed it already holds rewrites nothing");

await browser.close();
close();
finish();
