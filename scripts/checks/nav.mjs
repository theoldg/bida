#!/usr/bin/env node
/**
 * `pnpm verify nav` — where the back arrow goes, and the shape of the history it
 * leaves behind: traverse to a parent on the stack, replace into one that isn't
 * (ADR-0007). So every assertion reads `navigation.entries()`, never `location`.
 */
import { ensureBuild, launch, newPhone, openDemo, openGroupsList, reporter, serveExport, settle, untilDevice }
  from "../lib/harness.mjs";

ensureBuild();
const { base, close } = await serveExport();
const browser = await launch();
const { report, finish } = reporter();

/**
 * Installed in the page, so the wait for a shape and its reading are one
 * function.
 */
const SHAPE = () => {
  window.__shape = () => {
    const screen = (url) => {
      const u = new URL(url);
      return (u.pathname + u.search)
        .replace(/(\?|&)id=[^&]*/, "$1id=G").replace(/(\?|&)e=[^&]*/, "$1e=E")
        .replace(/(\?|&)title=[^&]*/, "").replace(/\/$/, "") || "/";
    };
    const nav = window.navigation;
    return { i: nav.currentEntry?.index, urls: nav.entries().map((e) => screen(e.url)) };
  };
};

const stack = (page) => page.evaluate(() => window.__shape());

async function is(page, label, want) {
  const wanted = JSON.stringify(want);
  await page.waitForFunction((w) => JSON.stringify(window.__shape()) === w, wanted).catch(() => {});
  const got = JSON.stringify(await stack(page));
  report(got === wanted, label, got === wanted ? "" : `wanted ${wanted}\n        got    ${got}`);
}

const arrow = (page) => page.locator(".topbar .iconbtn").first().click();

/** Nothing on it, so `/` is the groups list rather than a resumed group. */
async function phone() {
  const ctx = await newPhone(browser);
  await ctx.addInitScript(SHAPE);
  return ctx;
}

const ctx = await phone();

// ---- 1. the walk in from the groups list -------------------------------
// The group made here is reused by every later section: building one is the most
// expensive step.
const group = await (async () => {
  const page = await ctx.newPage();
  await page.goto(`${base}/`);
  await page.waitForSelector(".starttile");
  await page.locator("a[href='/new']").click();
  await page.waitForURL(/\/new/);
  await page.locator("#g-name").fill("Trip");
  for (const m of ["Theo", "Marie"]) {
    await page.getByLabel("Add someone").fill(m);
    await page.keyboard.press("Enter");
  }
  await page.getByRole("button", { name: "Create" }).click();
  await page.locator("button.row").filter({ hasText: "Theo" }).first().click();
  await page.getByRole("button", { name: "Continue as Theo" }).click();
  await page.waitForURL(/\/g\?id=/);
  await is(page, "/new replaces itself with the ledger, over the list", { i: 1, urls: ["/", "/g?id=G"] });

  await page.locator("a[href^='/g/balances']").first().click();
  await is(page, "the balance card pushes balances", { i: 2, urls: ["/", "/g?id=G", "/g/balances?id=G"] });
  await arrow(page);
  await is(page, "balances' arrow goes back to the ledger", { i: 1, urls: ["/", "/g?id=G", "/g/balances?id=G"] });
  const id = new URL(page.url()).searchParams.get("id");
  await page.close();
  return id;
})();

async function onLedger() {
  const page = await ctx.newPage();
  await page.goto(`${base}/g?id=${group}`);
  await page.waitForSelector(".fab, .empty, .rows");
  return page;
}

