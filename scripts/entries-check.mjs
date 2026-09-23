#!/usr/bin/env node
/**
 * `pnpm entries` — can you add, edit and read back all three kinds of entry?
 *
 * The command tests prove the arithmetic; they can't prove the *form* is
 * wired to it — a stuck Save, a control writing the wrong field, a detail
 * screen that can't find a settlement. This walks that wiring against the
 * real export.
 *
 * Run it after touching /g/entry, /g/entry/edit or lib/entry-kind.ts; it
 * builds first if it has to. ADR-0010.
 */
import { ensureBuild, serveExport, launch, newPhone, PATIENCE, reporter, pick, newGroup, openGroupsList, settle }
  from "./lib/harness.mjs";
import { PHOTO, stubScan } from "./lib/receipts.mjs";

ensureBuild();
const { base, close } = await serveExport();
const browser = await launch();
const ctx = await newPhone(browser);
const page = await ctx.newPage();
const { report, finish } = reporter(page);

/**
 * Save, then wait for the ledger to redraw from Dexie. `waitForURL` alone
 * lands on the previous render — the source of flakiness here.
 */
async function save(expectRows) {
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\?id=/);
  await page.waitForFunction(
    (n) => document.querySelectorAll(".rows a.row").length >= n, expectRows, { timeout: PATIENCE },
  );
}

/**
 * Save from an edit opened on an entry's own screen. That goes back where it
 * came from (`goUp`) rather than to the ledger, so the ledger is a navigation
 * away — and the rows still have to be waited for once we get there.
 */
async function saveAndList(expectRows) {
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\/entry\?/);
  await page.goto(`${base}/g?id=${g}`);
  await page.waitForFunction(
    (n) => document.querySelectorAll(".rows a.row").length >= n, expectRows, { timeout: PATIENCE },
  );
}

// ---- seed --------------------------------------------------------------
const g = await newGroup(page, base, {
  name: "Trip", me: "Theo", members: ["Marie", "Sam"],
  async onForm() {
    // "Other…" is the one row that hands one dialog to the next rather than
    // closing: the picker has to stay out of the prompt's way.
    await pick(page, "#g-cur", "Other");
    await page.locator(".dinput").fill("uzs");
    await page.getByRole("button", { name: "Use it" }).click();
    await settle(page, 120);
    report((await page.locator("#g-cur").innerText()).includes("UZS"),
      "an unlisted currency is typed, not scrolled to");
    await pick(page, "#g-cur", "EUR");
  },
});

// ---- an expense --------------------------------------------------------
await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.locator("input.amount").fill("9000");
await page.locator("#what").fill("Dinner");

// Currency and payer use the transfer's side dialog. A currency with no rate
// asks for one on the spot — or `rateToBase` silently sticks at "1"
// (ADR-0005).
await pick(page, '[aria-label="Currency"]', "USD");
report((await page.locator('[aria-label="Currency"]').innerText()).includes("USD"),
  "the currency picker sets the currency");
await page.waitForSelector('dialog[aria-label="USD rate"]');
report(true, "a currency the group has no rate for opens the rate dialog by itself");

// Both directions of one number, and they move together. There is no feed
// behind the static export, so this is also the path a phone with no signal
// takes: the fields are typeable and the dialog says so.
const forward = page.getByRole("textbox", { name: "Rate, USD to EUR" });
const inverse = page.getByRole("textbox", { name: "Rate, EUR to USD" });
report(await forward.count() === 1 && await inverse.count() === 1,
  "the rate dialog offers the rate both ways round");

// It opens on neither of them. Taking `data-autofocus` off the field wasn't
// enough on its own: showModal() focuses the first focusable descendant when
// the card names none, so the keyboard came up over the dialog anyway.
report(await page.evaluate(() => document.activeElement?.tagName !== "INPUT"),
  "the rate dialog opens with the caret in neither field");
await forward.fill("0.8");
await settle(page, 80);
report((await inverse.inputValue()) === "1.25", "typing one direction fills in the other");
await inverse.fill("4");
await settle(page, 80);
report((await forward.inputValue()) === "0.25", "and it works the other way too");
await forward.fill("0.8");
await settle(page, 80);
await page.getByRole("button", { name: "Save" }).last().click();
await settle(page, 200);
report(await page.locator("dialog.scrim").count() === 0, "saving the rate closes the dialog");
// What the line says is what the entry is worth in the group's currency — the
// rate itself is not printed on the form, only the badge that opens where it
// is set. 9000 USD at 0.8 is €7,200.00.
report((await page.getByLabel("Set the USD rate").innerText()).includes("7,200.00"),
  "the form's rate line values the entry at what the group now says");
