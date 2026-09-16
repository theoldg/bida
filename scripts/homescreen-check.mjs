#!/usr/bin/env node
/**
 * `pnpm homescreen` — the invite that rides onto the home screen (docs/ios.md).
 *
 * One thing iOS does with a tapped "Add to Home Screen" cannot be checked
 * anywhere but an iPhone: which URL WebKit writes into the bookmark. Everything
 * *around* it can, and all of it is the kind that looks fine in jsdom — a
 * fragment that has to survive a navigation, a `<link rel="manifest">` swapped
 * on one platform and left alone on the other, and a launch that has to tell a
 * group it already holds from one it doesn't.
 *
 * So this check drives both ends of the trick in a phone-shaped browser wearing
 * an iPhone's user agent: the tab that prepares the icon, and the app launched
 * as that icon. What is left for the owner's phone is the one question in the
 * middle.
 */
import {
  ensureBuild, serveExport, launch, newPhone, newGroup, openGroupsList, asInstalledApp, reporter,
} from "./lib/harness.mjs";

ensureBuild();
const { base, close } = await serveExport();
const browser = await launch();
const { report, finish } = reporter();

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15"
  + " (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const iphone = (opts) => newPhone(browser, { userAgent: IPHONE, ...opts });

/**
 * The group secrets this phone holds, read straight out of IndexedDB.
 *
 * The only assertion here that cannot be made from a screen: this check serves
 * the static export with no sync API behind it, so a group whose key has just
 * arrived has no ops to draw a row with.
 */
const secretsHeld = (page) => page.evaluate(() => new Promise((ok, fail) => {
  const open = indexedDB.open("hajsik");
  open.onerror = () => fail(open.error);
  open.onsuccess = () => {
    const rows = open.result.transaction("groupKeys").objectStore("groupKeys").getAll();
    rows.onsuccess = () => ok(rows.result.map((row) => `${row.groupId}.${row.secret}`));
    rows.onerror = () => fail(rows.error);
  };
}));

/** The manifest this page would hand iOS, and whether it is the static one. */
const manifestOf = (page) => page.evaluate(async () => {
  const links = [...document.head.querySelectorAll('link[rel="manifest"]')];
  const href = links[0]?.getAttribute("href") ?? null;
  return {
    // Two manifests is a bug of its own: the static one would win, and the
    // page-URL fallback needs a head with nothing readable in it.
    count: links.length,
    href,
    json: href?.startsWith("blob:") ? await (await fetch(href)).json() : null,
  };
});

// ---- a group, and the link that invites someone to it --------------------
const host = await newPhone(browser, { permissions: ["clipboard-read", "clipboard-write"] });
const hostPage = await host.newPage();
const groupId = await newGroup(hostPage, base, { name: "Lisbon", me: "Ana", members: ["Bo"] });
await hostPage.goto(`${base}/g/members?id=${groupId}`);
await hostPage.getByRole("button", { name: "Copy invite link" }).first().click();
const invite = await hostPage.evaluate(() => navigator.clipboard.readText());
const fragment = new URL(invite).hash;

// ---- the join screen's "Add to home screen" ------------------------------
const tab = await iphone({ permissions: ["clipboard-read", "clipboard-write"] });
const tabPage = await tab.newPage();
await tabPage.goto(`${base}/join${fragment}`);
const choice = tabPage.getByRole("button", { name: "Add to home screen" });
// The screen draws blank until the device record answers whether this phone
// has already said who it is here, so wait for the fork rather than race it.
const asked = await choice.first().waitFor({ timeout: 8000 }).then(() => true, () => false);
report(asked, "an iOS tab is asked before it joins");

await choice.first().click();
await tabPage.waitForURL(/\/install/, { timeout: 8000 });
report(new URL(tabPage.url()).hash === fragment,
  "and the tutorial it lands on carries the invite in its own fragment");

// The page iOS bookmarks is this one, so its URL is half the trick; the other
// half is the manifest, whose start_url wins where WebKit reads it.
await tabPage.waitForTimeout(400);
const swapped = await manifestOf(tabPage);
report(swapped.href?.startsWith("blob:") && swapped.count === 1,
  "the tutorial points the app's one manifest at a runtime one", `href: ${swapped.href}`);
report(swapped.json?.start_url === `${base}/join${fragment}`,
  "whose start_url is the invite", `start_url: ${swapped.json?.start_url}`);
report(swapped.json?.id === `${base}/` && swapped.json?.scope === `${base}/`,
  "still describing this app, at this scope");
report(swapped.json?.icons?.every((icon) => icon.src.startsWith(`${base}/`)),
  "with absolute icons — a blob manifest has no base to resolve them against");

// And the same question Safari asks WebKit when the share sheet opens, asked
// of the engine that is actually here: `Page.getAppManifest` is the browser's
// own install machinery, and it answers from the DOM as it stands, not from
// what was in the head at load. Chromium is not WebKit and cannot say what iOS
// bookmarks — but it is a second implementation of the same parse, and it is
// the only one that can be run.
const cdp = await tab.newCDPSession(tabPage);
const wouldInstall = await cdp.send("Page.getAppManifest");
report(wouldInstall.url === swapped.href && wouldInstall.errors.length === 0,
  "and the browser's own install machinery takes it, without complaint",
  `${wouldInstall.url}${wouldInstall.errors.map((e) => `\n        ${e.message}`).join("")}`);
