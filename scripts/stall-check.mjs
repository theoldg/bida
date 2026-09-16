#!/usr/bin/env node
/**
 * `pnpm stall` — what the app does when reading this phone's database stops
 * working. The defect it was written for: an installed Android PWA that hung
 * on its skeleton rows, indefinitely, with nothing in the console.
 *
 * Three ways for a read to die, all of them silent before lib/db/live.ts:
 *
 *  1. **It never answers.** Dexie's `liveQuery` swallows the two error names
 *     the browser uses when it kills a query under a frozen or evicted page
 *     (see the tests in apps/web/lib/db/live.test.ts), so the subscription
 *     goes quiet and a screen reads that as "still loading" forever. Here the
 *     open itself is stubbed to never settle, which produces the same thing by
 *     the shortest route.
 *  2. **The connection is closed under it.** Deleting the database from
 *     another connection is what a browser reclaiming storage looks like from
 *     inside the page: `versionchange`, then Dexie closing the connection.
 *     Nothing re-queries on its own afterwards, so the screen went on showing
 *     rows that were no longer there.
 *  3. **Another copy holds the lock.** Every read waits, and keeps waiting —
 *     see section 3.
 */
import { ensureBuild, launch, newPhone, newGroup, openGroupsList, reporter, serveExport } from "./lib/harness.mjs";

ensureBuild();

const { base, close } = await serveExport();
const browser = await launch();
const { report, finish } = reporter();

// ---- 1. a read that never answers says so ------------------------------
{
  const ctx = await newPhone(browser);
  const page = await ctx.newPage();

  // Every `indexedDB.open` returns a request that never fires an event. Dexie
  // attaches its handlers to it and waits — exactly what a blocked upgrade or
  // a wedged backing store does, and what `indexedDB.open` offers no timeout
  // against.
  await page.addInitScript(() => {
    window.indexedDB.open = () => ({
      onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null,
      result: null, error: null, readyState: "pending",
      addEventListener() {}, removeEventListener() {},
    });
  });

  await page.goto(`${base}/`);
  await page.waitForSelector(".skelrow");
  report(true, "a read that hasn't answered draws the skeleton, as before");

  // Two probes at 6s each (lib/db/live.ts), then the notice stands.
  const notice = page.locator(".stall");
  const said = await notice.waitFor({ timeout: 20000 }).then(() => true, () => false);
  report(said, "and says so rather than sitting there forever",
    said ? undefined : "no notice after 20s");
  report(
    said && ((await notice.textContent()) ?? "").includes("Try again"),
    "with something to press",
  );
  // The diagnostics screen is opened *because* the database is not answering,
  // so it must never wait on one. The first version asked Dexie for row counts
  // and sat on "Reading…" forever — a readout that hangs on the fault it is
  // there to report.
  await page.locator(".brand").dispatchEvent("contextmenu");
  await page.waitForURL(/\/diag/);
  await page.waitForSelector(".diag");
  await page.waitForTimeout(3000); // its own patience window, then it gives up
  const shown = (await page.locator(".diag").textContent()) ?? "";
  report(shown.includes("NO ANSWER"), "/diag answers even with the database wedged");
  report(shown.includes("db.open") && shown.includes("STILL RUNNING"),
    "and names what never came back",
    shown.includes("db.open") ? undefined : "no db.open span in the timeline");
  report(shown.includes("live.retry"), "and shows the watchdog firing");

  await ctx.close();
}