report(!(await page.getByLabel("Set the USD rate").innerText()).includes("0.8"),
  "and does not print the rate itself");
report(await page.getByRole("button", { name: "set rate" }).count() === 1,
  "the badge under it says where the rate is set");

// Picked a second time, the rate is already the group's, so nothing is asked.
await pick(page, '[aria-label="Currency"]', "EUR");
report(await page.getByLabel("Set the USD rate").count() === 0,
  "picking the base currency puts the rate away");
await pick(page, '[aria-label="Currency"]', "USD");
await settle(page, 150);
report(await page.locator("dialog.scrim").count() === 0,
  "a currency the group already has a rate for asks nothing");
await pick(page, '[aria-label="Currency"]', "EUR");

await pick(page, "#paidby", "Marie");
report((await page.locator("#paidby").innerText()).includes("Marie"), "the payer picker sets the payer");
await pick(page, "#paidby", "Theo");

await save(1);
report(await page.getByText("Dinner").count() > 0, "an expense saves and lists");

// ---- an income ---------------------------------------------------------
await page.goto(`${base}/g/entry/edit?id=${g}`);
await pick(page, '[aria-label="What kind of entry"]', "Income");
await page.locator("input.amount").fill("300");
await page.locator("#what").fill("Deposit back");
report(await page.getByText("Received by").count() > 0, "an income relabels the payer picker");
report(await page.getByRole("button", { name: "Receipt" }).count() === 0, "an income offers no Receipt tab");

// On an income the payer question is "who received it", and every line of
// the screen must stay in that voice (never "didn't pay").
await page.getByRole("button", { name: "Multi-recipient" }).click();
await page.waitForURL(/\/g\/payers/);
const payerScreen = await page.locator(".rows").innerText();
report(/receive/.test(payerScreen) && !/pay/.test(payerScreen),
  "the payers screen asks an income in the income's voice");
await page.getByRole("button", { name: "Done" }).click();
await page.waitForURL(/entry\/edit/);
await save(2);
// No avatar marks it any more (ADR-0023): the verb and the sign are the two
// signals that an entry runs the other way.
report((await page.locator(".rmeta").first().innerText()).includes("received"), "the income row says received");
report((await page.locator(".ramt .big").first().innerText()).includes("+"), "the income row signs its figure");
report(await page.locator(".avatar").count() === 0, "no screen of the ledger draws a person's initials");

// ---- settling up, which is a card and not a form -----------------------
// A suggested payment opens a dialog stating the three facts; nothing in it
// can be typed into — the figures are the app's.
await page.goto(`${base}/g?id=${g}&tab=balances`);
await page.waitForSelector("button.card");
report(await page.locator("button.card").count() === 2, "settle-up suggests the payments");
await page.locator("button.card").first().click();
await page.waitForSelector("dialog.scrim .settle");
// (9000 − 300) ÷ 3. If this figure moves, an income stopped reducing the debt.
report((await page.locator(".settleamt").innerText()).includes("2,900.00"),
  "the card states the payment, income already netted off");
report(await page.locator("dialog.scrim input, dialog.scrim textarea").count() === 0,
  "nothing in the card is a field");
await page.getByRole("button", { name: "Record" }).click();
await page.waitForSelector("dialog.scrim", { state: "detached", timeout: PATIENCE });
report(await page.locator("button.card").count() < 2, "Record settles it, so the list is shorter");

// ---- the transfer form, reached the way any entry is -------------------
await page.goto(`${base}/g/entry/edit?id=${g}&kind=transfer`);
await page.waitForSelector(".transfer");
await page.locator("input.amount").fill("40");
const wasFrom = await page.locator(".tside .who").first().innerText();
await page.locator(".tswap").click();
await settle(page, 100);
report((await page.locator(".tside .who").last().innerText()) === wasFrom, "the arrow swaps the two sides");
await page.locator(".tswap").click();
await settle(page, 100);
// Either side opens the app's own picker, never a <select> (ADR-0008), and the
// person already on the other side is in it as a reversal rather than an error.
// Nothing on this form is a native picker any more — the currency and the payer
// went the same way — so the assertion is the whole screen, not the card.
report(await page.locator("select").count() === 0, "no screen of the form has a <select>");
await page.getByLabel("Who sent it").click();
await page.waitForSelector(".dlist");
const otherSide = await page.locator(".tside .who").last().innerText();
report((await page.locator(".drow-pick").filter({ hasText: otherSide }).innerText()).includes("swaps"),
  "the picker offers the other side as a swap");
