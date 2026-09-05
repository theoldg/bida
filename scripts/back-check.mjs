#!/usr/bin/env node
/**
 * `pnpm back` — does the device's back button do what the back arrow does?
 *
 * The two are one behaviour by construction (`lib/back-button.ts`, ADR-0007),
 * but only in a browser: the Navigation API isn't in jsdom, and what breaks it
 * is never the predicate. It is a press counted from the wrong entry, or a
 * screen whose arrow says one thing while its loading frame says another — and
 * a miscount lands somewhere plausible, so a check that only asks "did we end
 * up on a group screen" watches the bug go past.
 *
 * Two halves, because the button has two jobs and they need opposite things:
 *
 * - **Most presses are left alone.** Only descending pushes, so the parent is
 *   the entry right behind you and the browser's own back is already the
 *   arrow. What that needs is the *stack* to be the path from the groups list
 *   down to here — so every screen with an arrow is walked to from a launch
 *   and pressed all the way back out, one level per press, each landing named
 *   in full.
 * - **A few presses are taken over**, and those are the ones with something to
 *   go wrong. A screen opened from a shared link has no parent behind it; a
 *   form with something typed asks instead of leaving. Both are driven here
 *   directly, and presses run consecutively on purpose: cancelling one spends
 *   the activation the next would need, so the second press is a different code
 *   path from the first and used to be the broken one.
 */
import { ensureBuild, serveExport, launch, newPhone, pick, reporter, newGroup }
  from "./lib/harness.mjs";

ensureBuild();
const { base, close } = await serveExport();
const browser = await launch();
const ctx = await newPhone(browser);
// Every navigation the app cancelled, so cancelling can be counted rather than
// merely tolerated. Injected before every document, not evaluated into one: the
// shared-link scenes navigate with `goto`, which wipes anything evaluated in.
// That puts this listener *before* the app's, so what it decided is read a
// task later. Not a microtask: the checkpoint runs after *each* listener, so a
// microtask queued here still lands before the app has had its say.
await ctx.addInitScript(`
  window.__cancelled = [];
  navigation.addEventListener("navigate", (e) => {
    const to = new URL(e.destination.url).pathname;
    setTimeout(() => { if (e.defaultPrevented) window.__cancelled.push(to); }, 0);
  });
`);
const page = await ctx.newPage();
const { report, finish } = reporter(page);

/**
 * Wait until the app has finished answering a press — rather than sleeping for
 * long enough and hoping.
 *
 * A press can end three ways, and this covers all of them without knowing
 * which happened: the browser traverses (a `navigation.transition` to wait
 * out), the app cancels and navigates in its place (a second transition, one
 * task later), or the app cancels and stays (nothing at all). Next also writes
 * its own `replaceState` a millisecond after every traversal. So: no
 * transition in flight, and the URL unmoved for three consecutive polls.
 *
 * The blind 500ms sleep this replaces was both the check's runtime — 23 presses
 * of it — and, we think, its flake: it could sample mid-answer, and it pressed
 * again while the last answer was still settling.
 */
async function settle(p) {
  await p.evaluate(() => { window.__url = null; window.__still = 0; });
  await p.waitForFunction(() => {
    if (window.navigation?.transition) { window.__still = 0; return false; }
    if (window.__url !== location.href) { window.__url = location.href; window.__still = 0; return false; }
    return ++window.__still >= 3;
  }, null, { polling: 25, timeout: 8000 });
}

/**
 * The back button, as a person presses it. `goBack` resolves with nothing to
 * wait for when the app cancels the traversal and goes its own way instead,
 * which is half of what is under test — so the wait is `settle`'s, not
 * Playwright's.
 */
async function pressBack(p = page) {
  await p.goBack().catch(() => {});
  await settle(p);
}

/** Path and query, query order and a trailing slash discounted — `lib/nav.ts`. */
function screen(url) {
  const u = new URL(url, base);
  u.searchParams.sort();
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return u.searchParams.toString() ? `${path}?${u.searchParams}` : path;
}

/** Every navigation the app cancelled since the last read, in order. */
const cancelled = (p) => p.evaluate(() => window.__cancelled?.splice(0) ?? []);

