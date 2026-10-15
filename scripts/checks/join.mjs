#!/usr/bin/env node
// Doc: docs/checks-ways-in.md#pnpm-verify-join--every-way-in-across-a-full-load
import {
  ensureBuild, serveWorker, launch, newPhone, newGroup, PATIENCE, reporter, readDevice,
} from "../lib/harness.mjs";

ensureBuild();
const { base, close } = await serveWorker();
const browser = await launch();
const { report, finish } = reporter();

/**
 * Every in-app tap fetched as a full page load, as on the first tap after a
 * deploy: Next refuses a payload from another build and loads the URL itself.
 * So whatever a hand-off kept anywhere but the address is gone by the next
 * screen — which is the whole point of this check.
 */
const everyTapAFullLoad = (ctx) =>
  ctx.route((url) => url.pathname.endsWith(".txt"), (route) => route.fulfill({ status: 503 }));

const IN_APP = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15"
  + " (KHTML, like Gecko) Mobile/22F76 [FBAN/MessengerForiOS;FBAV/505.0.0.38.109;FBSN/iOS;FBSV/18.5]";

const at = (page) => { const u = new URL(page.url()); return u.pathname + u.search; };
const named = async (page, groupId) => (await readDevice(page))?.meByGroup?.[groupId];

/**
 * Waits for the screen a step should end on — its address, and the thing only
 * it draws once it has decided to stay (the ledger draws nothing while its gate
 * might still send the phone to "who are you") — and says where the phone is.
 */
const LEDGER = "text=Nothing here yet";
const QUESTION = "button.row";
async function reaches(page, path, drawn) {
  await page.waitForURL((url) => url.pathname + url.search === path, { timeout: PATIENCE }).catch(() => {});
  await page.waitForSelector(drawn, { timeout: PATIENCE }).catch(() => {});
  return at(page);
}

/** After a failed step, put the phone where the next one starts, so one run reports every path. */
async function onto(page, path, drawn) {
  if (at(page) !== path) await page.goto(`${base}${path}`);
  await page.waitForSelector(drawn, { timeout: PATIENCE }).catch(() => {});
}

// ---- a group, and its invite -----------------------------------------------
const host = await newPhone(browser, { permissions: ["clipboard-read", "clipboard-write"] });
const hostPage = await host.newPage();
const groupId = await newGroup(hostPage, base, { name: "Lisbon", me: "Ana", members: ["Bo", "Cy"] });
await hostPage.goto(`${base}/g/members?id=${groupId}`);
await hostPage.getByRole("button", { name: "Copy invite link" }).first().click();
const invite = await hostPage.evaluate(() => navigator.clipboard.readText());

// ---- a newcomer --------------------------------------------------------------
const guest = await newPhone(browser);
await everyTapAFullLoad(guest);
const guestPage = await guest.newPage();
await guestPage.goto(invite);
report(await reaches(guestPage, `/g/claim?id=${groupId}`, QUESTION) === `/g/claim?id=${groupId}`,
  "an invite opens on \"who are you\", even when every tap is a full load", at(guestPage));
await onto(guestPage, `/g/claim?id=${groupId}`, QUESTION);
await guestPage.locator("button.row").filter({ hasText: "Bo" }).first().click();
await guestPage.getByRole("button", { name: "Continue as Bo" }).click();
report(await reaches(guestPage, `/g?id=${groupId}`, LEDGER) === `/g?id=${groupId}` && !!await named(guestPage, groupId),
  "and answering it opens the group, asked once", at(guestPage));

// The same invite again, by someone already in it — whose phone was last in another group.
const home = await newGroup(guestPage, base, { name: "Flat", me: "Bo" }).catch(() => undefined);
await onto(guestPage, `/g?id=${home}`, LEDGER);
await guestPage.goto(invite);
report(await reaches(guestPage, `/g?id=${groupId}`, LEDGER) === `/g?id=${groupId}`,
  "the invite opened again opens the group itself, not the list", at(guestPage));
await onto(guestPage, `/g?id=${groupId}`, LEDGER);
await guestPage.locator(".iconbtn[aria-label='Back']").first().click();
await guestPage.waitForURL((url) => url.pathname === "/", { timeout: PATIENCE }).catch(() => {});
report(new URL(guestPage.url()).pathname === "/", "and its back arrow climbs to the list", at(guestPage));
await guest.close();

// ---- an in-app browser, then Safari -----------------------------------------
const webview = await newPhone(browser, { userAgent: IN_APP });
const webviewPage = await webview.newPage();
await webviewPage.goto(invite);
await reaches(webviewPage, `/g/claim?id=${groupId}`, QUESTION);
await onto(webviewPage, `/g/claim?id=${groupId}`, QUESTION);
await webviewPage.locator("button.row").filter({ hasText: "Cy" }).first().click();
await webviewPage.getByRole("button", { name: "Continue as Cy" }).click();
await reaches(webviewPage, `/g?id=${groupId}`, LEDGER);
const cy = await named(webviewPage, groupId);
await webviewPage.getByText("One-off visit in").click();
const copied = (await webviewPage.locator(".webviewlink").textContent({ timeout: PATIENCE }).catch(() => ""))?.trim();
// The address the host's *Open in browser* opens, carry and all.
await webviewPage.waitForFunction(() => location.hash.length > 1, null, { timeout: PATIENCE }).catch(() => {});
const address = webviewPage.url();
await webview.close();

for (const [how, url] of [["the address", address], ["the copied link", copied]]) {
  const safari = await newPhone(browser);
  await everyTapAFullLoad(safari);
  const safariPage = await safari.newPage();
  await safariPage.goto(url);
  report(!!cy && await reaches(safariPage, `/g?id=${groupId}`, LEDGER) === `/g?id=${groupId}` && await named(safariPage, groupId) === cy,
    `Safari opening ${how} from the in-app browser lands in the group as the same person, never asked`,
    `${at(safariPage)} as ${await named(safariPage, groupId)} (was ${cy}) — from ${url}`);
  await safari.close();
}

await browser.close();
close();
finish();