await page.locator(".drow-pick").filter({ hasText: otherSide }).click();
await settle(page, 100);
report((await page.locator(".tside .who").first().innerText()) === otherSide
  && (await page.locator(".tside .who").last().innerText()) === wasFrom,
  "picking the other side swaps them");
await page.locator(".tswap").click();
await settle(page, 100);
await save(4);
await page.goto(`${base}/g?id=${g}`);
await page.waitForFunction(() => document.querySelectorAll(".rows a.row").length >= 4, null,
  { timeout: PATIENCE });
report((await page.locator(".rmeta").allInnerTexts()).some((t) => t.startsWith("Transfer")),
  "a transfer saves and lists");

// ---- and every one of them is editable ---------------------------------
await page.locator("a.row").filter({ hasText: "paid" }).first().click();
await page.waitForURL(/\/g\/entry\?/);
await page.waitForSelector(".transfer");
report((await page.locator(".topbar h3").innerText()) === "Transfer", "a transfer has a detail screen");
await page.getByRole("link", { name: "Edit" }).click();
await page.waitForURL(/entry\/edit/);
await page.waitForSelector(".transfer");
report(await page.locator('[aria-label="What kind of entry"]').count() === 1,
  "editing a transfer offers a kind control too");
await page.locator("input.amount").fill("12");
await saveAndList(3);
report((await page.locator(".ramt .big").allInnerTexts()).some((t) => t.includes("12")),
  "the transfer edit stuck");

await page.getByText("Dinner").first().click();
await page.waitForURL(/\/g\/entry\?/);
await page.getByRole("link", { name: "Edit" }).click();
await page.waitForURL(/entry\/edit/);
// The chip offers every kind, transfer included — switching to it is a
// convert rather than an edit (ADR-0010), but it isn't hidden.
await page.locator('[aria-label="What kind of entry"]').click();
await page.waitForSelector(".dlist");
// `.rtitle`, not the row: each row carries its blurb underneath as well.
const kinds = (await page.locator(".drow-pick .rtitle").allInnerTexts()).map((t) => t.trim());
report(kinds.join(",") === "Expense,Income,Transfer",
  "editing an expense offers all three kinds, transfer included");
await page.locator(".drow-pick").filter({ hasText: "Income" }).first().click();
await settle(page, 120);
await saveAndList(3);
report((await page.locator(".ramt .big").allInnerTexts()).filter((t) => t.includes("+")).length === 2,
  "an expense can become an income");

// ---- a touch hold, the way phones send one ------------------------------
// iOS never fires `contextmenu` for a touch, so the row menu times the hold
// itself (components/long-press.tsx) — and a right click proves nothing about
// that. Chromium's emulated touch is the iOS case already: no contextmenu, and
// a click as the finger lifts, which lands on the menu's veil. Android's own
// contextmenu, which arrives mid-hold either side of our timer, is sent by hand.
const cdp = await ctx.newCDPSession(page);
const ledger = page.url();
const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent",
  { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });

/**
 * Hold `row` for `ms`, drifting `drift` px; `contextmenuAt` plays Android.
 * `slideTo` keeps the finger down and walks it to a point once the menu is up,
 * which is how a phone's own long-press menus are used — and what the browser
 * would otherwise take for a scroll.
 */
async function hold(row, { ms = 700, drift = 0, contextmenuAt, slideTo } = {}) {
  const b = await row.boundingBox();
  const x = b.x + b.width / 3, y = b.y + b.height / 2;
  await touch("touchStart", x, y);
  let waited = 0;
  if (drift) {
    await settle(page, 100);
    await touch("touchMove", x, y + drift);
    waited = 100;
  }
  if (contextmenuAt !== undefined) {
    await settle(page, contextmenuAt - waited);
    await page.evaluate(([px, py]) => {
      document.elementFromPoint(px, py)?.dispatchEvent(new MouseEvent("contextmenu",
        { bubbles: true, cancelable: true, clientX: px, clientY: py }));
    }, [x, y]);
    waited = contextmenuAt;
  }
  // On the page's clock, because what this is racing is the app's own 500ms
  // timer (HOLD_MS, components/long-press.tsx): held by node's, a 700ms hold
  // on a machine that is starving the page can be over before the timer it is
  // meant to outlast has run, and a held row draws no menu.
  await settle(page, ms - waited);
  let endX = x, endY = y + drift;
  if (slideTo) {
    const to = await slideTo();
    // In steps, as a thumb moves: one jump is a gesture the browser has no
    // trouble reading, and the scroller decides on the first millimetre.
    for (let i = 1; i <= 6; i++) {
      await touch("touchMove", x + (to.x - x) * i / 6, y + (to.y - y) * i / 6);
      await settle(page, 25);
    }
    endX = to.x;
    endY = to.y;
  }
  await touch("touchEnd", endX, endY);
  // Node's, deliberately: a short touch is a tap, and the tap navigates — this
  // is the window that navigation lands in.
  await page.waitForTimeout(250);
}
const menus = () => page.locator(".rowmenu").count();
const dinnerRow = () => page.locator("a.row").filter({ hasText: "Dinner" }).first();
const closeMenu = async () => { await page.keyboard.press("Escape"); await settle(page, 100); };