// ---- 2. an entry, and the arrow that climbs out of it -------------------
{
  const page = await onLedger();
  await page.locator(".fab").last().click();
  await page.waitForURL(/\/g\/entry\/edit/);
  await page.locator("#what").fill("Dinner");
  await page.locator(".amountfield input, input.amount").first().fill("20");
  await is(page, "the form is pushed onto the ledger", { i: 1, urls: ["/g?id=G", "/g/entry/edit?id=G"] });
  await page.getByRole("button", { name: "Save" }).click();
  await is(page, "Save goes back to the ledger, and leaves the form forward",
    { i: 0, urls: ["/g?id=G", "/g/entry/edit?id=G"] });

  await page.waitForSelector(".rows a.row");
  await page.locator(".rows a.row").first().click();
  await page.waitForURL(/\/g\/entry\?/);
  await arrow(page);
  await is(page, "an entry's arrow goes back to the ledger",
    { i: 0, urls: ["/g?id=G", "/g/entry?id=G&e=E"] });
  await page.close();
}

// ---- 3. the tip jar: a screen the form is opened from -------------------
// Saving lands on the balances the tip screen was reached from, past both.
{
  const page = await ctx.newPage();
  await openGroupsList(page, base);
  await page.locator(".grouprow").first().click();
  await page.waitForURL(/\/g\?id=/);
  await page.locator("a[href^='/g/balances']").first().click();
  await page.waitForURL(/\/g\/balances/);
  await page.locator(".fab").last().click();
  await page.waitForURL(/\/g\/tip/);
  await page.locator("a[href*='/g/entry/edit']").first().click();
  await page.waitForURL(/\/g\/entry\/edit/);
  await page.locator(".amountfield input, input.amount").first().fill("5");
  const before = await stack(page);
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\/balances/);
  const after = await stack(page);
  const landed = after.urls[after.i];
  report(landed === "/g/balances?id=G", "the tip's Save lands on balances",
    landed === "/g/balances?id=G" ? "" : `on ${landed}`);
  report(after.i === before.i - 2, "past the tip screen as well as the form",
    after.i === before.i - 2 ? "" : `i went ${before.i} -> ${after.i}`);
  const kept = JSON.stringify(after.urls) === JSON.stringify(before.urls);
  report(kept, "and leaves both of them forward rather than erasing them",
    kept ? "" : `${JSON.stringify(before.urls)}\n        became ${JSON.stringify(after.urls)}`);
  await page.close();
}

// ---- 4. a cold load, with nothing behind it -----------------------------
// A shared link never visited the parent: the arrow puts it in this screen's
// place.
{
  const cold = await onLedger();
  await is(cold, "a cold ledger has nothing behind it", { i: 0, urls: ["/g?id=G"] });
  await arrow(cold);
  await is(cold, "its arrow swaps the list in rather than going back", { i: 0, urls: ["/"] });
  await cold.close();
}

// ---- 4b. the press at the bottom of the stack ---------------------------
// A `CloseWatcher` takes the press that would close the app. Playwright cannot
// press Android's button, but Escape is a close request too.
{
  // Closed only once the ledger has said it is the one to resume: §4 left on the
  // list, and the write undoing that lands after the rows are drawn.
  const opened = await onLedger();
  await untilDevice(opened, (d) => d?.lastOpenedGroupId === group && !d.leftOnList);
  await opened.close();
  const page = await ctx.newPage();
  await page.goto(`${base}/`);
  await page.waitForURL(/\/g\?id=/);
  await page.waitForSelector(".fab, .empty, .rows");
  await is(page, "a launch reopens the group with nothing under it", { i: 0, urls: ["/g?id=G"] });
  await page.keyboard.press("Escape");
  await is(page, "and its first close request climbs to the list, untouched", { i: 0, urls: ["/"] });
  await page.waitForSelector(".starttile");
  await page.close();

  const cold = await onLedger();
  await cold.locator("a[href^='/g/balances']").first().click();
  await is(cold, "one screen up from a cold ledger", { i: 1, urls: ["/g?id=G", "/g/balances?id=G"] });
  await cold.keyboard.press("Escape");
  await settle(cold, 300);
  await is(cold, "the watcher is the bottom screen's alone", { i: 1, urls: ["/g?id=G", "/g/balances?id=G"] });
  await cold.goBack();
  await is(cold, "back down on it", { i: 0, urls: ["/g?id=G", "/g/balances?id=G"] });
  await cold.keyboard.press("Escape");
  await is(cold, "it holds one again", { i: 0, urls: ["/", "/g/balances?id=G"] });
  await cold.close();
}

