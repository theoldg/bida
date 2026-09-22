#!/usr/bin/env node
/**
 * `pnpm homescreen` — the invite that rides onto the home screen (docs/ios.md).
 *
 * Only an iPhone can say which URL WebKit writes into an "Add to Home Screen"
 * bookmark. Everything around it is checked here, all of it the kind that
 * looks fine in jsdom: a fragment surviving a navigation, a manifest link
 * swapped on one platform only, a launch telling a held group from a new one.
 * Both ends run in a phone-shaped browser with an iPhone user agent: the tab
 * that prepares the icon, and the app launched as that icon.
 */
import {
  ensureBuild, serveExport, launch, newPhone, newGroup, openGroupsList, asInstalledApp, PATIENCE, reporter,
} from "./lib/harness.mjs";

ensureBuild();
const { base, close } = await serveExport();
const browser = await launch();
const { report, finish } = reporter();

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15"
  + " (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const iphone = (opts) => newPhone(browser, { userAgent: IPHONE, ...opts });

/**
 * The join screen once the secret is written. Its title is prerendered, so it
 * proves nothing; the body is a promise about this link and waits for the key.
 */
const joined = (page) => page.getByText("Finishes by itself once the other phone syncs.");

/**
 * The group secrets this phone holds, read from IndexedDB — no sync API is
 * behind this check, so a newly keyed group has no ops to draw a row with.
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

/** Who this phone is in each group — the device record's `meByGroup`. */
const namesHeld = (page) => page.evaluate(() => new Promise((ok, fail) => {
  const open = indexedDB.open("hajsik");
  open.onerror = () => fail(open.error);
  open.onsuccess = () => {
    const row = open.result.transaction("device").objectStore("device").get("device");
    row.onsuccess = () => ok(row.result?.meByGroup ?? {});
    row.onerror = () => fail(row.error);
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

/**
 * Wait for the blob manifest before reading it: `waitForURL` can return
 * before the head's script has run.
 *
 * `state: "attached"` — a head `<link>` is never *visible*, the default wait,
 * so without it the check times out on a green app.
 *
 * A swap that never comes resolves empty: the assertion below should say so,
 * not a stack trace.
 */
const blobManifest = (page) =>
  page.waitForSelector('link[rel="manifest"][href^="blob:"]', { state: "attached", timeout: PATIENCE })
    .then(() => manifestOf(page), () => ({ count: 0, href: null, json: null }));

// ---- a group, and the link that invites someone to it --------------------
const host = await newPhone(browser, { permissions: ["clipboard-read", "clipboard-write"] });
const hostPage = await host.newPage();
const groupId = await newGroup(hostPage, base, { name: "Lisbon", me: "Ana", members: ["Bo"] });
await hostPage.goto(`${base}/g/members?id=${groupId}`);
await hostPage.getByRole("button", { name: "Copy invite link" }).first().click();
const invite = await hostPage.evaluate(() => navigator.clipboard.readText());
const fragment = new URL(invite).hash;

// ---- a tab that has just joined -----------------------------------------
const tab = await iphone({ permissions: ["clipboard-read", "clipboard-write"] });
const tabPage = await tab.newPage();
await tabPage.goto(`${base}/join${fragment}`);
// No sync API behind this check, so the join waits forever — the point is
// that an iOS tab isn't stopped to be asked to install.
await joined(tabPage).waitFor({ timeout: PATIENCE });
report(await tabPage.getByRole("button", { name: "Add bida to home screen" }).count() === 0,
  "an iOS tab joins without being asked to install first");

// The key is saved behind that line; the carry the tutorial's head is built
// from follows it into localStorage.
await tabPage.waitForFunction((hash) => localStorage.getItem("bida.carry") === hash, fragment.slice(1),
  { timeout: PATIENCE }).catch(() => {});
await tabPage.goto(`${base}/install${fragment}`);

// On a real iPhone the icon opened at `/` though a swap had happened 41ms in:
// Safari reads the manifest at load. So no page's HTML may carry one — the
// head's own script writes it, before anything can read it.
const pages = await Promise.all(["/", "/install", "/g"].map((path) => fetch(`${base}${path}`).then((r) => r.text())));
report(pages.every((html) => !/<link[^>]*rel="manifest"/.test(html)),
  "no page's HTML carries a manifest for Safari to read at load");

// The page iOS bookmarks is this one, so its URL is half the trick; the other
// half is the manifest, whose start_url wins where WebKit reads it.
const swapped = await blobManifest(tabPage);
report(swapped.href?.startsWith("blob:") && swapped.count === 1,
  "the tutorial's head holds one manifest, built at load", `href: ${swapped.href}`);
report(swapped.json?.start_url === `${base}/install${fragment}`,
  "whose start_url carries the invite to /install", `start_url: ${swapped.json?.start_url}`);
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
report(JSON.parse(wouldInstall.data ?? "{}").start_url === `${base}/install${fragment}`,
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
// phone, with groups it has claimed.
const held = await iphone({ permissions: ["clipboard-read", "clipboard-write"] });
const heldPage = await held.newPage();
/**
 * A tab whose groups just changed reloads to rebuild its head — so a `goto`
 * straight after is aborted by it. Wait until the head matches what is held,
 * twice over, a navigation in between counting as not yet.
 */
const headSettled = async (page) => {
  for (let calm = 0, i = 0; calm < 2 && i < 40; i++) {
    await page.waitForTimeout(250);
    const fresh = await page.evaluate(() => {
      const built = document.head.querySelector('link[rel="manifest"]')?.getAttribute("data-carry");
      return built != null && built === (localStorage.getItem("bida.carry") ?? "");
    }).catch(() => false);
    calm = fresh ? calm + 1 : 0;
  }
};
const inviteTo = async (name, me, other) => {
  const id = await newGroup(heldPage, base, { name, me, members: [other] });
  await headSettled(heldPage);
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
const banner = heldPage.getByRole("button", { name: "Add bida to home screen" });
const warned = await banner.first().waitFor({ timeout: PATIENCE }).then(() => true, () => false);
report(warned, "the groups list warns an iOS tab it may forget its groups");
await banner.first().click();
await heldPage.waitForURL(/\/install/, { timeout: PATIENCE });
// Each group with the member this tab claimed in it, so the icon's app
// doesn't ask who you are again.
const me = await namesHeld(heldPage);
const named = (hash) => `${hash}.${me[hash.split(".")[0]]}`;
const carried = `${named(ski)}~${named(flat)}`;
report(Object.keys(me).length === 2 && new URL(heldPage.url()).hash === `#${carried}`,
  "and its tutorial carries every group in the tab and who you are in it, the top of the list first",
  heldPage.url());

const both = await blobManifest(heldPage);
// In any order: nothing about the manifest has a top of the list to follow.
const sameGroups = (a, b) => a.split("~").sort().join("~") === b.split("~").sort().join("~");
report((both.json?.start_url ?? "").startsWith(`${base}/install#`)
  && sameGroups(new URL(both.json.start_url).hash.slice(1), carried),
  "as does the manifest", `start_url: ${both.json?.start_url}`);

// ---- Share from any page -------------------------------------------------
// Not only the tutorial: whatever page the share sheet opens on, its head was
// built with every group the tab holds. The order is Dexie's here, not the
// list's — there is no screen to put first.
const flatId = flat.split(".")[0];
for (const path of ["/", `/g?id=${flatId}`, `/g/members?id=${flatId}`]) {
  await heldPage.goto(`${base}${path}`);
  const onPage = await blobManifest(heldPage);
  const start = onPage.json?.start_url ?? "";
  report(start.startsWith(`${base}/install#`) && sameGroups(new URL(start).hash.slice(1), carried),
    `a page that is not the tutorial carries them too: ${path}`, `start_url: ${start}`);
}

// ---- a name picked after the page loaded --------------------------------
// Safari never re-reads a manifest, so a head built before a group was joined
// or named would put an icon on the home screen without it. With no sync API
// to finish a real claim, the stale head is made by hand, and a client-side
// move to a reloadable screen must bring it up to date.
//
// A row tap on the list, not the back arrow: the arrow *traverses*
// (lib/nav.ts), and a traversal to an earlier document is a fresh load that
// rebuilds the head anyway — green either way. Counting document requests is
// the other half.
/** Stamp the head as built before a change, and mark the page that did it. */
const stampStale = (page) => page.evaluate(() => {
  window.__samePage = true;
  document.head.querySelector('link[rel="manifest"]').setAttribute("data-carry", "stale");
});
/** Every document this page asks for from here on: the reload is one of them. */
const countLoads = (page) => {
  const loads = [];
  page.on("request", (r) => { if (r.isNavigationRequest()) loads.push(r.url()); });
  return loads;
};

await openGroupsList(heldPage, base);
await blobManifest(heldPage);
const heldLoads = countLoads(heldPage);
await stampStale(heldPage);
await heldPage.getByText("Flat").first().click();
await heldPage.waitForURL((url) => url.pathname === "/g", { timeout: PATIENCE }).catch(() => {});
const refreshed = await heldPage.waitForFunction(() => !window.__samePage, null, { timeout: PATIENCE })
  .then(() => true, () => false);
const rebuilt = await blobManifest(heldPage);
const rebuiltStart = rebuilt.json?.start_url ?? "";
report(refreshed && heldLoads.length === 1 && rebuiltStart.startsWith(`${base}/install#`)
  && sameGroups(new URL(rebuiltStart).hash.slice(1), carried),
  "a page whose head predates a change reloads, and its manifest carries it",
  // The URLs, not the count: "2 loads" is the same line whether the second one
  // was a second reload or a screen this check never meant to visit.
  `${heldLoads.length} loads${heldLoads.map((u) => `\n        ${u.replace(base, "")}`).join("")}`
  + `\n        start_url: ${rebuiltStart}`);
await heldPage.evaluate(() => { window.__afterTheReload = true; });
await heldPage.waitForTimeout(1500);
report(await heldPage.evaluate(() => !!window.__afterTheReload), "once — the rebuilt head is not stale");

// ---- but never before the shell is cached --------------------------------
// The same reload on a newcomer's first visit — document `/join`, empty carry,
// worker still fetching 2.4 MB of shell — would race the precache for one
// phone connection with nothing on screen waiting on it. So it waits for the
// next reloadable screen (`shellIsWarm` in lib/update.ts). A context with no
// worker holds that minute still.
const cold = await iphone({ serviceWorkers: "block" });
const coldPage = await cold.newPage();
await newGroup(coldPage, base, { name: "Cold", me: "Gil", members: ["Hana"] });
await openGroupsList(coldPage, base);
await blobManifest(coldPage);
const coldLoads = countLoads(coldPage);
await stampStale(coldPage);
await coldPage.getByText("Cold").first().click();
// The screen it lands on *is* one a reload is allowed on — without this the
// assertion would pass on a page that simply never went anywhere.
const onLedger = await coldPage.waitForURL((url) => url.pathname === "/g", { timeout: PATIENCE })
  .then(() => true, () => false);
await coldPage.waitForTimeout(1500);
report(onLedger && coldLoads.length === 0 && await coldPage.evaluate(() => !!window.__samePage),
  "a first visit, with no shell cached yet, leaves the stale head to the screen after",
  `${coldLoads.length} loads`);

// ---- the ledger's banner --------------------------------------------------
// Folded on every visit, so it is the title that shows, and the button behind it.
await heldPage.goto(`${base}/g?id=${flatId}`);
const fold = heldPage.getByRole("button", { name: "Keep your groups on this phone" });
const folded = await fold.waitFor({ timeout: PATIENCE }).then(() => true, () => false)
  && await heldPage.getByRole("button", { name: "Add bida to home screen" }).count() === 0;
if (folded) await fold.click();
report(folded && await heldPage.getByRole("button", { name: "Add bida to home screen" })
  .waitFor({ timeout: 2000 }).then(() => true, () => false),
  "a group's ledger asks an iOS tab too, folded");

// ---- but never about the demo ---------------------------------------------
// The demo holds no key, so an icon carries nothing for it
// (docs/sync.md#the-demo-group-has-no-key), and a rescue banner would
// contradict its "nothing here syncs" mark. Its own phone, because the demo
// joins whatever list it opens on.
const tourist = await iphone();
const touristPage = await tourist.newPage();
await touristPage.goto(`${base}/demo`);
// The mark is the proof this ran at all: without it an absent banner would
// only mean the ledger never drew.
const marked = await touristPage.locator(".demomark").waitFor({ timeout: PATIENCE })
  .then(() => true, () => false);
const demoBanner = () => touristPage.getByRole("button", { name: "Keep your groups on this phone" });
const quietLedger = await demoBanner().count() === 0;
await openGroupsList(touristPage, base);
const listed = await touristPage.locator(".rows .row").count();
const quietList = await demoBanner().count() === 0;
report(marked && quietLedger && listed > 0 && quietList,
  "the demo's ledger, and a list holding only the demo, ask nothing about the home screen",
  `${listed} rows`);

// ---- which one are you, in a tab ------------------------------------------
// Someone who already has the app can't be told apart from a tab, so the claim
// list offers them the link to paste there, with its own copy button.
await heldPage.goto(`${base}/g/claim?id=${flatId}`);
const offered = await heldPage.getByText("Have the app?").waitFor({ timeout: PATIENCE }).then(() => true, () => false);
const boxed = await heldPage.locator(".inapp .linkbox .selectable").textContent().catch(() => null);
// Pinned under the scroll: a long list of people must not carry it off screen.
const pinned = await heldPage.locator(".inappdock .inapp").evaluate((card) =>
  card.getBoundingClientRect().bottom <= window.innerHeight
  && !card.closest(".scroll")).catch(() => false);
report(offered && boxed === `${base}/join#${flat}` && pinned,
  "the claim list offers an iOS tab the group's link to paste into the app, pinned in view", boxed ?? "");

// ---- Android carries nothing -----------------------------------------------
const android = await newPhone(browser);
const androidPage = await android.newPage();
await androidPage.goto(`${base}/install${fragment}`);
await androidPage.waitForTimeout(400);
const androidManifest = await manifestOf(androidPage);
report(androidManifest.href === "/manifest.webmanifest" && androidManifest.count === 1,
  "a browser that installs by itself gets the one static manifest, starting at /");

// ---- ...but it is asked in the same two places ----------------------------
// The carry is iOS's alone; *where the offer is drawn* is not. Chrome fires
// `beforeinstallprompt` on its own heuristics, so the page is handed one —
// repeatedly until it lands, since the listener attaches at module load.
const androidOffer = (page) => page.getByRole("button", { name: "Keep bida on your home screen" });
async function offerInstall(page) {
  for (let attempt = 0; attempt < 24; attempt++) {
    await page.evaluate(() => window.dispatchEvent(new Event("beforeinstallprompt")));
    if (await androidOffer(page).count()) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

const androidGroup = await newGroup(androidPage, base, { name: "Porto", me: "Gil", members: ["Hana"] });
await openGroupsList(androidPage, base);
report(await offerInstall(androidPage), "the groups list offers Chrome's own install prompt");

// And the ledger, where a launch and a join both actually land (lib/launch.ts):
// folded to its title, like the iOS banner above and for the same reason.
await androidPage.goto(`${base}/g?id=${androidGroup}`);
const androidAdd = androidPage.getByRole("button", { name: "Add", exact: true });
const androidFolded = await offerInstall(androidPage) && await androidAdd.count() === 0;
if (androidFolded) await androidOffer(androidPage).click();
report(androidFolded && await androidAdd.waitFor({ timeout: 2000 }).then(() => true, () => false),
  "a group's ledger offers Android the same card, folded");

// ---- the icon's first launch ---------------------------------------------
// An invite nobody has picked a name in yet: this launch is the join the tab
// never finished, and it must hand the invite on without anyone pasting. Where
// the join goes from there is the join screen's own business (`pnpm claim`).
const fresh = await iphone();
const freshPage = await fresh.newPage();
await asInstalledApp(freshPage);
await freshPage.goto(`${base}/install${fragment}`);
const handed = await freshPage.waitForURL(
  (url) => url.pathname === "/join" && url.hash === fragment, { timeout: PATIENCE },
).then(() => true, () => false);
report(handed, "launching the icon opens the invite it was added for", freshPage.url());
// The secret is written by the join screen, not by the launch — wait for the
// line that only draws once it has been (and stays, since no other phone is
// pushing to this server), or the launch below has nothing to have held.
await joined(freshPage).waitFor({ timeout: PATIENCE });

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

// ---- and a launch is a launch --------------------------------------------
// `start_url` is `/install` for the bookmark's life, so nothing in the address
// says this was a start: `/install` must say so itself (`launchedOnto`,
// lib/launch.ts), or this install lands on the list every time.
//
// The group is made here, not carried: nothing syncs behind this check, so a
// carried group never arrives.
const made = await newGroup(freshPage, base, { name: "Ferry", me: "Ana", members: ["Bo"] });
// Which group this phone was last in is written by an effect on the ledger, so
// relaunching the moment the URL changes races it — and the launch then finds
// nowhere to go, which is a pass for the wrong reason half the time. So wait
// for the write itself: a pause long enough on one machine is exactly the kind
// of race this comment is about.
await freshPage.waitForSelector(".bottomnav a");
await freshPage.waitForFunction((id) => new Promise((resolve) => {
  const req = indexedDB.open("hajsik");
  req.onsuccess = () => {
    const get = req.result.transaction("device").objectStore("device").get("device");
    get.onsuccess = () => resolve(get.result?.lastOpenedGroupId === id);
  };
}), made, { timeout: PATIENCE });
await freshPage.goto(`${base}/install${fragment}`);
const reopened = await freshPage.waitForURL(
  (url) => url.pathname === "/g" && url.searchParams.get("id") === made, { timeout: PATIENCE },
).then(() => true, () => false);
report(reopened, "and reopens the group this phone was last in, as any other launch does",
  freshPage.url());

// ---- a phone that brought several over -----------------------------------
// There is no one group to open, so the keys go in where they are read and the
// list is where it lands — filling as each group syncs.
const many = await iphone();
const manyPage = await many.newPage();
await asInstalledApp(manyPage);
await manyPage.goto(`${base}/install#${carried}`);
const landed = await manyPage.waitForURL((url) => url.pathname === "/", { timeout: PATIENCE })
  .then(() => true, () => false);
report(landed, "launching an icon added with several groups lands on the list", manyPage.url());
report((await secretsHeld(manyPage)).sort().join(" ") === [ski, flat].sort().join(" "),
  "holding every secret it was added with");
const claimed = await namesHeld(manyPage);
report(Object.keys(me).every((id) => claimed[id] === me[id]),
  "and already somebody in each — nobody is asked who they are again",
  JSON.stringify(claimed));

// No sync API stands behind this check, so these groups never arrive — which
// is the slow phone's first launch held still. What it must not say is that
// there are none: somebody who installed bida to *keep* their groups, told on
// the icon's first open that it has no groups yet, has been shown the app
// losing them.
report(await manyPage.getByText("Getting your groups").waitFor({ timeout: PATIENCE })
  .then(() => true, () => false)
  && await manyPage.getByText("No groups yet").count() === 0,
  "and waits for them rather than calling itself empty");

// ---- one named group -----------------------------------------------------
// The regular with a single group: named, so not the newcomer `/join` is for.
const one = await iphone();
const onePage = await one.newPage();
await asInstalledApp(onePage);
const oneVisited = [];
onePage.on("framenavigated", (frame) => { if (!frame.parentFrame()) oneVisited.push(frame.url()); });
await onePage.goto(`${base}/install#${named(flat)}`);
await onePage.waitForURL((url) => url.pathname === "/" || url.pathname === "/g", { timeout: PATIENCE })
  .catch(() => {});
report(!oneVisited.some((url) => new URL(url).pathname === "/join")
  && (await namesHeld(onePage))[flatId] === me[flatId],
  "one named group skips the join screen and is already claimed", oneVisited.join(" "));

// ---- the in-app browser --------------------------------------------------
// Instagram and Messenger open a tapped link in a webview of their own: a
// storage nothing can get back to, with no Add to Home Screen in it, where
// joining only buys a second claim later (lib/embedded.ts). So the app refuses
// to run there — and the refusal has to be worth more than it costs, which is
// the second half of this section.
const IN_APP_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15"
  + " (KHTML, like Gecko) Mobile/15E148 Instagram 339.0.3.12.106";
const webview = await newPhone(browser, { userAgent: IN_APP_UA, permissions: ["clipboard-read", "clipboard-write"] });
const webviewPage = await webview.newPage();
await webviewPage.goto(`${base}/join${fragment}`);
const refused = await webviewPage.getByText("Open bida in your browser")
  .waitFor({ timeout: PATIENCE }).then(() => true, () => false);
report(refused && await joined(webviewPage).count() === 0,
  "an in-app browser is turned round rather than joined in");
report(await webviewPage.getByText("Instagram").count() > 0,
  "named, so the person knows which app has them");
// The whole value of the screen is that this line names a button rather than
// "a menu": the ellipsis on iOS, the kebab on Android, and the item under each.
report(await webviewPage.getByText("Open in Safari").count() > 0
  && await webviewPage.getByText("⋯", { exact: false }).count() > 0,
  "and told which button to press, and what it says underneath");
report(await webviewPage.locator(".escapelink .linkbox .selectable").textContent()
  .catch(() => null) === `${base}/join${fragment}`,
  "and handed the link it arrived with, to paste into a real browser");
// Blocked means blocked: the key must not be saved behind the screen, or the
// webview holds a group it can never give back.
report((await secretsHeld(webviewPage).catch(() => [])).length === 0,
  "nothing is written to a storage nobody can get back to");

// **And it has to survive the browser it is shown in.** Some in-app browsers
// expose no `navigator.clipboard` at all, and this screen copies the link on
// arrival — a bare `writeText` throws there rather than rejecting, and the
// screen renders outside `ReadErrorBoundary`, so the throw took the whole page
// down to Next's "Application error". On the one screen those visitors get.
// See docs/frontend.md#the-clipboard.
const dry = await newPhone(browser, { userAgent: IN_APP_UA });
const dryPage = await dry.newPage();
const crashes = [];
dryPage.on("pageerror", (e) => crashes.push(e.message.split("\n")[0]));
await dryPage.addInitScript(() => {
  Object.defineProperty(navigator, "clipboard", { get: () => undefined, configurable: true });
});
await dryPage.goto(`${base}/join${fragment}`);
await dryPage.waitForTimeout(600);
report(await dryPage.getByText("Open bida in your browser").count() > 0 && crashes.length === 0,
  "a webview with no clipboard still gets the way out, not an error page", crashes.join(" "));
report(await dryPage.locator(".escapelink .linkbox .selectable").textContent()
  .catch(() => null) === `${base}/join${fragment}`,
  "with the link still there to be taken by hand");
await dry.close();

// The cost of being wrong. A false positive locks somebody out of the app
// altogether, so the browsers that look most like a webview are the ones to
// prove: the home-screen app, whose agent drops `Safari/` exactly as a webview
// does, and Brave and DuckDuckGo, whose agents are Safari's but for a token.
const NEAR_MISSES = [
  ["the home-screen app", `${IPHONE.replace(" Version/17.5", "").replace(" Safari/604.1", "")}`, true],
  ["Brave", `${IPHONE} Brave/1.67`, false],
  ["DuckDuckGo", IPHONE.replace(" Safari/604.1", " DuckDuckGo/7 Safari/604.1"), false],
];
for (const [name, ua, installed] of NEAR_MISSES) {
  const near = await iphone({ userAgent: ua });
  const nearPage = await near.newPage();
  if (installed) await asInstalledApp(nearPage);
  await nearPage.goto(`${base}/`);
  await nearPage.waitForTimeout(600);
  report(await nearPage.getByText("Open bida in your browser").count() === 0,
    `${name} is not mistaken for one`);
  await near.close();
}

await browser.close();
close();
finish();