await hold(dinnerRow());
report(await menus() === 1 && page.url() === ledger,
  "a held row opens its menu, and the lifting finger's click neither closes it nor navigates");
await closeMenu();

await hold(dinnerRow(), { ms: 250 });
report(await menus() === 0 && /\/g\/entry\?/.test(page.url()),
  "a short touch is still a tap: no menu, and the row opens");
await page.goto(ledger);
await page.waitForSelector(".rows a.row");

await hold(dinnerRow(), { drift: 30 });
report(await menus() === 0 && page.url() === ledger,
  "a finger that moves is a scroll: no menu when it has rested long enough");

// The finger that opened the menu can choose from it without lifting, as
// iPhone menus work. Past the pan slop the scroller can steal the touch
// (`pointercancel` instead of a lift, no click) — this catches that.
await hold(dinnerRow(), {
  slideTo: async () => {
    const b = await page.getByRole("menuitem", { name: "Delete" }).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  },
});
await settle(page, 120);
report(await menus() === 0 && await page.locator("dialog[open]").count() === 1
  && page.url() === ledger,
  "a finger that slides from the held row onto a menu item chooses it");
await page.getByRole("button", { name: "Cancel" }).click();
await settle(page, 150);

// The same slide onto the veil is not a choice, and a finger that never left
// the row it held has chosen nothing either — the card is only a few px clear
// of it, so a resting finger's drift must not land on "Delete".
await hold(dinnerRow(), { drift: 6, ms: 700 });
report(await menus() === 1 && await page.locator("dialog[open]").count() === 0,
  "a held finger that only drifts chooses nothing, and the menu stays");
await closeMenu();

// A tap on a menu item that arrives without its click. iOS sends this: the
// whole press lands on the item — pointerdown, pointerup, touchstart, touchend,
// no pointercancel — and WebKit dispatches no click at all, so the card sat
// there and the press had to be made twice. Sent by hand, because Chromium
// always follows a real tap with the click this is about not having.
async function tapWithoutClick(item, liftBy = 0) {
  const b = await item.boundingBox();
  await page.evaluate(([x, y, by]) => {
    const at = document.elementFromPoint(x, y);
    const how = (cy) => ({ bubbles: true, cancelable: true, clientX: x, clientY: cy,
      pointerId: 7, pointerType: "touch", isPrimary: true });
    at?.dispatchEvent(new PointerEvent("pointerdown", how(y)));
    // A touch's `pointerup` goes to the element its `pointerdown` went to,
    // however far the finger has travelled since — which is what makes where
    // the lift actually landed worth asking about.
    at?.dispatchEvent(new PointerEvent("pointerup", how(y + by)));
  }, [b.x + b.width / 2, b.y + b.height / 2, liftBy]);
}
const deleteItem = () => page.getByRole("menuitem", { name: "Delete" });

await hold(dinnerRow());
await tapWithoutClick(deleteItem());
await settle(page, 150);
report(await menus() === 0 && await page.locator("dialog[open]").count() === 1
  && page.url() === ledger,
  "a menu item answers a tap that brought no click, as iOS sometimes sends one");
await page.getByRole("button", { name: "Cancel" }).click();
await settle(page, 150);

// And only where the lift lands: coming down on "Delete" and sliding off it is
// how that press is called off, and no click is coming to say so either.
await hold(dinnerRow());
await tapWithoutClick(deleteItem(), 80);
await settle(page, 150);
report(await menus() === 1 && await page.locator("dialog[open]").count() === 0,
  "a finger that comes down on a menu item and lifts off it chooses nothing");
await closeMenu();