// ---- 5. the quick split -------------------------------------------------
{
  const page = await (await phone()).newPage();
  await page.goto(`${base}/`);
  await page.waitForSelector(".starttile");
  await page.locator("a[href='/quick']").click();
  await page.waitForURL(/\/quick$/);
  await is(page, "/quick is pushed onto the list", { i: 1, urls: ["/", "/quick"] });
  await arrow(page);
  await is(page, "and its arrow goes back to the list", { i: 0, urls: ["/", "/quick"] });
  await page.close();
}

// ---- 6. the press guard, on a screen holding typed work -----------------
{
  const page = await onLedger();
  await page.locator(".fab").last().click();
  await page.waitForURL(/\/g\/entry\/edit/);
  await page.locator("#what").fill("Half-typed");
  const before = await stack(page);
  // `page.goBack()` is reported `userInitiated` and `cancelable`; a keyboard
  // shortcut fires no `navigate` in headless Chromium and passes by pressing
  // nothing. Not awaited: the press is meant to be cancelled.
  void page.goBack().catch(() => {});
  const asked = await page.waitForSelector(".scrim").then(() => true, () => false);
  report(asked, "a back press on a half-typed form asks before leaving");
  // The one wait with no condition: the assertion is that nothing moved.
  await settle(page, 300);
  const after = await stack(page);
  const stayed = after.i === before.i && /entry\/edit/.test(after.urls[after.i] ?? "");
  report(stayed, "and the press is cancelled outright — the screen stays put",
    stayed ? "" : `moved to ${after.urls[after.i]}`);
  await page.close();
}

// ---- 7. the dialog the platform shuts by itself ------------------------
// A close request the browser won't let us refuse fires no `cancel`; unheard,
// `/new` believes its dialog is up and back goes dead (components/dialog.tsx).
{
  const page = await (await phone()).newPage();
  await page.goto(`${base}/`);
  await page.waitForSelector(".starttile");
  await page.locator("a[href='/new']").click();
  await page.waitForURL(/\/new/);
  await page.locator("#g-name").fill("Trip");
  void page.goBack().catch(() => {});
  await page.waitForSelector(".scrim").catch(() => {});
  report(await page.locator(".scrim[open]").count() === 1, "a back press on a half-typed /new asks too");

  // What the close watcher does, done directly: closed, with no `cancel`.
  await page.evaluate(() => document.querySelector("dialog.scrim")?.close());
  await page.waitForFunction(() => !document.querySelector("dialog.scrim")).catch(() => {});
  const heard = await page.locator("dialog.scrim").count() === 0;
  report(heard, "the screen hears the platform shut it, and stops drawing it",
    heard ? "" : "the element is still mounted — the screen thinks its dialog is up");

  void page.goBack().catch(() => {});
  const again = await page.waitForSelector(".scrim[open]").then(() => true, () => false);
  report(again, "so the next press asks again rather than being swallowed");
  await settle(page, 200);
  const here = await stack(page);
  report(/\/new/.test(here.urls[here.i] ?? ""), "and the typed group is still on screen");
  await page.close();
}

