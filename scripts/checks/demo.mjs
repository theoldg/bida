#!/usr/bin/env node
// Doc: docs/checks-ways-in.md#pnpm-verify-demo--the-demo-group-and-the-key-it-must-not-have
import {
  onePhone, newPhone, openDemo, PATIENCE, readStore, readDevice, putDevice,
} from "../lib/harness.mjs";
import { PHOTO, stubScan } from "../lib/receipts.mjs";

const { base, close, browser, ctx, page, report, finish } = await onePhone();

const stampAs = async (page, demoSeed) =>
  putDevice(page, { ...await readDevice(page), demoSeed });

const keysHeld = async (page) => (await readStore(page, "groupKeys")).map((row) => row.groupId);

const openMenu = async () => {
  await page.locator('[aria-label="Group menu"]').click();
  await page.waitForSelector(".rowmenu-item");
};
const menuItem = (text) => page.locator(".rowmenu-item").filter({ hasText: text }).first();

// ---- the address is the whole door -------------------------------------
await page.goto(`${base}/demo`);
await page.waitForURL(/\/g\/claim\?id=/, { timeout: PATIENCE });
await page.waitForSelector("button.row");
const names = await page.locator("button.row").allInnerTexts();
report(names.length === 4 && ["Ben", "Chewie", "Han", "Luke"].every((n) => names.some((t) => t.includes(n)))
  && await page.locator('button.row[aria-pressed="true"]').count() === 0,
  "/demo asks which of the four you are, with nobody picked for you", names.join(" · "));
await page.locator("button.row").filter({ hasText: "Luke" }).first().click();
await page.getByRole("button", { name: "Continue as Luke" }).click();
await page.waitForURL(/\/g\?id=/, { timeout: PATIENCE });
const groupId = new URL(page.url()).searchParams.get("id");
report(groupId === "demodemodemo", "and the answer lands in the demo group's ledger", groupId);

await page.waitForSelector(".rows .row:not(.skelrow)");
const rows = await page.locator(".rows .row:not(.skelrow)").count();
report(rows >= 6, `the ledger is populated, not an empty state (${rows} rows)`);
report(await page.getByText("Passage to Alderaan").count() > 0, "and it is the cantina group");
await page.waitForSelector(".skelveil", { state: "detached" });
report(await page.getByText("Demo group").count() === 1,
  "with the mark at its head, which does not fold away");

// ---- a bill, not a quarter each -----------------------------------------
await page.locator(".rows .row:not(.skelrow)").filter({ hasText: "Chalmun’s cantina" }).first().click();
await page.waitForSelector(".billgroup");
report(await page.getByText("By items").count() > 0,
  "the tab is split by the bill, not a quarter each");
await page.locator(".billgroup .kv").filter({ hasText: "Ben" }).first().click();
await page.waitForSelector(".billline");
report(await page.getByText("Blue milk").count() > 0,
  "and Ben's row opens onto what Ben ordered, translated as the bill was saved");
await page.goBack();
await page.waitForSelector(".rows .row:not(.skelrow)");

// ---- the camera works here too, and says nothing about this group -------
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
await page.waitForSelector(".rows .row:not(.skelrow)");

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
// Only a changed demo tests anything: an untouched one reopens identically
// whether the address re-seeds or merely un-hides.
await page.goto(`${base}/g/entry/edit?id=${groupId}`);
await page.locator("input.amount").fill("12");
await page.locator("#what").fill("Droid oil");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForURL(/\/g\?id=/, { timeout: PATIENCE });
await page.waitForFunction(
  (n) => document.querySelectorAll(".rows .row:not(.skelrow)").length > n, rows, { timeout: PATIENCE },
);
report(await page.getByText("Droid oil").count() > 0,
  "the demo takes an entry of your own, like any other group");
await ctx.setOffline(true);
const offline = await page.waitForSelector("text=Offline", { timeout: PATIENCE })
  .then((el) => el.innerText(), () => "");
report(offline.length > 0 && !offline.includes("waiting"),
  "and offline, the banner counts none of it as waiting: it has nowhere to go", offline);
await ctx.setOffline(false);

await openMenu();
await menuItem("Clear the demo").click();
await page.waitForSelector(".dbody");
const promise = await page.locator(".dbody").innerText();
report(promise.includes(`Visit ${new URL(base).host}/demo to create a fresh one.`),
  "the clear dialog sends you to this server's own /demo", promise);