// The press every other phone sends: a whole tap, click and all — Android's
// exact sequence (lift, `touchend`, then compat `mousedown`/`mouseup`/
// `click`). Answering the lift outright lets those leftovers land on what the
// action drew: the `mousedown` hits the confirm dialog's scrim and dismisses
// it. Held above the fold, since a mid-screen item lands on the dialog's card
// and passes by luck.
async function tap(item) {
  const b = await item.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await touch("touchStart", x, y);
  await settle(page, 60);
  await touch("touchEnd", x, y);
}
await hold(dinnerRow());
// Where that `mousedown` lands is the whole of it, and it is asked rather than
// inferred from what survived: a dialog's card is centred, so a menu halfway
// down the screen drops the stray press on the card, where it does no harm and
// a check that only looked at the dialog would pass on the broken code.
await page.evaluate(() => {
  window.__stray = [];
  document.addEventListener("mousedown", (e) => window.__stray.push(
    e.target instanceof Element && e.target.closest(".rowmenu-item")
      ? "item" : `${e.target.tagName}.${String(e.target.className).split(" ")[0]}`),
    true);
});
await tap(deleteItem());
await settle(page, 250);
const stray = await page.evaluate(() => window.__stray);
report(stray.length > 0 && stray.every((w) => w === "item"),
  "the tap's own mousedown lands on the item, not on what the action drew",
  `landed on ${stray.join(", ") || "nothing — the tap sent no mousedown"}`);
report(await menus() === 0 && await page.locator("dialog[open]").count() === 1,
  "and a real tap leaves standing the dialog it opened");
await page.getByRole("button", { name: "Cancel" }).click();
await settle(page, 150);

// Straight after a hold's menu closes, the next tap is a tap — the guard that
// ate the lifting click must not eat this one.
await hold(dinnerRow());
await page.locator(".rowmenu-veil").tap();
await settle(page, 50);
await dinnerRow().tap();
await page.waitForURL(/\/g\/entry\?/, { timeout: PATIENCE }).catch(() => {});
report(/\/g\/entry\?/.test(page.url()), "a tap right after a hold's menu closes still opens the row");
await page.goto(ledger);
await page.waitForSelector(".rows a.row");

// Android sends its own contextmenu for the same hold, before our timer or
// after it. Either way: one menu, and it stays.
await hold(dinnerRow(), { contextmenuAt: 300 });
report(await menus() === 1 && page.url() === ledger,
  "an Android contextmenu before the timer opens one menu, and it stays");
await closeMenu();
await hold(dinnerRow(), { contextmenuAt: 600, ms: 900 });
report(await menus() === 1 && page.url() === ledger,
  "an Android contextmenu after the timer is swallowed, not a second open or a close");
await closeMenu();

// Keyboard: Enter on the row a hold's menu handed focus back to still opens it.
await hold(dinnerRow());
await closeMenu();
await dinnerRow().focus();
await page.keyboard.press("Enter");
await page.waitForURL(/\/g\/entry\?/, { timeout: PATIENCE }).catch(() => {});
report(/\/g\/entry\?/.test(page.url()), "Enter on a row after its hold's menu closes still opens it");
await page.goto(ledger);
await page.waitForSelector(".rows a.row");

// The same hold on the app's name is the door to /diag.
await openGroupsList(page, base);
await hold(page.locator(".brand"));
await page.waitForURL(/\/diag/, { timeout: PATIENCE }).catch(() => {});
report(/\/diag/.test(page.url()), "a hold on the app's name opens /diag");
await page.goto(ledger);
await page.waitForSelector(".rows a.row");

// ---- and a transfer's row answers a long press, as an expense's does ---
// The long press is the only way to remove a transfer from the ledger.
const transferRows = async () =>
  (await page.locator(".rmeta").allInnerTexts()).filter((t) => t.startsWith("Transfer")).length;
// Two of them reach the ledger — the card's on the balances tab wrote one and
// the form wrote the other — so this deletes one and counts, rather than
// asking whether any are left.
const before = await transferRows();
await page.locator("a.row").filter({ hasText: "paid" }).first().click({ button: "right" });
await page.waitForSelector(".rowmenu");
report(await page.getByRole("menuitem", { name: "Delete" }).count() === 1,
  "a long press on a transfer row offers to delete it");
await page.getByRole("menuitem", { name: "Delete" }).click();
await page.getByRole("button", { name: "Delete" }).click();
await page.waitForFunction((n) => document.querySelectorAll(".rows a.row").length === n, before + 1,
  { timeout: PATIENCE }).catch(() => {});
report(await transferRows() === before - 1, "and the transfer leaves the ledger");

// ---- and the log says what happened, in the app's own words ------------
await page.goto(`${base}/g/history?id=${g}`);
await page.waitForSelector(".tle");
const feed = (await page.locator(".what").allInnerTexts()).join(" | ");
for (const line of ["created this expense", "created this income", "recorded a transfer",
  "turned this into an income"]) {
  report(feed.includes(line), `history says "${line}"`);
}