// ---- 8. and the recorder has the taps it was given ---------------------
// "It refused a bunch of taps" has many causes, so /diag carries the sequence
// (lib/press-trace.ts).
{
  const page = await (await phone()).newPage();
  await page.goto(`${base}/`);
  await page.waitForSelector(".starttile");
  await page.locator("a[href='/new']").click();
  await page.waitForURL(/\/new/);
  await page.locator("#g-name").fill("Trip");
  void page.goBack().catch(() => {});
  await page.waitForSelector(".scrim[open]").catch(() => {});

  for (let i = 0; i < 8; i++) await page.locator(".scrim .dtitle").click();
  await page.locator(".scrim .drow .btn-s").click();
  await page.waitForFunction(() => !document.querySelector("dialog.scrim")).catch(() => {});

  await page.goto(`${base}/diag`);
  await page.waitForSelector("pre");
  const head = (await page.locator("pre").innerText()).split("---- this page")[0];
  const line = head.split("\n").find((l) => l.includes("dialog  ")) ?? "";
  report(/menus and dialogs, newest first:/.test(head),
    "a dialog's presses ride in the head of /diag, where a cut-short paste keeps them");
  report(/pointerdown@card/.test(line), "and a tap is named by the part it landed on",
    line || "no dialog trace at all");
  report(/card \d+-\d+ visible \d+-\d+ of \d+/.test(line),
    "with where the card was against what was on screen, which no event says", line);

  // A run of refused taps must not push the one that worked off the end.
  report(/…\d+ more…/.test(line), "a long run drops out of the middle, counted", line);
  report(/open guards=0 Discard/.test(line), "the head still holds the opening", line);
  report(/click@btn0/.test(line) && /gone dismissed/.test(line),
    "and the tail still holds the tap that ended it", line);
  await page.close();
}

// ---- 9. the traversal that never came, and the act happening anyway -------
// `history.go` can be called and not move, on Android. The card must come down
// and the act happen anyway (lib/nav.ts). The stuck moment between is
// deliberately not asserted: a read after a pause is a bet on the repair's
// window.
{
  const page = await (await phone()).newPage();
  await page.goto(`${base}/`);
  await page.waitForSelector(".starttile");
  await page.locator("a[href='/new']").click();
  await page.waitForURL(/\/new/);
  await page.locator("#g-name").fill("Trip");
  void page.goBack().catch(() => {});
  await page.waitForSelector(".scrim[open]");

  await page.evaluate(() => { window.history.go = () => {}; });
  await page.locator(".scrim .drow button").nth(1).click();
  await page.waitForFunction(() => !document.querySelector("dialog.scrim")).catch(() => {});
  report(await page.locator("dialog.scrim").count() === 0,
    "an act that cannot travel still takes its dialog down with it");

  await page.waitForURL((url) => new URL(url).pathname === "/", { timeout: 4000 })
    .then(() => {}, () => {});
  const after = await stack(page);
  const landed = new URL(after.urls[after.i] ?? "http://x/nowhere", base).pathname === "/";
  report(landed, "and then the parent takes its place, so Discard is not dead after all",
    landed ? "" : `still at ${after.urls[after.i]}`);
  await page.close();
}

// ---- 10. Discard on a form one entry above the ledger --------------------
// Android doesn't deliver the traversal after a refused press, so `goBack` reads
// the destination off the stack. The draft must not go before the going.
{
  const page = await onLedger();
  await page.locator(".fab").last().click();
  await page.waitForURL(/\/g\/entry\/edit/);
  await page.locator("#what").fill("Half-typed");
  await is(page, "the form sits one entry above a cold ledger",
    { i: 1, urls: ["/g?id=G", "/g/entry/edit?id=G"] });

  void page.goBack().catch(() => {});
  await page.waitForSelector(".scrim[open]");

  // Recorded, not sampled: the repair is quicker than a round trip to ask.
  await page.evaluate(() => {
    window.__blanked = false;
    const look = () => {
      const bar = document.querySelector(".topbar h3");
      if (bar?.textContent === "New" && !document.querySelector("#what")) window.__blanked = true;
    };
    new MutationObserver(look).observe(document.body, { childList: true, subtree: true });
  });

  await page.evaluate(() => { window.history.back = () => {}; });
  await page.locator(".scrim .drow button").nth(1).click();
  await page.waitForURL((url) => new URL(url).pathname === "/g", { timeout: 4000 })
    .then(() => {}, () => {});
  const after = await stack(page);
  const landed = /^\/g\?/.test(after.urls[after.i] ?? "");
  report(landed, "Discard leaves a form the traversal cannot carry out of",
    landed ? "" : `still at ${after.urls[after.i]}`);
  report(await page.evaluate(() => window.__blanked) === false,
    "and never draws the blank \"New\" that made this read as a fresh entry");
  await page.close();
}

