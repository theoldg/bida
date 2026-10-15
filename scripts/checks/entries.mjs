#!/usr/bin/env node
// Doc: docs/checks-forms.md#pnpm-verify-entries--the-form-is-wired-to-the-commands
import { onePhone, PATIENCE, pick, newGroup, openGroupsList, settle }
  from "../lib/harness.mjs";
import { PHOTO, stubScan } from "../lib/receipts.mjs";

const { base, close, browser, ctx, page, report, finish } = await onePhone();

/** `waitForURL` alone lands on the previous render. */
async function save(expectRows) {
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/g\?id=/);
  await page.waitForFunction(
    (n) => document.querySelectorAll(".rows a.row").length >= n, expectRows, { timeout: PATIENCE },
  );
}

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

// No feed and no USD entry to borrow from, so it asks — or `rateToBase` would
// silently stick at "1" (ADR-0005).
await pick(page, '[aria-label="Currency"]', "USD");
report((await page.locator('[aria-label="Currency"]').innerText()).includes("USD"),
  "the currency picker sets the currency");
await page.waitForSelector('dialog[aria-label="USD rate"]', { timeout: PATIENCE });
report(true, "a currency new to the group, with the feed out of reach, opens the rate dialog by itself");

const forward = page.getByRole("textbox", { name: "Rate, USD to EUR" });
const inverse = page.getByRole("textbox", { name: "Rate, EUR to USD" });
report(await forward.count() === 1 && await inverse.count() === 1,
  "the rate dialog offers the rate both ways round");

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
report((await page.getByLabel("Set the USD rate").innerText()).includes("7,200.00"),
  "the form's rate line values the entry at the rate just given");
report(!(await page.getByLabel("Set the USD rate").innerText()).includes("0.8"),
  "and does not print the rate itself");
report((await page.getByRole("button", { name: "USD rate", exact: true }).innerText()).includes("0.8"),
  "and the chip beside it does, as the way to where it is set");

await pick(page, '[aria-label="Currency"]', "EUR");
report(await page.getByLabel("Set the USD rate").count() === 0,
  "picking the base currency puts the rate away");
await pick(page, '[aria-label="Currency"]', "USD");
await settle(page, 150);
report(await page.locator("dialog.scrim").count() === 0
  && (await page.getByRole("button", { name: "USD rate", exact: true }).innerText()).includes("0.8"),
  "and picking USD again keeps the rate it was given, asking nothing");
await pick(page, '[aria-label="Currency"]', "EUR");

await pick(page, "#paidby", "Marie");
report((await page.locator("#paidby").innerText()).includes("Marie"), "the payer picker sets the payer");
await pick(page, "#paidby", "Theo");

await save(1);
report(await page.getByText("Dinner").count() > 0, "an expense saves and lists");

// ---- an income ---------------------------------------------------------
await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.locator(".field:has(> #paidby)").click({ position: { x: 16, y: 12 } });
const multi = page.getByRole("option", { name: "Multiple people" });
report(await multi.isDisabled() && (await multi.innerText()).includes("set the amount first"),
  "several payers wait for an amount, and say so");
await page.keyboard.press("Escape");
await settle(page, 150);
const expenseTabs = await page.locator(".splitbox .seg button").count();
await pick(page, '[aria-label="What kind of entry"]', "Income");
await page.locator("input.amount").fill("300");
await page.locator("#what").fill("Deposit back");
report(await page.getByText("Paid to").count() > 0, "an income relabels the payer picker");
report(await page.locator(".splitbox .seg button").count() === expenseTabs - 1, "an income offers no Items tab");

await page.locator("#paidby").click();
await page.getByRole("option", { name: "Multiple people" }).click();
await page.waitForURL(/\/g\/payers/);
await page.waitForFunction(() => document.querySelectorAll(".rows .row, .rows .splitrow").length > 0,
  null, { timeout: PATIENCE }).catch(() => {});