report(JSON.parse(wouldInstall.data ?? "{}").start_url === `${base}/join${fragment}`,
  "fragment and all — nothing in the parse strips it");

// The green above is only worth something if this comes back red: every URL in
// a blob manifest has to be absolute, because a blob has no base, and that is
// the one mistake this whole approach invites.
await tabPage.evaluate(() => {
  const url = URL.createObjectURL(new Blob(
    [JSON.stringify({ name: "bida", start_url: "/join#g1.shh" })],
    { type: "application/manifest+json" },
  ));
  document.head.querySelector('link[rel="manifest"]').setAttribute("href", url);
});
const broken = await cdp.send("Page.getAppManifest");
report(broken.errors.some((e) => e.message.includes("start_url")),
  "where a relative start_url would be refused, so that green means something",
  JSON.stringify(broken.errors.map((e) => e.message)));

// ---- and the banner, for the groups already in the tab ------------------
// A tab that holds groups is warned it may lose them, and that warning's
// tutorial carries every one of them — the top of the list first. Its own
// phone, because the fork above only asks about a group this one never claimed.
const held = await iphone({ permissions: ["clipboard-read", "clipboard-write"] });
const heldPage = await held.newPage();
const inviteTo = async (name, me, other) => {
  const id = await newGroup(heldPage, base, { name, me, members: [other] });
  await heldPage.goto(`${base}/g/members?id=${id}`);
  await heldPage.getByRole("button", { name: "Copy invite link" }).first().click();
  return new URL(await heldPage.evaluate(() => navigator.clipboard.readText())).hash.slice(1);
};
// Newest last: the groups list is by last activity, so the second is the top
// row, and the fragment must lead with it rather than with whatever Dexie
// happens to return first.
const flat = await inviteTo("Flat", "Cem", "Dita");
const ski = await inviteTo("Ski", "Eve", "Fen");

await openGroupsList(heldPage, base);
const banner = heldPage.getByRole("button", { name: "Add to home screen" });
const warned = await banner.first().waitFor({ timeout: 8000 }).then(() => true, () => false);
report(warned, "the groups list warns an iOS tab it may forget its groups");
await banner.first().click();
await heldPage.waitForURL(/\/install/, { timeout: 8000 });
report(new URL(heldPage.url()).hash === `#${ski}~${flat}`,
  "and its tutorial carries every group in the tab, the top of the list first",
  heldPage.url());

const both = await manifestOf(heldPage);
report(both.json?.start_url === `${base}/install#${ski}~${flat}`,
  "as does the manifest, which has no one group to start at",
  `start_url: ${both.json?.start_url}`);

// ---- Android is not touched ----------------------------------------------
const android = await newPhone(browser);
const androidPage = await android.newPage();
await androidPage.goto(`${base}/install${fragment}`);
await androidPage.waitForTimeout(400);
report((await manifestOf(androidPage)).href === "/manifest.webmanifest",
  "a browser that installs by itself keeps the one manifest, starting at /");

// ---- the icon's first launch ---------------------------------------------
// iOS kept `/install#…` (the fallback half): this launch is the join the tab
// never finished, and it must hand the invite on without anyone pasting. Where
// the join goes from there is the join screen's own business (`pnpm claim`).
const fresh = await iphone();
const freshPage = await fresh.newPage();
await asInstalledApp(freshPage);
await freshPage.goto(`${base}/install${fragment}`);
const handed = await freshPage.waitForURL(
  (url) => url.pathname === "/join" && url.hash === fragment, { timeout: 8000 },
).then(() => true, () => false);
report(handed, "launching the icon opens the invite it was added for", freshPage.url());
// The secret is written by the join screen, not by the launch — wait for the
// screen that only draws once it has been ("Joining…", since no other phone is
// pushing to this server), or the launch below has nothing to have held.
await freshPage.getByText("Joining…").waitFor({ timeout: 8000 });

// ---- and every launch after ----------------------------------------------
// The fragment has done its work — the key is on this phone now — so the app
// starts where the app starts rather than being one group's door forever.
const visited = [];
freshPage.on("framenavigated", (frame) => { if (!frame.parentFrame()) visited.push(frame.url()); });
await freshPage.goto(`${base}/install${fragment}`);
await freshPage.waitForTimeout(800);
report(!visited.some((url) => new URL(url).pathname === "/join"),
  "a second launch does not re-open a join for a group this phone holds", visited.join(" "));
report(new URL(freshPage.url()).pathname !== "/install",
  "and does not sit on the tutorial", freshPage.url());

// ---- a phone that brought several over -----------------------------------
// There is no one group to open, so the keys go in where they are read and the
// list is where it lands — filling as each group syncs.
const many = await iphone();
const manyPage = await many.newPage();
await asInstalledApp(manyPage);
await manyPage.goto(`${base}/install#${ski}~${flat}`);
const landed = await manyPage.waitForURL((url) => url.pathname === "/", { timeout: 8000 })
  .then(() => true, () => false);
report(landed, "launching an icon added with several groups lands on the list", manyPage.url());
report((await secretsHeld(manyPage)).sort().join(" ") === [ski, flat].sort().join(" "),
  "holding every secret it was added with");

await browser.close();
close();
finish();
