#!/usr/bin/env node
// Doc: docs/browser-checks.md#pnpm-verify-homescreen--the-invite-that-rides-onto-the-home-screen
import {
  ensureBuild, serveExport, launch, newPhone, newGroup, openGroupsList, asInstalledApp, PATIENCE, reporter,
  readStore, readDevice, untilDevice,
} from "../lib/harness.mjs";

ensureBuild();
const { base, close } = await serveExport();
const browser = await launch();
const { report, finish } = reporter();

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15"
  + " (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const iphone = (opts) => newPhone(browser, { userAgent: IPHONE, ...opts });

const joined = (page) => page.getByText("Taking a while.");

const secretsHeld = async (page) =>
  (await readStore(page, "groupKeys")).map((row) => `${row.groupId}.${row.secret}`);

const namesHeld = async (page) => (await readDevice(page))?.meByGroup ?? {};

const manifestOf = (page) => page.evaluate(async () => {
  const links = [...document.head.querySelectorAll('link[rel="manifest"]')];
  const href = links[0]?.getAttribute("href") ?? null;
  return {
    // Two manifests is a bug of its own: the static one would win.
    count: links.length,
    href,
    json: href?.startsWith("blob:") ? await (await fetch(href)).json() : null,
  };
});

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
await joined(tabPage).waitFor({ timeout: PATIENCE });
report(await tabPage.getByRole("button", { name: "Add bida to home screen" }).count() === 0,
  "an iOS tab joins without being asked to install first");

await tabPage.waitForFunction((hash) => localStorage.getItem("bida.carry") === hash, fragment.slice(1),
  { timeout: PATIENCE }).catch(() => {});
await tabPage.goto(`${base}/install${fragment}`);

// Safari reads the manifest at load, so no page's HTML may carry one — the head's
// own script writes it.
const pages = await Promise.all(["/", "/install", "/g"].map((path) => fetch(`${base}${path}`).then((r) => r.text())));
report(pages.every((html) => !/<link[^>]*rel="manifest"/.test(html)),
  "no page's HTML carries a manifest for Safari to read at load");

const swapped = await blobManifest(tabPage);
report(swapped.href?.startsWith("blob:") && swapped.count === 1,
  "the tutorial's head holds one manifest, built at load", `href: ${swapped.href}`);
report(swapped.json?.start_url === `${base}/install${fragment}`,
  "whose start_url carries the invite to /install", `start_url: ${swapped.json?.start_url}`);
report(swapped.json?.id === `${base}/` && swapped.json?.scope === `${base}/`,
  "still describing this app, at this scope");
report(swapped.json?.icons?.every((icon) => icon.src.startsWith(`${base}/`)),
  "with absolute icons — a blob manifest has no base to resolve them against");

const cdp = await tab.newCDPSession(tabPage);
const wouldInstall = await cdp.send("Page.getAppManifest");
report(wouldInstall.url === swapped.href && wouldInstall.errors.length === 0,
  "and the browser's own install machinery takes it, without complaint",
  `${wouldInstall.url}${wouldInstall.errors.map((e) => `\n        ${e.message}`).join("")}`);
report(JSON.parse(wouldInstall.data ?? "{}").start_url === `${base}/install${fragment}`,
  "fragment and all — nothing in the parse strips it");