const payerScreen = await page.locator("body").innerText();
const incomeVoice = /receive/.test(payerScreen) && !/pay/.test(payerScreen);
report(incomeVoice, "the payers screen asks an income in the income's voice",
  incomeVoice ? undefined : payerScreen.match(/.*(receive|pay).*/g)?.join(" · ") ?? payerScreen.slice(0, 300));
await page.getByRole("button", { name: "Done" }).click();
await page.waitForURL(/entry\/edit/);
await save(2);
report(/^[-−]/.test(await page.locator(".ramt .big").first().innerText()), "the income row signs its figure with a minus");
report(await page.locator(".avatar").count() === 0, "no screen of the ledger draws a person's initials");

// ---- settling up, which is a card and not a form -----------------------
await page.goto(`${base}/g/balances?id=${g}`);
await page.waitForSelector("button.card");
report(await page.locator("button.card").count() === 2, "settle-up suggests the payments");
await page.locator("button.card").first().click();
await page.waitForSelector("dialog.scrim .settle");
// If this moves, an income stopped reducing the debt.
report((await page.locator(".settleamt").innerText()).includes("2,900.00"),
  "the card states the payment, income already netted off");
report(await page.locator("dialog.scrim input, dialog.scrim textarea").count() === 0,
  "nothing in the card is a field");
// What a bank app is typed with: the figure, nothing around it.
await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
await page.locator(".settleamt").click();
await page.waitForSelector(".settleamt .flipcheck.on");
report(await page.evaluate(() => navigator.clipboard.readText()) === "2900.00",
  "tapping the payment copies the bare figure");
await page.getByRole("button", { name: "Record" }).click();
await page.waitForSelector("dialog.scrim", { state: "detached", timeout: PATIENCE });
const shorter = await page.waitForFunction(() => document.querySelectorAll("button.card").length < 2,
  null, { timeout: PATIENCE }).then(() => true, () => false);
report(shorter, "Record settles it, so the list is shorter");

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
await page.locator("a.row").filter({ hasText: "→" }).first().click();
await page.waitForURL(/\/g\/entry\?/);
await page.waitForSelector(".transfer");
report((await page.locator(".topbar h3").innerText()) === "Transfer", "a transfer has a detail screen");
await page.getByRole("link", { name: "Edit", exact: true }).click();
await page.waitForURL(/entry\/edit/);
await page.waitForSelector(".transfer");
report(await page.locator('[aria-label="What kind of entry"]').count() === 0,
  "editing a transfer offers no kind control");
await page.locator("input.amount").fill("12");
await saveAndList(3);
report((await page.locator(".ramt .big").allInnerTexts()).some((t) => t.includes("12")),
  "the transfer edit stuck");

await page.getByText("Dinner").first().click();
await page.waitForURL(/\/g\/entry\?/);
await page.getByRole("link", { name: "Edit", exact: true }).click();
await page.waitForURL(/entry\/edit/);
await page.locator('[aria-label="What kind of entry"]').click();
await page.waitForSelector(".dlist");
const kinds = (await page.locator(".drow-pick .rtitle").allInnerTexts()).map((t) => t.trim());
report(kinds.join(",") === "Expense,Income",
  "editing an expense offers expense and income only");
await page.locator(".drow-pick").filter({ hasText: "Income" }).first().click();
await settle(page, 120);
await saveAndList(3);
report((await page.locator(".ramt .big").allInnerTexts()).filter((t) => /^[-−]/.test(t)).length === 2,
  "an expense can become an income");

// ---- a touch hold, the way phones send one ------------------------------
//
// iOS never fires `contextmenu` for a touch, so the row menu times the hold
// itself.
const cdp = await ctx.newCDPSession(page);
const ledger = page.url();
const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent",
  { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });

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
  // On the page's clock: on a starved machine a 700ms hold by node's can end
  // before the app's 500ms timer has run.
  await settle(page, ms - waited);
  let endX = x, endY = y + drift;
  if (slideTo) {
    const to = await slideTo();
    // In steps: the scroller decides on the first millimetre.
    for (let i = 1; i <= 6; i++) {
      await touch("touchMove", x + (to.x - x) * i / 6, y + (to.y - y) * i / 6);
      await settle(page, 25);
    }
    endX = to.x;
    endY = to.y;
  }
  await touch("touchEnd", endX, endY);
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
await page.waitForURL(/\/g\/entry\?/, { timeout: PATIENCE }).catch(() => {});
report(await menus() === 0 && /\/g\/entry\?/.test(page.url()),
  "a short touch is still a tap: no menu, and the row opens");