const rows = (p) => p.waitForFunction(
  () => document.querySelectorAll(".rows a.row").length >= 1, null, { timeout: 8000 });

const g = await newGroup(page, base, { name: "Trip", me: "Theo", members: ["Marie", "Sam"] });

// ---- a question: the entry form asks before losing what you typed --------
// The one screen whose back is neither a link nor a plain back. It is also the
// only place the button is cancelled and *nothing* follows — the dialog is the
// whole of the answer — so a press that leaks through lands on the ledger with
// the draft silently gone.
await page.getByLabel("Add an entry").click();
await page.waitForURL(/entry\/edit/);
await page.locator("input.amount").fill("40");
await page.locator("#what").fill("Dinner");
await pressBack();
report(/entry\/edit/.test(page.url()), "a back press on a typed draft stays on the form");
report(await page.getByRole("button", { name: "Discard" }).count() === 1, "and asks before discarding");
const asked = await cancelled(page);
report(asked.length === 1, "and the press is cancelled outright, with nothing following it",
  `cancelled ${asked.length}: ${asked.join(", ") || "none"}`);
await page.getByRole("button", { name: "Discard" }).click();
await page.waitForURL(/\/g\?id=/, { timeout: 5000 }).catch(() => {});
report(/\/g\?id=/.test(page.url()), "and leaves once you say so");

// The other side of the same guard: nothing typed, nothing to ask about, so
// the press is not taken over at all. It used to be — every press on this
// screen was cancelled and re-navigated, typed or not, which is the path that
// had to be timed right and now doesn't exist.
await page.getByLabel("Add an entry").click();
await page.waitForURL(/entry\/edit/);
await pressBack();
report(screen(page.url()) === `/g?id=${g}`, "a back press on an untouched form just leaves");
const spent = await cancelled(page);
report(spent.length === 0, "and is not cancelled on the way",
  spent.length === 0 ? undefined : `cancelled ${spent.join(", ")}`);

// Something in the ledger to open, and a second entry so the feed has depth.
await page.getByLabel("Add an entry").click();
await page.waitForURL(/entry\/edit/);
await page.locator("input.amount").fill("40");
await page.locator("#what").fill("Dinner");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForURL(/\/g\?id=/);
await rows(page);

// One entry in a currency of its own: it is what the rate registry refuses to
// remove, and the list in that refusal is one of the three ways into an entry
// from beside it rather than from above.
await page.getByLabel("Add an entry").click();
await page.waitForURL(/entry\/edit/);
await page.locator("input.amount").fill("20");
await page.locator("#what").fill("Taxi");
await pick(page, '[aria-label="Currency"]', "USD");
await page.getByRole("textbox", { name: /^Rate, USD to / }).fill("0.8");
await page.getByRole("button", { name: "Save" }).last().click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: "Save" }).click();
await page.waitForURL(/\/g\?id=/);
await rows(page);

// ---- one level per press, from every screen that has an arrow -----------
const group = `/g?id=${g}`;
const feed = `/g/history?id=${g}`;
const people = `/g/members?id=${g}`;
const rates = `/g/rates?id=${g}`;

/** Tap the first row of a list and wait for where it goes. */
const intoRow = async (p, until) => { await rows(p); await p.locator(".rows a.row").first().click(); await p.waitForURL(until); };
const intoGroup = (p) => intoRow(p, /\/g\?id=/);

