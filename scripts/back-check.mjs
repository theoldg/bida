#!/usr/bin/env node
/**
 * `pnpm back` — does the device's back button do what the back arrow does?
 *
 * The two are one behaviour by construction (`lib/back-button.ts`, ADR-0007),
 * but only in a browser: the Navigation API isn't in jsdom, and what breaks it
 * is never the predicate. It is a screen whose arrow says one thing while its
 * loading frame says another, or a press counted from the wrong entry — and a
 * miscount lands somewhere plausible, so a check that only asks "did we end up
 * on a group screen" watches the bug go past.
 *
 * So every screen with an arrow is walked to from a *launch* — a page whose
 * first history entry is the groups list, which is where the installed app
 * opens — and then pressed all the way back out, one level per press, each
 * landing named in full. Presses run consecutively on purpose: cancelling one
 * spends the activation the next would need to cancel, so the second press is
 * a different code path from the first and used to be the broken one.
 */
import { ensureBuild, serveExport, launch, newPhone, pick, reporter, newGroup }
  from "./lib/harness.mjs";

ensureBuild();
const { base, close } = await serveExport();
const browser = await launch();
const ctx = await newPhone(browser);
const page = await ctx.newPage();
const { report, finish } = reporter(page);

/**
 * The back button, as a person presses it. It resolves with nothing to wait
 * for when the app cancels the traversal and goes its own way instead, which
 * is the case under test — so the wait is ours, not Playwright's.
 */
async function pressBack(p = page) {
  await p.goBack().catch(() => {});
  await p.waitForTimeout(500);
}

/** Path and query, query order and a trailing slash discounted — `lib/nav.ts`. */
function screen(url) {
  const u = new URL(url, base);
  u.searchParams.sort();
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return u.searchParams.toString() ? `${path}?${u.searchParams}` : path;
}

const rows = (p) => p.waitForFunction(
  () => document.querySelectorAll(".rows a.row").length >= 1, null, { timeout: 8000 });

const g = await newGroup(page, base, { name: "Trip", me: "Theo", members: ["Marie", "Sam"] });

// ---- a question: the entry form asks before losing what you typed --------
// The one screen whose back is neither a link nor a plain back, so the button
// has to be taken over however the history happens to lie.
await page.getByLabel("Add an entry").click();
await page.waitForURL(/entry\/edit/);
await page.locator("input.amount").fill("40");
await page.locator("#what").fill("Dinner");
await pressBack();
report(/entry\/edit/.test(page.url()), "a back press on a typed draft stays on the form");
report(await page.getByRole("button", { name: "Discard" }).count() === 1, "and asks before discarding");
await page.getByRole("button", { name: "Discard" }).click();
await page.waitForURL(/\/g\?id=/, { timeout: 5000 }).catch(() => {});
report(/\/g\?id=/.test(page.url()), "and leaves once you say so");

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
];

for (const { at, walk, out } of scenes) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => report(false, `uncaught page error on ${at}`, e.message));
  await p.goto(`${base}/`);
  await walk(p);
  const from = screen(p.url());
  for (const [i, want] of out.entries()) {
    await pressBack(p);
    const landed = screen(p.url());
    report(landed === want,
      `${at}: press ${i + 1} of ${out.length} lands on ${want}`,
      landed === want ? undefined : `from ${from}, landed on ${landed}`);
  }
  await p.close();
}

// ---- and the ordinary press is not taken over at all --------------------
// The invariant the rest of this rests on: where the browser's own back is
// already the arrow, nothing is cancelled, so nothing can be mistimed. A
// regression here is silent — the press still works — until the day the
// cancellation lands wrong again.
{
  const p = await ctx.newPage();
  p.on("pageerror", (e) => report(false, "uncaught page error while watching for a cancel", e.message));
  await p.goto(`${base}/`);
  await intoGroup(p);
  await intoRow(p, /\/g\/entry\?/);
  // Registered after the app's, so it reports what the app decided.
  await p.evaluate(() => {
    window.__cancelled = [];
    navigation.addEventListener("navigate", (e) => {
      if (e.defaultPrevented) window.__cancelled.push(new URL(e.destination.url).pathname);
    });
  });
  await pressBack(p);
  await pressBack(p);
  const cancelled = await p.evaluate(() => window.__cancelled);
  report(cancelled.length === 0,
    "walking back out of an expense cancels nothing",
    cancelled.length === 0 ? undefined : `cancelled ${cancelled.join(", ")}`);
  await p.close();
}

await browser.close();
close();
finish();