await page.goto(ledger);
await page.waitForSelector(".rows a.row");

await hold(dinnerRow(), { drift: 30 });
report(await menus() === 0 && page.url() === ledger,
  "a finger that moves is a scroll: no menu when it has rested long enough");

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

await hold(dinnerRow(), { drift: 6, ms: 700 });
report(await menus() === 1 && await page.locator("dialog[open]").count() === 0,
  "a held finger that only drifts chooses nothing, and the menu stays");
await closeMenu();

// iOS sends a whole press onto a menu item with no click at all.
async function tapWithoutClick(item, liftBy = 0) {
  const b = await item.boundingBox();
  await page.evaluate(([x, y, by]) => {
    const at = document.elementFromPoint(x, y);
    const how = (cy) => ({ bubbles: true, cancelable: true, clientX: x, clientY: cy,
      pointerId: 7, pointerType: "touch", isPrimary: true });
    at?.dispatchEvent(new PointerEvent("pointerdown", how(y)));
    // A touch's `pointerup` goes where its `pointerdown` went.
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

await hold(dinnerRow());
await tapWithoutClick(deleteItem(), 80);
await settle(page, 150);
report(await menus() === 1 && await page.locator("dialog[open]").count() === 0,
  "a finger that comes down on a menu item and lifts off it chooses nothing");
await closeMenu();

// Android's whole tap, click and all: answering the lift outright let the compat
// `mousedown` dismiss the confirm dialog.
async function tap(item) {
  const b = await item.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await touch("touchStart", x, y);
  await settle(page, 60);
  await touch("touchEnd", x, y);
}
await hold(dinnerRow());
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

await hold(dinnerRow());
await page.locator(".rowmenu-veil").tap();
await settle(page, 50);
await dinnerRow().tap();
await page.waitForURL(/\/g\/entry\?/, { timeout: PATIENCE }).catch(() => {});
report(/\/g\/entry\?/.test(page.url()), "a tap right after a hold's menu closes still opens the row");
await page.goto(ledger);
await page.waitForSelector(".rows a.row");

await hold(dinnerRow(), { contextmenuAt: 300 });
report(await menus() === 1 && page.url() === ledger,
  "an Android contextmenu before the timer opens one menu, and it stays");
await closeMenu();
await hold(dinnerRow(), { contextmenuAt: 600, ms: 900 });
report(await menus() === 1 && page.url() === ledger,
  "an Android contextmenu after the timer is swallowed, not a second open or a close");
await closeMenu();

await hold(dinnerRow());
await closeMenu();
await dinnerRow().focus();
await page.keyboard.press("Enter");
await page.waitForURL(/\/g\/entry\?/, { timeout: PATIENCE }).catch(() => {});
report(/\/g\/entry\?/.test(page.url()), "Enter on a row after its hold's menu closes still opens it");
await page.goto(ledger);
await page.waitForSelector(".rows a.row");

await openGroupsList(page, base);
await hold(page.locator(".brand"));
await page.waitForURL(/\/diag/, { timeout: PATIENCE }).catch(() => {});
report(/\/diag/.test(page.url()), "a hold on the app's name opens /diag");
await page.goto(ledger);
await page.waitForSelector(".rows a.row");

// ---- and a transfer's row answers a long press, as an expense's does ---
const transferRows = async () =>
  (await page.locator(".rmeta").allInnerTexts()).filter((t) => t.startsWith("Transfer")).length;
const before = await transferRows();
await page.locator("a.row").filter({ hasText: "→" }).first().click({ button: "right" });
await page.waitForSelector(".rowmenu");
report(await page.getByRole("menuitem", { name: "Delete" }).count() === 1,
  "a long press on a transfer row offers to delete it");
await page.getByRole("menuitem", { name: "Delete" }).click();
await page.getByRole("button", { name: "Delete" }).click();
await page.waitForFunction((n) => [...document.querySelectorAll(".rmeta")]
  .filter((m) => m.innerText.startsWith("Transfer")).length === n, before - 1,
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

// ---- an entry's own rate -----------------------------------------------
await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.locator("input.amount").fill("100");
await page.locator("#what").fill("Cab");
await pick(page, '[aria-label="Currency"]', "USD");
await page.waitForSelector('dialog[aria-label="USD rate"]', { timeout: PATIENCE });
await page.getByRole("textbox", { name: "Rate, USD to EUR" }).fill("0.8");
await page.getByRole("button", { name: "Save" }).last().click();
await settle(page, 200);
report((await page.getByLabel("Set the USD rate").innerText()).includes("80"),
  "the form converts at the rate it was given");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForURL(/\/g\?id=/);
await page.waitForFunction(() => document.querySelectorAll(".rows a.row").length >= 3,
  null, { timeout: PATIENCE });
const amountOf = (title) => page.locator("a.row").filter({ hasText: title }).locator(".ramt .big").innerText();
report((await amountOf("Cab")).includes("80"), "and banks it in the group's currency");

await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.locator("input.amount").fill("10");
await page.locator("#what").fill("Tram");
await pick(page, '[aria-label="Currency"]', "USD");
await page.getByRole("button", { name: "USD rate", exact: true }).filter({ hasText: "0.8" })
  .waitFor({ timeout: PATIENCE }).catch(() => {});
await settle(page, 150);
report(await page.locator("dialog.scrim").count() === 0
  && (await page.getByLabel("Set the USD rate").innerText()).includes("8.00"),
  "the next entry in the currency borrows the group's last rate, asking nothing");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForURL(/\/g\?id=/);
await page.waitForFunction(() => document.querySelectorAll(".rows a.row").length >= 4,
  null, { timeout: PATIENCE });

await page.locator("a.row").filter({ hasText: "Cab" }).click();
await page.waitForURL(/\/g\/entry\?/);
await page.getByRole("button", { name: "USD rate", exact: true }).click();
await page.waitForSelector('dialog[aria-label="USD rate"]');
await page.getByRole("textbox", { name: "Rate, USD to EUR" }).fill("0.4");
await page.getByRole("button", { name: "Save" }).last().click();
await settle(page, 300);
await page.goto(`${base}/g?id=${g}`);
await page.waitForSelector(".rows a.row");
report((await amountOf("Cab")).includes("40") && (await amountOf("Tram")).includes("8.00"),
  "correcting one entry's rate moves that entry and no other");

await page.locator(".topbar .iconbtn[aria-label='Group menu']").click();
await page.locator(".rowmenu-item").first().waitFor();
report(await page.getByRole("menuitem", { name: "Rates" }).count() === 0,
  "the group menu has no Rates screen");
await page.keyboard.press("Escape");
await settle(page, 200);

// ---- the cent the form quotes is the cent the ledger keeps -------------
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
await page.getByRole("link", { name: "Edit", exact: true }).click();
await page.waitForSelector(".splitrow");
report(await rows() === quoted, "and it is the same person once the entry is written");

// ---- a deleted entry keeps its screen, and Restore is on it -------------
await page.goto(`${base}/g?id=${g}`);
await page.locator("a.row").filter({ hasText: "Coffee" }).click();
await page.waitForURL(/\/g\/entry\?/);
await page.getByRole("button", { name: "Delete" }).first().click();
await page.evaluate(() => {
  const w = /** @type {any} */ (window);
  w.__band = false;
  // What was added, not what is left: the band can come and go in one task.
  new MutationObserver((records) => {
    for (const r of records) {
      const nodes = r.type === "characterData" ? [r.target] : [...r.addedNodes];
      if (nodes.some((n) => (n instanceof Element && (n.matches(".deletedband") || n.querySelector(".deletedband")))
        || /^Deleted /.test(n.textContent ?? ""))) w.__band = true;
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
});
await page.getByRole("button", { name: "Delete" }).last().click();
await page.waitForURL(/\/g\?id=/);
report(true, "deleting from the entry screen goes back to the ledger");
report(!await page.evaluate(() => /** @type {any} */ (window).__band),
  "and the deleted screen never flashes on the way");
await page.goto(`${base}/g/history?id=${g}`);
await page.waitForSelector(".tle");
await page.getByRole("link", { name: /Coffee · deleted/ }).first().click();
await page.waitForURL(/\/g\/entry\?/);
await page.getByRole("button", { name: "Restore" }).waitFor({ timeout: PATIENCE });
report(await page.getByRole("link", { name: "Edit", exact: true }).count() === 0
  && await page.getByRole("button", { name: "Delete" }).count() === 0,
  "a deleted entry's screen offers Restore, and neither Edit nor Delete");
await page.locator(".deletedband").getByText(/Deleted by \S/).waitFor({ timeout: PATIENCE });
const band = await page.locator(".deletedband").innerText();
report(/Deleted by \S/.test(band), `and says at its head who deleted it — ${band.replace(/\s+/g, " ")}`);
report(/^Deleted /.test(await page.locator(".topbar h3").innerText()), "and its bar says it is deleted");
await page.locator("a.entryhistbody").click();
await page.waitForURL(/\/g\/history\?.*e=/);
const titled = await page.locator(".sub").first().innerText();
report(/coffee/i.test(titled), `a deleted entry's history is titled by what it was — ${titled}`);
await page.getByRole("link", { name: "Back" }).first().click();
await page.waitForURL(/\/g\/entry\?/);
await page.getByRole("button", { name: "Restore" }).click();
await page.getByRole("link", { name: "Edit", exact: true }).waitFor({ timeout: PATIENCE });
report(true, "Restore turns the screen back into the live entry, in place");
await page.goto(`${base}/g/history?id=${g}`);
await page.waitForSelector(".tle");
report((await page.locator(".what").allInnerTexts()).some((t) => /restored this expense/.test(t)),
  "and history says it was restored");
await page.goto(`${base}/g?id=${g}`);
await page.locator("a.row").filter({ hasText: "Coffee" }).first().waitFor({ timeout: PATIENCE });
report(true, "and it is back on the ledger");

// ---- one press on Save is one entry ------------------------------------
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
await page.locator("a.entryhistbody").waitFor({ timeout: PATIENCE });
report(await page.locator(".entryhist").evaluate((line) => {
  const box = line.getBoundingClientRect();
  return !document.elementFromPoint(box.right - 4, box.top + box.height / 2)?.closest("a");
}), "the history line is a link on its words alone, not the rest of the dock");
await page.locator("a.entryhistbody").click();
await page.waitForSelector(".tle");
const creates = (await page.locator(".what").allInnerTexts())
  .filter((t) => /created this expense/i.test(t)).length;
report(creates === 1, `one press creates the entry once — ${creates} create(s) in its history`);

// ---- a new entry keeps its words across a change of kind ----------------
await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.locator("input.amount").fill("7");
await page.locator("#what").fill("Convert me");
await settle(page, 120);
await pick(page, '[aria-label="What kind of entry"]', "Transfer");
await page.waitForSelector(".transfer");
report((await page.locator("#what").inputValue()) === "Convert me",
  "the words survive switching to transfer before saving");
await pick(page, '[aria-label="What kind of entry"]', "Expense");
// "7.00", not "7": the kind picker blurs the amount field, which settles.
report((await page.locator("#what").inputValue()) === "Convert me"
  && (await page.locator("input.amount").inputValue()) === "7.00",
  "and switching back before saving loses nothing");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForURL(/\/g\?id=/);
await page.waitForFunction(
  () => [...document.querySelectorAll(".rows a.row")].some((r) => r.innerText.includes("Convert me")),
  null, { timeout: PATIENCE },
);

// ---- a refused Save points at the field, once -------------------------
await page.goto(`${base}/g/entry/edit?id=${g}`);
await page.waitForSelector("input.amount");
const titleField = page.locator("#what").locator("xpath=..");
await page.getByRole("button", { name: "Save" }).click();
await settle(page, 120);
report(/flash-/.test(await titleField.getAttribute("class")),
  "a refused Save flashes the field that stopped it");
const dockSays = () => page.locator(".whodock .splitfoot.bad").allInnerTexts();
report((await dockSays()).join("|") === "Set the amount",
  "and says one thing missing in the Save dock", (await dockSays()).join("|"));
await settle(page, 900);
report(!/flash-/.test(await titleField.getAttribute("class")),
  "and the flash ends, taking its class with it");
await pick(page, '[aria-label="Currency"]', "MAD");
await page.locator("dialog.scrim").waitFor({ timeout: PATIENCE }).catch(() => {});
if (await page.locator("dialog.scrim").count() > 0) {
  await page.keyboard.press("Escape");
  await settle(page, 200);
}
const rateNote = page.getByRole("button", { name: "MAD rate", exact: true });
await page.locator("input.amount").fill("5");
await page.locator("#what").fill("Rate only");
const fullSize = page.viewportSize();
await page.setViewportSize({ width: fullSize.width, height: 420 });
await settle(page, 120);
const scrolledTo = await page.locator(".scroll").evaluate((el) => {
  el.scrollTop = el.scrollHeight; return el.scrollTop;
});
// The refusal travels, then flashes: recorded, so the wait is for both.
await page.evaluate(() => {
  window.__flashed = false;
  new MutationObserver((_, watch) => {
    if (document.querySelector(".flash-a, .flash-b")) { window.__flashed = true; watch.disconnect(); }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
});
await page.getByRole("button", { name: "Save" }).click();
await page.waitForFunction(() => window.__flashed && !document.querySelector(".flash-a, .flash-b"),
  null, { timeout: PATIENCE }).catch(() => {});
const landed = await page.locator(".scroll").evaluate((el) => el.scrollTop);
await page.setViewportSize(fullSize);
await settle(page, 120);
report(scrolledTo > 0 && landed === 0,
  "a refusal over a missing rate goes to the top of the form", `${scrolledTo}px → ${landed}px`);
await page.getByRole("button", { name: "Save" }).click();
await settle(page, 120);
report(/flash-/.test(await rateNote.getAttribute("class")),
  "a missing rate flashes the chip that opens where it is set");
report((await dockSays()).join("|") === "Set the MAD rate",
  "and the dock says the rate over the empty fields", (await dockSays()).join("|"));
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

await page.locator("input.amount").fill("40");
await page.locator("#what").fill("Split check");
const rowHeights = {};
for (const tab of ["Evenly", "As amounts", "As parts", "As amounts"]) {
  await page.getByRole("button", { name: tab }).click();
  await settle(page, 80);
  rowHeights[tab] = await page.locator(".splitrow").evaluateAll((rows) =>
    [...new Set(rows.map((r) => r.getBoundingClientRect().height.toFixed(2)))].join("/"));
}
report(new Set(Object.values(rowHeights)).size === 1 && !Object.values(rowHeights)[0].includes("/"),
  "every split tab draws its rows at one height", JSON.stringify(rowHeights));
const firstShare = page.locator("input[aria-label$=\"’s amount\"]").first();
const firstRow = page.locator(".splitrow").first();
const seeded = await firstShare.inputValue();
report(seeded === "" && /\d/.test(await firstShare.getAttribute("placeholder"))
  && await page.locator(".splitrow.rest").count() === await page.locator(".splitrow").count(),
  "Evenly opens As amounts as everyone sharing the rest, each share a placeholder",
  `"${seeded}" / ${await firstShare.getAttribute("placeholder")}`);
await settle(page, 120);
report(await page.locator(".whodock .splitfoot").count() === 0,
  "a rest that adds up leaves the Save dock silent");
await firstShare.fill("999");
await settle(page, 120);
const splitLine = page.locator(".whodock .splitfoot.bad");
report(await splitLine.count() === 1,
  "a split that doesn't add up is said in the Save dock");
const shortRows = page.locator(".splitrow.rest.short input");
report(await shortRows.count() > 0
  && (await shortRows.evaluateAll((els) => els.map((el) => el.placeholder))).every((p) => p === "?"),
  "over the total, the rows sharing the rest show a ?");
await page.locator(".scroll").evaluate((el) => { el.scrollTop = el.scrollHeight / 3; });
await settle(page, 80);
const air = await page.evaluate(() => Math.round(
  document.querySelector(".whodock .splitfoot").getBoundingClientRect().top
  - document.querySelector(".scroll").getBoundingClientRect().bottom));
report(air >= 8, "the docked line keeps its margin from a half-scrolled form", `${air}px`);
await page.getByRole("button", { name: "Save" }).click();
await settle(page, 120);
report(/flash-/.test(await splitLine.getAttribute("class"))
  && await page.getByRole("button", { name: "Save" }).isDisabled(),
  "a refused Save flashes it and spends the button");
await settle(page, 900);
await page.getByRole("button", { name: "Evenly" }).click();
await settle(page, 120);
report(await splitLine.count() === 0, "and a tab that adds up takes it away");
await page.getByRole("button", { name: "As amounts" }).click();
const firstName = page.locator(".splitrow > button").first();
const tapMark = async () => {
  const box = await firstName.boundingBox();
  await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
};
await tapMark();
await settle(page, 80);
const cleared = await firstShare.inputValue();
const outRow = !/\binrow\b/.test(await firstRow.getAttribute("class"));
await tapMark();
await settle(page, 80);
const sharing = /\brest\b/.test(await firstRow.getAttribute("class"));
const share = await firstShare.getAttribute("placeholder");
report(cleared === "" && outRow && sharing && await firstShare.inputValue() === "" && /\d/.test(share),
  "the cross beside a figure clears it and leaves the row out, and the plus brings it back sharing",
  `out: ${outRow}, then sharing ${share}`);
await page.getByRole("button", { name: "Evenly" }).click();

await page.locator("#paidby").click();
await page.getByRole("option", { name: "Multiple people" }).click();
await page.waitForURL(/\/g\/payers/);
await page.waitForSelector(".rows .row input");
const payerFields = page.locator(".rows .row input");
await payerFields.nth(0).fill("25");
for (let i = 1; i < await payerFields.count(); i++) await payerFields.nth(i).fill("");
await page.getByRole("button", { name: "Done" }).click();
await settle(page, 120);
report(/flash-/.test(await page.locator(".whodock .splitfoot.bad").getAttribute("class"))
  && /\/g\/payers/.test(page.url()),
  "a Done on payers that don't add up flashes the verdict and stays");
await settle(page, 900);
for (let i = 0; i < await payerFields.count(); i++) await payerFields.nth(i).fill(["25", "15"][i] ?? "");
await page.getByRole("button", { name: "Done" }).click();
await page.waitForURL(/entry\/edit/);
await page.waitForSelector("input.amount");
await page.locator("input.amount").fill("50");
await settle(page, 120);
const payerLine = page.locator(".whodock .splitfoot.bad");
report(await payerLine.count() === 1 && /unaccounted/.test(await payerLine.innerText()),
  "payers that no longer add up are said in the Save dock", await payerLine.allInnerTexts().then((t) => t.join(" · ")));
await page.getByRole("button", { name: "Save" }).click();
await settle(page, 120);
report(/flash-/.test(await payerLine.getAttribute("class")), "and a refused Save flashes them");
await settle(page, 900);
await page.locator("input.amount").fill("");
await page.locator("#what").fill("");

// ---- a refused Done blooms the rows, not the words on them --------------
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
for (const [name, path] of [["payers", "/g/payers"], ["who had what", "/g/entry/items"]]) {
  await page.goto(`${base}${path}?id=${g}`);
  const back = await page.waitForURL((url) => url.pathname === "/g", { timeout: 8000 })
    .then(() => true, () => false);
  report(back, `${name} opened without a draft goes back to the ledger`,
    back ? undefined : `left on ${new URL(page.url()).pathname} with nothing to fill it`);
}

// ---- and a link naming a group this phone hasn't got says so ----------
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