const scenes = [
  {
    at: "the ledger",
    walk: intoGroup,
    out: ["/"],
  },
  {
    at: "an expense opened from the ledger",
    walk: async (p) => { await intoGroup(p); await intoRow(p, /\/g\/entry\?/); },
    out: [group, "/"],
  },
  {
    // The feed is where the entry was opened, so the feed is what back owes
    // you: the link says so (`via=history`) and the arrow reads it.
    at: "an entry opened from the history feed",
    walk: async (p) => {
      await intoGroup(p);
      await p.getByLabel("History").click();
      await p.waitForURL(/\/g\/history/);
      await p.locator("a").filter({ hasText: "Dinner" }).first().click();
      await p.waitForURL(/\/g\/entry\?/);
    },
    out: [feed, group, "/"],
  },
  {
    // The other two side doors: a list of what still names a person, and one
    // of what is still written in a currency. Landing on the group would lose
    // the list you were working through.
    at: "an entry opened from the can't-remove-person dialog",
    walk: async (p) => {
      await intoGroup(p);
      await p.getByLabel("People").click();
      await p.waitForURL(/\/g\/members/);
      await p.getByLabel("Remove Marie").click();
      await p.locator(".dlist .drow-pick").first().click();
      await p.waitForURL(/\/g\/entry\?/);
    },
    out: [people, group, "/"],
  },
  {
    at: "an entry opened from the can't-remove-currency dialog",
    walk: async (p) => {
      await intoGroup(p);
      await p.getByLabel("Rates").click();
      await p.waitForURL(/\/g\/rates/);
      await p.locator(".rows button.row").filter({ hasText: "USD" }).first().click();
      await p.getByRole("button", { name: "Remove" }).click();
      await p.locator(".dlist .drow-pick").first().click();
      await p.waitForURL(/\/g\/entry\?/);
    },
    out: [rates, group, "/"],
  },
  {
    at: "the history feed",
    walk: async (p) => {
      await intoGroup(p);
      await p.getByLabel("History").click();
      await p.waitForURL(/\/g\/history/);
    },
    out: [group, "/"],
  },
  {
    at: "Rates",
    walk: async (p) => {
      await intoGroup(p);
      await p.getByLabel("Rates").click();
      await p.waitForURL(/\/g\/rates/);
    },
    out: [group, "/"],
  },
  {
    at: "People",
    walk: async (p) => {
      await intoGroup(p);
      await p.getByLabel("People").click();
      await p.waitForURL(/\/g\/members/);
    },
    out: [group, "/"],
  },
  {
    // The tabs `replace`, so the balances tab sits in the ledger's own entry:
    // its arrow names the groups list and one press has to get there.
    at: "the balances tab",
    walk: async (p) => {
      await intoGroup(p);
      await p.getByRole("link", { name: "Balances" }).click();
      await p.waitForURL(/tab=balances/);
    },
    out: ["/"],
  },
  {
    // The one press in the app that *is* taken over, and the reason the rest of
    // this file exists. "The whole group" is a plain push sideways: from one
    // entry's own history to the feed for all of them. The feed's arrow names
    // the group, which is three entries back, not one — so the press is
    // cancelled and `goUp` traverses to the entry it names. Counting back to
    // it instead is what used to overshoot, and a miscount lands somewhere
    // plausible.
    at: "the whole-group feed reached from one entry's history",
    walk: async (p) => {
      await intoGroup(p);
      await intoRow(p, /\/g\/entry\?/);
      await p.getByLabel("History").click();
      await p.waitForURL(/\/g\/history\?.*e=/);
      await p.getByRole("link", { name: "The whole group" }).click();
      await p.waitForURL((u) => /\/g\/history/.test(u.pathname + u.search) && !u.searchParams.get("e"));
    },
    out: [group, "/"],
    takesOver: 1,
  },
];

for (const { at, walk, out, takesOver = 0 } of scenes) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => report(false, `uncaught page error on ${at}`, e.message));
  await p.goto(`${base}/`);
  await walk(p);
  await cancelled(p);
  const from = screen(p.url());
  for (const [i, want] of out.entries()) {
    await pressBack(p);
    const landed = screen(p.url());
    report(landed === want,
      `${at}: press ${i + 1} of ${out.length} lands on ${want}`,
      landed === want ? undefined : `from ${from}, landed on ${landed}`);
  }
  // Cancelling is the risk, so it is counted, not merely tolerated: a screen
  // that starts cancelling presses it used to let through is a regression even
  // while every landing is still right.
  const took = await cancelled(p);
  report(took.length === takesOver, `${at}: ${takesOver} of ${out.length} presses taken over`,
    took.length === takesOver ? undefined : `cancelled ${took.length}: ${took.join(", ") || "none"}`);
  await p.close();
}

await browser.close();
close();
finish();