// ---- 11. Discard puts the browser's guard down too ----------------------
// A form loaded as a page of its own goes back across a document, which the
// browser's own "Leave site?" guards: answered Discard, it must not ask again.
for (const [name, from, open, type] of [
  ["the entry form", `/g?id=${group}`, `/g/entry/edit?id=${group}`,
    (page) => page.locator("#what").click().then(() => page.keyboard.type("Half"))],
  ["/new", "/", "/new", (page) => page.locator("#g-name").click().then(() => page.keyboard.type("Trip"))],
]) {
  const page = await ctx.newPage();
  await page.goto(`${base}${from}`);
  await page.waitForSelector(".fab, .empty, .rows, .starttile, .grouprow, a[href='/new']");
  await page.goto(`${base}${open}`);
  await type(page);
  const asked = [];
  page.on("dialog", (dialog) => { asked.push(dialog.type()); void dialog.accept(); });
  await arrow(page);
  await page.waitForSelector(".scrim[open]");
  await page.locator(".scrim .drow button").nth(1).click();
  await page.waitForURL((url) => !url.pathname.startsWith(open.split("?")[0]), { timeout: 4000 })
    .then(() => {}, () => {});
  report(asked.length === 0 && !new URL(page.url()).pathname.startsWith(open.split("?")[0]),
    `Discard on ${name}, a page of its own, leaves without the browser asking again`,
    `${asked.join(" ")} at ${page.url()}`);
  await page.close();
}