await page.getByRole("button", { name: "Clear the demo" }).click();
await page.waitForURL((url) => url.pathname === "/", { timeout: PATIENCE });
// The list draws its kept answer at once and reads Dexie behind it, so the row
// can still be there for a beat: wait for it to go, which it must.
const gone = await page.waitForFunction(() => !document.querySelector(".skelrow")
  && !document.body.innerText.includes("Passage to Alderaan"), null, { timeout: PATIENCE })
  .then(() => true, () => false);
report(gone, "clearing takes it off the phone, not merely off the list");

// ---- a copied address is a door too ------------------------------------
const friend = await (await newPhone(browser)).newPage();
await friend.goto(`${base}/g/balances?id=demodemodemo`);
await friend.waitForFunction(
  () => location.pathname === "/g/claim" && document.querySelector("button.row"),
  null, { timeout: PATIENCE },
);
await friend.locator("button.row").filter({ hasText: "Han" }).first().click();
await friend.getByRole("button", { name: "Continue as Han" }).click();
await friend.waitForFunction(
  () => location.pathname === "/g" && document.querySelector(".rows .row:not(.skelrow)"),
  null, { timeout: PATIENCE },
);
report(await friend.locator(".rows .row:not(.skelrow)").count() === rows && (await keysHeld(friend)).length === 0,
  "a demo address copied off another phone opens the demo as whoever they pick, still with no key");
await friend.close();
// Not on the phone that cleared it: re-seeding on its "no group" would undo the
// clear.
await page.goto(`${base}/g?id=demodemodemo`);
await page.waitForTimeout(1500);
report(new URL(page.url()).pathname === "/g" && await page.getByText("Passage to Alderaan").count() === 0,
  "while the phone that cleared it is not handed it back unasked", page.url());

const reopenedAt = Date.now();
await page.goto(`${base}/demo`);
const askedAgain = await page.waitForURL(/\/g\/claim\?id=/, { timeout: PATIENCE }).then(() => true, () => false);
report(askedAgain, "a cleared demo asks again who you are", page.url());
await openDemo(page, base);
await page.waitForSelector(".rows .row:not(.skelrow)");
report(new URL(page.url()).searchParams.get("id") === "demodemodemo"
  && await page.locator(".rows .row:not(.skelrow)").count() === rows,
  "and the address brings the same group back, entry for entry");
report(await page.getByText("Droid oil").count() === 0,
  "as it was shipped: the entry added before clearing is not in it");
report((await keysHeld(page)).length === 0, "still with no key to its name");

// ---- and it does not accuse itself of being stuck ----------------------
await page.waitForTimeout(Math.max(0, 14_000 - (Date.now() - reopenedAt)));
report(await page.getByText("Still reading this phone").count() === 0,
  "and no read gives up on it: no stall notice, a watchdog later");

// ---- a new build lays its demo down over the old one -------------------
const before = (await readStore(page, "ops")).filter((op) => op.groupId === "demodemodemo");
await stampAs(page, "some-older-build");
await page.goto(`${base}/demo`);
await page.waitForFunction(
  () => location.pathname === "/g" && document.querySelector(".rows .row:not(.skelrow)"),
  null, { timeout: PATIENCE },
);
const after = (await readStore(page, "ops")).filter((op) => op.groupId === "demodemodemo");
const kept = new Set(before.map((op) => op.id));
report(after.length === before.length && !after.some((op) => kept.has(op.id)),
  "a phone holding an older seed is re-seeded, not handed the group it had",
  `${before.length} ops before, ${after.length} after`);
report(await page.locator(".rows .row:not(.skelrow)").count() === rows && (await keysHeld(page)).length === 0,
  "and what it lands on is the same populated ledger, still with no key");
const third = (await readStore(page, "ops")).filter((op) => op.groupId === "demodemodemo");
await page.goto(`${base}/demo`);
await page.waitForFunction(
  () => location.pathname === "/g" && document.querySelector(".rows .row:not(.skelrow)"),
  null, { timeout: PATIENCE },
);
const fourth = (await readStore(page, "ops")).filter((op) => op.groupId === "demodemodemo");
report(fourth.map((op) => op.id).sort().join() === third.map((op) => op.id).sort().join(),
  "while a visit on the seed it already holds rewrites nothing");

await browser.close();
close();
finish();