// ---- the registry, and the thing it exists to do -----------------------
// A rate is the group's, not the entry's: correcting it moves every entry
// already written in that currency, which is what a per-entry frozen rate
// could never do (ADR-0005).
await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.locator("input.amount").fill("100");
await page.locator("#what").fill("Cab");
await pick(page, '[aria-label="Currency"]', "USD");
await settle(page, 150);
// The group already has a USD rate by now, so nothing is asked and the line
// under the amount reads it back: 100 USD at 0.8 is €80.00.
report((await page.getByLabel("Set the USD rate").innerText()).includes("80"),
  "the form converts at the group's rate");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForURL(/\/g\?id=/);
await page.waitForFunction(() => document.querySelectorAll(".rows a.row").length >= 3,
  null, { timeout: PATIENCE });
const cabBefore = await page.locator("a.row").filter({ hasText: "Cab" })
  .locator(".ramt .big").innerText();
report(cabBefore.includes("80"), "and banks it in the group's currency");

// Rates is in the group's top-bar menu.
await page.locator(".topbar .iconbtn[aria-label='Group menu']").click();
await page.getByRole("menuitem", { name: "Rates" }).click();
await page.waitForURL(/\/g\/rates/);
await page.waitForSelector(".rows button.row");
report((await page.locator(".rows").first().innerText()).includes("USD"),
  "the registry lists the currency the group spent in");
await page.locator("button.row").filter({ hasText: "USD" }).click();
await page.waitForSelector('dialog[aria-label="USD rate"]');
await page.getByRole("textbox", { name: "Rate, USD to EUR" }).fill("0.4");
await settle(page, 100);
report(/re-values/i.test(await page.locator(".dbody").innerText()),
  "the dialog says how much of the ledger the change moves");
await page.getByRole("button", { name: "Save" }).last().click();
await settle(page, 300);

await page.goto(`${base}/g?id=${g}`);
await page.waitForSelector(".rows a.row");
const cabAfter = await page.locator("a.row").filter({ hasText: "Cab" })
  .locator(".ramt .big").innerText();
report(cabAfter.includes("40"),
  "correcting the rate re-values an entry that was already written");

// ---- the cent the form quotes is the cent the ledger keeps -------------
// A leftover minor unit goes by `tiebreakSeed`, the entry's id. The draft
// carries the id it will be written under, so the form's cent and the
// ledger's land on the same person.
await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.locator("input.amount").fill("10");
await page.locator("#what").fill("Coffee");
await settle(page, 120);
const rows = () => page.locator(".splitrow").allInnerTexts()
  .then((all) => all.map((t) => t.replace(/\s+/g, " ").trim()).join(" | "));
const quoted = await rows();
report(/3\.34/.test(quoted) && /3\.33/.test(quoted),
  "a total that doesn't divide shows somebody the extra cent");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForURL(/\/g\?id=/);
await page.waitForFunction(() => document.querySelectorAll(".rows a.row").length >= 4,
  null, { timeout: PATIENCE });
await page.locator("a.row").filter({ hasText: "Coffee" }).click();
await page.waitForURL(/\/g\/entry\?/);
await page.getByRole("link", { name: "Edit" }).click();
await page.waitForSelector(".splitrow");
report(await rows() === quoted, "and it is the same person once the entry is written");

// ---- an entry that isn't there any more still has a name ----------------
// Half the reason to open history is an entry that has been deleted, and the
// screen looked it up in the alive-only list — so every one of them was
// titled "Transfer", the branch a missing subject fell through to.
await page.goto(`${base}/g?id=${g}`);
await page.locator("a.row").filter({ hasText: "Coffee" }).click();
await page.waitForURL(/\/g\/entry\?/);
await page.getByRole("button", { name: "Delete" }).first().click();
await page.getByRole("button", { name: "Delete" }).last().click();
await page.waitForURL(/\/g\?id=/);
await page.goto(`${base}/g/history?id=${g}`);
await page.waitForSelector(".tle");
await page.getByRole("link", { name: /Coffee/ }).first().click();
await page.waitForURL(/\/g\/history\?.*e=/);
const titled = await page.locator(".sub").first().innerText();
report(/coffee/i.test(titled), `a deleted entry's history is titled by what it was — ${titled}`);
// And back from it is the feed that linked in: the entry screen it used to name
// could only say the entry is gone.
await page.getByRole("link", { name: "Back" }).first().click();
await page.waitForURL((u) => u.pathname.startsWith("/g/history") && !u.searchParams.has("e"));
report(true, "back from a deleted entry's history is the feed, not its gone screen");