// ---- 4. the ledger comes back where it was left, only on the way back ----
// A row straddling the top edge must come back to the pixel by the arrow, the
// device's back and Save; a tap in from the list opens at the top.
{
  const short = await newPhone(browser, { viewport: { width: 390, height: 480 } });
  const page = await short.newPage();
  await openDemo(page, base);
  await page.waitForSelector(".rows a.row");
  await page.waitForSelector(".skelveil", { state: "detached" });

  const place = () => page.evaluate(() => {
    const box = document.querySelector(".scroll");
    const edge = box.getBoundingClientRect().top;
    const row = [...box.querySelectorAll("[data-entry]")].find((el) => el.getBoundingClientRect().bottom > edge);
    return { top: box.scrollTop, entry: row?.dataset.entry, offset: Math.round(row.getBoundingClientRect().top - edge) };
  });
  const scrollTo = async (y) => {
    await page.evaluate((to) => { document.querySelector(".scroll").scrollTop = to; }, y);
    await settle(page, 100);
  };
  // Honest: `settle` ends a frame after the restore's window, on the page's clock.
  const back = async () => {
    await page.waitForURL(/\/g\?id=/).catch(async () => {
      throw new Error(`never back on the ledger: ${JSON.stringify(await stack(page))}`);
    });
    await page.waitForSelector(".rows a.row");
    await settle(page, 1400);
  };

  await scrollTo(await page.evaluate(() => {
    const box = document.querySelector(".scroll");
    const rows = box.querySelectorAll("[data-entry]");
    const third = rows[2].getBoundingClientRect();
    return box.scrollTop + third.top - box.getBoundingClientRect().top + third.height / 2;
  }));
  const left = await place();
  // Playwright scrolls a cut row into view before clicking, which a thumb never
  // does.
  const tap = () => page.locator(".rows a.row").nth(4).click();
  report(left.top > 0 && left.offset < 0, "the ledger scrolls to a row cut by its top edge", JSON.stringify(left));

  await tap();
  await page.waitForURL(/\/g\/entry\?/);
  await arrow(page);
  await back();
  let got = await place();
  report(got.entry === left.entry && got.offset === left.offset,
    "an entry's arrow comes back to the same row, to the pixel", `left ${JSON.stringify(left)} got ${JSON.stringify(got)}`);

  await tap();
  await page.waitForURL(/\/g\/entry\?/);
  await page.goBack();
  await back();
  got = await place();
  report(got.entry === left.entry && got.offset === left.offset,
    "and so does the device's back", `left ${JSON.stringify(left)} got ${JSON.stringify(got)}`);

  await page.locator(".fab").last().click();
  await page.waitForURL(/\/g\/entry\/edit/);
  await page.locator("input.amount").fill("12");
  await page.locator("#what").fill("Droid oil");
  // Watched frame by frame from inside the page: the live query can draw the
  // saved row a commit after the rest, and that frame is the one that counts.
  await page.evaluate(() => {
    window.__landed = null;
    const look = () => {
      const box = document.querySelector(".scroll");
      if (box && location.pathname === "/g" && document.querySelector(".lslot.saved")) {
        const edge = box.getBoundingClientRect().top;
        const row = [...box.querySelectorAll("[data-entry]")].find((el) => el.getBoundingClientRect().bottom > edge);
        window.__landed = { top: box.scrollTop, entry: row?.dataset.entry, offset: Math.round(row.getBoundingClientRect().top - edge) };
        requestAnimationFrame(roll);
        return;
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
    window.__released = false;
    const release = () => {
      if (document.querySelector(".lslot.saved.released")) window.__released = true;
      else requestAnimationFrame(release);
    };
    requestAnimationFrame(release);
    window.__rolled = null;
    const roll = () => {
      const box = document.querySelector(".scroll");
      if (document.querySelector(".rolling:not(.held)")) window.__rolled = { top: box.scrollTop };
      else requestAnimationFrame(roll);
    };
  });
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForFunction(() => window.__landed !== null);
  got = await page.evaluate(() => window.__landed);
  report(got.entry === left.entry && got.offset === left.offset && got.top > left.top,
    "and Save, with a new row above it, keeps the same row rather than the same offset",
    `left ${JSON.stringify(left)} got ${JSON.stringify(got)}`);
  await page.waitForFunction(() => window.__released).catch(() => {});
  const shown = await page.evaluate(() => {
    const scroll = document.querySelector(".scroll");
    const box = scroll.getBoundingClientRect();
    const row = [...document.querySelectorAll(".rtitle")].find((t) => t.textContent === "Droid oil")?.closest(".row");
    const r = row?.getBoundingClientRect();
    const inView = r ? r.top >= box.top - 1 && r.bottom <= box.bottom + 1 : false;
    return { inView, top: scroll.scrollTop, banner: document.querySelector(".mysum") !== null };
  });
  report(shown.inView && shown.top === 0 && shown.banner,
    "and then glides to the very top, the row it saved in view under the banner",
    JSON.stringify(shown));
  // The roll starts after the glide ends, a frame or more later on a busy machine.
  await page.waitForFunction(() => window.__rolled !== null).catch(() => {});
  const rolled = await page.evaluate(() => window.__rolled);
  report(rolled?.top === 0, "and the figure rolls only once it is there", JSON.stringify(rolled));

  await arrow(page);
  await page.waitForSelector(".grouprow");
  await page.locator(".grouprow").first().click();
  await page.waitForURL(/\/g\?id=/);
  await page.waitForSelector(".rows a.row");
  await settle(page, 300);
  report((await place()).top === 0, "while a tap in from the list opens at the top");
  await short.close();
}

// ---- 11. a press the moment a screen opens, on a slow phone ---------------
// The URL moves in the commit that mounts the screen; its back handler must be
// there in the same commit, or the screen underneath takes the press and climbs
// to *its* parent (lib/back-button.ts). A throttled CPU is what opens the gap.
{
  const slow = await phone();
  const page = await slow.newPage();
  await (await slow.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await openDemo(page, base);
  await page.waitForSelector(".rows a.row");
  const landed = [];
  for (let i = 0; i < 3; i++) {
    await page.locator(".rows a.row").nth(1).click();
    await page.waitForURL(/\/g\/entry\?/);
    void page.goBack().catch(() => {});
    await page.waitForURL((url) => url.pathname !== "/g/entry").catch(() => {});
    landed.push(new URL(page.url()).pathname);
    if (landed.at(-1) !== "/g") break;
    await page.waitForSelector(".rows a.row");
  }
  report(landed.every((p) => p === "/g"),
    "a back press as an entry opens goes to the ledger, not past it", landed.join(" "));
  await slow.close();
}

// ---- 12. Delete on an entry's own screen -----------------------------------
// It goes up to whoever linked in. Back on the ledger, the row is drawn where it
// was and folds out on screen with the roll, from the place it was left.
{
  const short = await newPhone(browser, { viewport: { width: 390, height: 520 } });
  await short.addInitScript(SHAPE);
  const page = await short.newPage();
  await openDemo(page, base);
  await page.waitForSelector(".rows a.row");
  const remove = async () => {
    await page.waitForURL(/\/g\/entry\?/);
    await page.locator(".topbar button[aria-label='Delete']").click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  };
  // Luke's income: it moves his figure.
  const row = page.locator(".rows a.row").filter({ hasText: "landspeeder" });
  const id = await row.getAttribute("data-entry");
  await page.evaluate(() => { document.querySelector(".scroll").scrollTop = 120; });
  await settle(page, 100);
  const left = await page.evaluate(() => document.querySelector(".scroll").scrollTop);
  await row.click();
  await page.evaluate((entry) => {
    window.__del = { first: null, leaving: false, rolled: false, tops: new Set() };
    const look = () => {
      const box = document.querySelector(".scroll");
      if (location.pathname === "/g" && document.querySelector(".rows a.row")) {
        window.__del.first ??= !!box.querySelector(`[data-entry="${entry}"]`);
        if (box.querySelector(".lslot[data-leaving]")) window.__del.leaving = true;
        if (document.querySelector(".rolling:not(.held)")) window.__del.rolled = true;
        window.__del.tops.add(box.scrollTop);
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
    // As on a phone, the delete's live read lands before the traversal does,
    // so the ledger opens on a read without the row. Inside `SWALLOWED_MS`.
    const go = history.go.bind(history);
    history.go = (n) => { setTimeout(() => go(n), 80); };
  }, id);
  await remove();
  await page.waitForFunction(() => window.__del.leaving && window.__del.rolled).catch(() => {});
  const seen = await page.evaluate(() => ({ ...window.__del, tops: [...window.__del.tops] }));
  report(seen.first && seen.leaving, "Delete on an entry opened off the ledger folds its row out there", JSON.stringify(seen));
  report(seen.rolled, "and rolls the figure");
  report(seen.tops.length === 1 && seen.tops[0] === left, "without moving the list", `left ${left} got ${seen.tops}`);
  await is(page, "and goes back to the ledger, not over it", { i: 0, urls: ["/g?id=G", "/g/entry?id=G&e=E"] });

  await page.locator(".topbar a[href*='/g/history']").first().click();
  await page.waitForURL(/\/g\/history/);
  await page.locator("a[href*='/g/entry']").filter({ hasText: "cantina" }).first().click();
  await remove();
  await is(page, "and on one opened off history, back to history",
    { i: 1, urls: ["/g?id=G", "/g/history?id=G", "/g/entry?id=G&e=E&via=history"] });
  await short.close();
}

await browser.close();
close();
finish();