// Must come back red: a blob has no base, so every URL in it has to be absolute.
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
const held = await iphone({ permissions: ["clipboard-read", "clipboard-write"] });
const heldPage = await held.newPage();
/**
 * A tab whose groups just changed reloads to rebuild its head, so a `goto`
 * straight after is aborted by it.
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
const flat = await inviteTo("Flat", "Cem", "Dita");
const ski = await inviteTo("Ski", "Eve", "Fen");

await openGroupsList(heldPage, base);
const banner = heldPage.getByRole("button", { name: "Add bida to home screen" });
const warned = await banner.first().waitFor({ timeout: PATIENCE }).then(() => true, () => false);
report(warned, "the groups list warns an iOS tab it may forget its groups");
await banner.first().click();
await heldPage.waitForURL(/\/install/, { timeout: PATIENCE });
const me = await namesHeld(heldPage);
const named = (hash) => `${hash}.${me[hash.split(".")[0]]}`;
const carried = `${named(ski)}~${named(flat)}`;
report(Object.keys(me).length === 2 && new URL(heldPage.url()).hash === `#${carried}`,
  "and its tutorial carries every group in the tab and who you are in it, the top of the list first",
  heldPage.url());

const both = await blobManifest(heldPage);
const sameGroups = (a, b) => a.split("~").sort().join("~") === b.split("~").sort().join("~");
report((both.json?.start_url ?? "").startsWith(`${base}/install#`)
  && sameGroups(new URL(both.json.start_url).hash.slice(1), carried),
  "as does the manifest", `start_url: ${both.json?.start_url}`);

// ---- Share from any page -------------------------------------------------
const flatId = flat.split(".")[0];
for (const path of ["/", `/g?id=${flatId}`, `/g/members?id=${flatId}`]) {
  await heldPage.goto(`${base}${path}`);
  const onPage = await blobManifest(heldPage);
  const start = onPage.json?.start_url ?? "";
  report(start.startsWith(`${base}/install#`) && sameGroups(new URL(start).hash.slice(1), carried),
    `a page that is not the tutorial carries them too: ${path}`, `start_url: ${start}`);
}

// ---- a name picked after the page loaded --------------------------------
// Safari never re-reads a manifest, so a client-side move must bring a stale head
// up to date.
const stampStale = (page) => page.evaluate(() => {
  window.__samePage = true;
  document.head.querySelector('link[rel="manifest"]').setAttribute("data-carry", "stale");
});
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
  `${heldLoads.length} loads${heldLoads.map((u) => `\n        ${u.replace(base, "")}`).join("")}`
  + `\n        start_url: ${rebuiltStart}`);
await heldPage.evaluate(() => { window.__afterTheReload = true; });
await heldPage.waitForTimeout(1500);
report(await heldPage.evaluate(() => !!window.__afterTheReload), "once — the rebuilt head is not stale");

// ---- but never before the shell is cached --------------------------------
// On a first visit the reload would race the precache.
const cold = await iphone({ serviceWorkers: "block" });
const coldPage = await cold.newPage();
await newGroup(coldPage, base, { name: "Cold", me: "Gil", members: ["Hana"] });
await openGroupsList(coldPage, base);
await blobManifest(coldPage);
const coldLoads = countLoads(coldPage);
await stampStale(coldPage);
await coldPage.getByText("Cold").first().click();
const onLedger = await coldPage.waitForURL((url) => url.pathname === "/g", { timeout: PATIENCE })
  .then(() => true, () => false);
await coldPage.waitForTimeout(1500);
report(onLedger && coldLoads.length === 0 && await coldPage.evaluate(() => !!window.__samePage),
  "a first visit, with no shell cached yet, leaves the stale head to the screen after",
  `${coldLoads.length} loads`);

// ---- the ledger's banner --------------------------------------------------
await heldPage.goto(`${base}/g?id=${flatId}`);
const fold = heldPage.getByRole("button", { name: "Keep your groups on this phone" });
const folded = await fold.waitFor({ timeout: PATIENCE }).then(() => true, () => false)
  && await heldPage.getByRole("button", { name: "Add bida to home screen" }).count() === 0;
if (folded) await fold.click();
report(folded && await heldPage.getByRole("button", { name: "Add bida to home screen" })
  .waitFor({ timeout: 2000 }).then(() => true, () => false),
  "a group's ledger asks an iOS tab too, folded");

// ---- which one are you, in a tab ------------------------------------------
await heldPage.goto(`${base}/g/claim?id=${flatId}`);
const offered = await heldPage.getByText("Have the app?").waitFor({ timeout: PATIENCE }).then(() => true, () => false);
const boxed = await heldPage.locator(".inapp .linkbox .selectable").textContent().catch(() => null);
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

await androidPage.goto(`${base}/g?id=${androidGroup}`);
const androidAdd = androidPage.getByRole("button", { name: "Add", exact: true });
const androidFolded = await offerInstall(androidPage) && await androidAdd.count() === 0;
if (androidFolded) await androidOffer(androidPage).click();
report(androidFolded && await androidAdd.waitFor({ timeout: 2000 }).then(() => true, () => false),
  "a group's ledger offers Android the same card, folded");

const watchFrames = (page, run) => page.addInitScript((run) => {
  const count = (key) => {
    const at = `frames.${run}.${key}`;
    sessionStorage.setItem(at, String(Number(sessionStorage.getItem(at) ?? 0) + 1));
  };
  const shown = (el) => el.getClientRects().length > 0;
  const look = () => {
    if (document.body) {
      count("frames");
      const install = location.pathname === "/install";
      if (install && [...document.querySelectorAll(".ownframe")].some(shown)) count("tutorial");
      if (![...document.querySelectorAll(".app .topbar")].some(shown)) count("blank");
      if (install && [...document.querySelectorAll(".starttiles")].some(shown)) count("list");
      if (install && [...document.querySelectorAll("a, button")].some((el) => shown(el) && !el.closest("[inert]"))) {
        count("pressable");
      }
    }
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}, run);
const framesSeen = (page, run) => page.evaluate((run) => Object.fromEntries(
  ["frames", "tutorial", "blank", "list", "pressable"]
    .map((k) => [k, Number(sessionStorage.getItem(`frames.${run}.${k}`) ?? 0)])), run);
const steady = (seen) => seen.frames > 0 && seen.tutorial === 0 && seen.blank === 0 && seen.pressable === 0;

// ---- the icon's first launch ---------------------------------------------
const fresh = await iphone();
const freshPage = await fresh.newPage();
await asInstalledApp(freshPage);
await watchFrames(freshPage, "newcomer");
await freshPage.goto(`${base}/install${fragment}`);
const handed = await freshPage.waitForURL(
  (url) => url.pathname === "/join" && url.hash === fragment, { timeout: PATIENCE },
).then(() => true, () => false);
report(handed, "launching the icon opens the invite it was added for", freshPage.url());
const newcomerFrames = await framesSeen(freshPage, "newcomer");
report(steady(newcomerFrames) && newcomerFrames.list === 0,
  "wearing \"Joining…\" from the first frame: never the tutorial, nor the list it is not going to",
  JSON.stringify(newcomerFrames));
await joined(freshPage).waitFor({ timeout: PATIENCE });

// ---- and every launch after ----------------------------------------------
const visited = [];
freshPage.on("framenavigated", (frame) => { if (!frame.parentFrame()) visited.push(frame.url()); });
await freshPage.goto(`${base}/install${fragment}`);
await freshPage.waitForTimeout(800);
report(!visited.some((url) => new URL(url).pathname === "/join"),
  "a second launch does not re-open a join for a group this phone holds", visited.join(" "));
report(new URL(freshPage.url()).pathname !== "/install",
  "and does not sit on the tutorial", freshPage.url());

// ---- and a launch is a launch --------------------------------------------
const made = await newGroup(freshPage, base, { name: "Ferry", me: "Ana", members: ["Bo"] });
await freshPage.waitForSelector(".fab");
await untilDevice(freshPage, (d) => d?.lastOpenedGroupId === made);
await watchFrames(freshPage, "reopen");
await freshPage.goto(`${base}/install${fragment}`);
const reopened = await freshPage.waitForURL(
  (url) => url.pathname === "/g" && url.searchParams.get("id") === made, { timeout: PATIENCE },
).then(() => true, () => false);
report(reopened, "and reopens the group this phone was last in, as any other launch does",
  freshPage.url());
await freshPage.waitForSelector(".fab");
const reopenFrames = await framesSeen(freshPage, "reopen");
report(steady(reopenFrames) && reopenFrames.list === 0,
  "in the group's skeleton from the first frame: never the tutorial, a blank, or the list",
  JSON.stringify(reopenFrames));

// ---- a phone that brought several over -----------------------------------
const many = await iphone();
const manyPage = await many.newPage();
await asInstalledApp(manyPage);
await watchFrames(manyPage, "many");
await manyPage.goto(`${base}/install#${carried}`);
const landed = await manyPage.waitForURL((url) => url.pathname === "/", { timeout: PATIENCE })
  .then(() => true, () => false);
report(landed, "launching an icon added with several groups lands on the list", manyPage.url());
await manyPage.getByText("Getting your groups").waitFor({ timeout: PATIENCE }).catch(() => {});
const manyFrames = await framesSeen(manyPage, "many");
report(steady(manyFrames), "and shows the list's skeleton on the way, never the tutorial or a blank",
  JSON.stringify(manyFrames));
report((await secretsHeld(manyPage)).sort().join(" ") === [ski, flat].sort().join(" "),
  "holding every secret it was added with");
const claimed = await namesHeld(manyPage);
report(Object.keys(me).every((id) => claimed[id] === me[id]),
  "and already somebody in each — nobody is asked who they are again",
  JSON.stringify(claimed));

report(await manyPage.getByText("Getting your groups").waitFor({ timeout: PATIENCE })
  .then(() => true, () => false)
  && await manyPage.getByText("No groups yet").count() === 0,
  "and waits for them rather than calling itself empty");

// ---- one named group -----------------------------------------------------
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
report(await webviewPage.getByText("Open in Safari").count() > 0
  && await webviewPage.getByText("⋯", { exact: false }).count() > 0,
  "and told which button to press, and what it says underneath");
report(await webviewPage.locator(".escapelink .linkbox .selectable").textContent()
  .catch(() => null) === `${base}/join${fragment}`,
  "and handed the link it arrived with, to paste into a real browser");
report(await webviewPage.locator(".escapelink .linkbox").evaluate((box) => {
  const state = box.querySelector(".linkboxstate").getBoundingClientRect();
  const link = box.querySelector(".selectable").getBoundingClientRect();
  return box.scrollWidth <= box.clientWidth && Math.abs(state.top - link.top) < link.height;
}).catch(() => false), "on one line that fits the screen, the copy state beside it");
report((await secretsHeld(webviewPage).catch(() => [])).length === 0,
  "nothing is written to a storage nobody can get back to");

// Some in-app browsers have no `navigator.clipboard`, and a throw here takes the
// page down.
const dry = await newPhone(browser, { userAgent: IN_APP_UA });
const dryPage = await dry.newPage();
const crashes = [];
dryPage.on("pageerror", (e) => crashes.push(e.message.split("\n")[0]));
await dryPage.addInitScript(() => {
  Object.defineProperty(navigator, "clipboard", { get: () => undefined, configurable: true });
});
await dryPage.goto(`${base}/join${fragment}`);
const escaped = await dryPage.getByText("Open bida in your browser").first()
  .waitFor({ timeout: PATIENCE }).then(() => true, () => false);
report(escaped && crashes.length === 0,
  "a webview with no clipboard still gets the way out, not an error page", crashes.join(" "));
report(await dryPage.locator(".escapelink .linkbox .selectable").textContent()
  .catch(() => null) === `${base}/join${fragment}`,
  "with the link still there to be taken by hand");
await dry.close();

// A false positive locks somebody out, so prove the lookalikes.
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