// ---- one press on Save is one entry ------------------------------------
// `ready` is about the form, not whether a press is already spending it, so
// two taps before `router.replace` could write twice (a transfer for double
// the money). Sent from the keyboard: two `click()`s wait for a settled screen
// between them; this is one press arriving twice, as a thumb does.
async function pressSaveTwice() {
  await page.getByRole("button", { name: "Save" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/g\?id=/);
}

await page.goto(`${base}/g?id=${g}`);
await page.waitForSelector(".rows a.row");
const beforeDouble = await page.locator(".rows a.row").count();

await page.goto(`${base}/g/entry/edit?id=${g}`);
await pick(page, '[aria-label="What kind of entry"]', "Transfer");
await page.waitForSelector(".transfer");
await page.locator("input.amount").fill("5");
await settle(page, 120);
await pressSaveTwice();
await page.waitForFunction(
  (n) => document.querySelectorAll(".rows a.row").length > n, beforeDouble, { timeout: PATIENCE },
);
await settle(page, 400);
report(await page.locator(".rows a.row").count() === beforeDouble + 1,
  "two presses on Save record one transfer, not two");

// The same press against a create that *is* idempotent — the draft's id makes
// the entry one entry either way — still had a revision to spare.
await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.locator("input.amount").fill("6");
await page.locator("#what").fill("Twice");
await settle(page, 120);
await pressSaveTwice();
await page.waitForFunction(
  () => [...document.querySelectorAll(".rows a.row")].some((r) => r.innerText.includes("Twice")),
  null, { timeout: PATIENCE },
);
await page.locator("a.row").filter({ hasText: "Twice" }).click();
await page.waitForURL(/\/g\/entry\?/);
await page.getByRole("link", { name: "History" }).click();
await page.waitForSelector(".tle");
const creates = (await page.locator(".what").allInnerTexts())
  .filter((t) => /created this expense/i.test(t)).length;
report(creates === 1, `one press creates the entry once — ${creates} create(s) in its history`);

// ---- an expense and a transfer really do convert into each other -------
// Not an edit: a transfer is a different entity (`Settlement`), so Save
// tombstones the old row and creates the new one (`convertToSettlement` /
// `convertToExpense`, commands/entries.ts). The words and amount survive
// either way — switched and saved, or switched back before Save.
await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.locator("input.amount").fill("7");
await page.locator("#what").fill("Convert me");
await settle(page, 120);
await pick(page, '[aria-label="What kind of entry"]', "Transfer");
await page.waitForSelector(".transfer");
report((await page.locator("#what").inputValue()) === "Convert me",
  "the words survive switching to transfer before saving");
await pick(page, '[aria-label="What kind of entry"]', "Expense");
// "7.00", not "7": opening the kind picker blurs the amount field, and a
// blurred field settles to its canonical text (`settleAmount`) — already true
// the moment the first switch opened the picker, so it reads this way on
// both sides of the round trip.
report((await page.locator("#what").inputValue()) === "Convert me"
  && (await page.locator("input.amount").inputValue()) === "7.00",
  "and switching back before saving loses nothing");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForURL(/\/g\?id=/);
await page.waitForFunction(
  () => [...document.querySelectorAll(".rows a.row")].some((r) => r.innerText.includes("Convert me")),
  null, { timeout: PATIENCE },
);

// The real conversion: this entry already has an id, so switching kind and
// saving has to delete the expense and write a fresh transfer, not edit one
// that was never a transfer to begin with.
await page.locator("a.row").filter({ hasText: "Convert me" }).click();
await page.waitForURL(/\/g\/entry\?/);
await page.getByRole("link", { name: "Edit" }).click();
await page.waitForURL(/entry\/edit/);
await pick(page, '[aria-label="What kind of entry"]', "Transfer");
await page.waitForSelector(".transfer");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForURL(/\/g\/entry\?/);
await settle(page, 150);
report((await page.locator(".topbar h3").innerText()) === "Transfer",
  "saving an expense as a transfer converts it, rather than editing it in place");
report(await page.getByText("Convert me").count() > 0,
  "and its words carried over, from the title it had as an expense to the transfer's note");

// And back, to see the round trip holds.
await page.getByRole("link", { name: "Edit" }).click();
await page.waitForURL(/entry\/edit/);
await settle(page, 120);
await pick(page, '[aria-label="What kind of entry"]', "Expense");
report((await page.locator("#what").inputValue()) === "Convert me",
  "converting back to an expense keeps the words it carried as the transfer's note");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForURL(/\/g\/entry\?/);
await settle(page, 150);
report((await page.locator(".entrytitle").innerText()) === "Convert me",
  "and the round trip lands back on an ordinary expense");

// ---- a refused Save points at the field, once -------------------------
// The flash has to end and take its class with it: the class is also what
// spends Save for the length of a refusal, so one left on a settled field is a
// button greyed for good (lib/refusal.ts).
await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.waitForSelector("input.amount");
const titleField = page.locator("#what").locator("xpath=..");
await page.getByRole("button", { name: "Save" }).click();
await settle(page, 120);
report(/flash-/.test(await titleField.getAttribute("class")),
  "a refused Save flashes the field that stopped it");
await settle(page, 900);
report(!/flash-/.test(await titleField.getAttribute("class")),
  "and the flash ends, taking its class with it");
// A number that isn't on this form has nowhere to bloom but the way to it:
// an entry in a currency the group has no rate for flashes that badge.
await pick(page, '[aria-label="Currency"]', "MAD");
await settle(page, 200);
if (await page.locator("dialog.scrim").count() > 0) {
  await page.keyboard.press("Escape");
  await settle(page, 200);
}
const rateNote = page.getByRole("button", { name: "set rate" });
await page.getByRole("button", { name: "Save" }).click();
await settle(page, 120);
report(/flash-/.test(await rateNote.getAttribute("class")),
  "a missing rate flashes the badge that opens where it is set");
await settle(page, 900);
report(!/flash-/.test(await rateNote.getAttribute("class")),
  "and that flash ends too");
await pick(page, '[aria-label="Currency"]', "EUR");

await page.locator("#what").fill("Beer");
await settle(page, 80);
await page.locator("#what").fill("");
await settle(page, 80);
report(!/flash-/.test(await titleField.getAttribute("class")),
  "emptying a field again is not a refusal");

// ---- a refused Done blooms the rows, not the words on them --------------
// The grid points at every line nobody has been given, and it points with the
// whole row — the class is on the `<tr>`, because most of a row is the columns
// of dots and the two lines of text at its left end were a refusal you had to
// be looking for (globals.css, "save refusal").
await stubScan(page, "cafe-clock");
await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.waitForSelector("input.amount");
await page.locator('input[aria-label="Upload a receipt photo"]')
  .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PHOTO });