// ---- 2. a closed connection re-arms every read on screen ---------------
{
  const ctx = await newPhone(browser);
  const page = await ctx.newPage();
  await newGroup(page, base, { name: "Marrakech", me: "Theo", members: ["Marie"] });

  await openGroupsList(page, base);
  await page.waitForSelector(".row .rmain");
  report(true, "the groups list draws its group");

  // What a browser reclaiming storage does to the page holding it: the app's
  // connection gets `versionchange`, Dexie closes it, and the rows are gone.
  // A smoke test rather than a regression one — measured against the app with
  // the `close` handler taken out, this still passes, because re-opening an
  // absent database happens to wake the reads by itself. It is here for the
  // property, not the mechanism: a forced close must not strand the app on
  // rows that no longer exist.
  await page.evaluate(() => new Promise((resolve) => {
    const req = window.indexedDB.deleteDatabase("hajsik");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }));

  await page.getByText("No groups yet").waitFor({ timeout: 8000 }).then(
    () => report(true, "closing the connection re-reads: the list empties without a reload"),
    () => report(false, "closing the connection re-reads: the list empties without a reload",
      "still showing the group that is no longer there"),
  );
  await ctx.close();
}

// ---- 3. another copy holding the database ------------------------------
// What the owner's phone recorded: every read hanging at once, and all of them
// clearing together a minute later. A copy of the app frozen half way through
// a readwrite transaction keeps its lock, and every read on the origin queues
// behind it. No page can break another's lock, so what is held here is what
// this copy does meanwhile: show what it last read, say it is waiting, and
// come back by itself once the lock goes.
{
  const ctx = await newPhone(browser);
  const page = await ctx.newPage();
  await newGroup(page, base, { name: "Marrakech", me: "Theo", members: ["Marie"] });
  await openGroupsList(page, base);
  const back = () => page.locator(".iconbtn[aria-label='Back']").first().click();
  const settled = () => page.waitForFunction(() => !document.querySelector(".skelrow"));

  // Read both screens once, so there is an answer to remember.
  await page.locator(".grouprow").first().click();
  await page.waitForURL(/\/g\?id=/);
  await settled();
  await back();
  await page.waitForURL((url) => url.pathname === "/");
  await page.waitForSelector(".grouprow");

  // The other copy: a second tab of the app that takes a readwrite
  // transaction over every store and keeps it alive with request after request
  // — the lock a frozen page holds, without needing a way to freeze one.
  const other = await ctx.newPage();
  await other.goto(`${base}/diag`);
  await other.evaluate(() => new Promise((resolve) => {
    window.__hold = true;
    const req = window.indexedDB.open("hajsik");
    req.onsuccess = () => {
      const idb = req.result;
      const tx = idb.transaction([...idb.objectStoreNames], "readwrite");
      const store = tx.objectStore("device");
      const spin = () => { if (window.__hold) store.get("device").onsuccess = spin; };
      spin();
      resolve();
    };
  }));

  await page.bringToFront();
  await page.locator(".grouprow").first().click();
  await page.waitForURL(/\/g\?id=/);
  await page.waitForTimeout(800);
  const drawn = await page.locator(".skelrow").count() === 0;
  report(drawn, "a screen read before shows what it read while the database is held elsewhere",
    drawn ? undefined : "skeleton rows over a group this copy had already drawn");

  const said = await page.locator(".stall").waitFor({ timeout: 20000 }).then(() => true, () => false);
  report(said, "and still says the database is not answering", said ? undefined : "no notice after 20s");

  await other.evaluate(() => { window.__hold = false; });
  const cleared = await page.locator(".stall").waitFor({ state: "detached", timeout: 15000 })
    .then(() => true, () => false);
  report(cleared, "the notice takes itself down once the other copy lets go",
    cleared ? undefined : "still stalled after the lock was released");

  // /diag names the other copy, which is the line the next report needs.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.goto(`${base}/diag`);
  const copies = await page.locator(".diag").filter({ hasText: "copies:" })
    .waitFor({ timeout: 8000 }).then(async () => (await page.locator(".diag").textContent()) ?? "", () => "");
  const listed = /copies:\s+2\b/.test(copies) && copies.includes("OTHER");
  report(listed, "/diag lists the other copy",
    listed ? undefined : copies.split("\n").find((l) => l.startsWith("copies:")) ?? "no copies line");
  await ctx.close();
}

await browser.close();
await close();
finish();