await page.getByRole("link", { name: /(Assign|Edit) who.had.what/ }).click();
await page.waitForURL(/entry\/items/);
await page.waitForSelector(".itemtable tbody tr");
await page.getByRole("button", { name: "Done" }).click();
await settle(page, 150);
const bloomed = page.locator(".itemtable tbody tr[class*='flash-']");
report(await bloomed.count() > 0, "a refused Done blooms the rows nobody has been given");
report(await page.locator(".itemtable tbody tr[class*='flash-'] .itemname").count() > 0,
  "and the words on them go with the row they are on");
await settle(page, 900);
report(await page.locator(".itemtable tbody tr[class*='flash-']").count() === 0,
  "and that flash ends too, so Done comes back");

// ---- a screen whose draft is gone hands back -------------------------
// The entry draft lives in memory only (lib/draft.ts), so a reload, a
// back-forward restore, an old link or a killed app arrives at a later step
// with no draft. There is nothing to ask, so these screens put the person
// back on the ledger rather than render an empty frame forever.
for (const [name, path] of [["payers", "/g/payers"], ["who had what", "/g/entry/items"]]) {
  await page.goto(`${base}${path}?id=${g}`);
  const back = await page.waitForURL((url) => url.pathname === "/g", { timeout: 8000 })
    .then(() => true, () => false);
  report(back, `${name} opened without a draft goes back to the ledger`,
    back ? undefined : `left on ${new URL(page.url()).pathname} with nothing to fill it`);
}

// ---- and a link naming a group this phone hasn't got says so ----------
// `pnpm rules` holds every `/g` screen to rendering a `BadLink`; this checks
// what a grep can't — that an unknown id reaches that branch, not the blank
// frame. It says the keyless sentence, not "bad link": a bare `/g` address is
// nearly always a link missing its fragment (lib/copy.ts).
for (const path of ["/g/payers", "/g/entry/items", "/g/entry/edit", "/g/claim"]) {
  await page.goto(`${base}${path}?id=nosuchgroup`);
  const said = await page.getByText("This link is missing its password")
    .waitFor({ timeout: 8000 }).then(() => true, () => false);
  report(said, `${path} says so when the link names a group this phone hasn't got`,
    said ? undefined : "a blank that never fills");
}

await browser.close();
close();
finish();
