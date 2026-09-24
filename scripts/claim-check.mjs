#!/usr/bin/env node
/**
 * `pnpm claim` — a name typed into the add row is filed by its plus and by
 * nothing else.
 *
 * The gap between typed and filed (components/name-adder.tsx) is what only a
 * browser can check: a blur that must do nothing, a plus that refuses a name
 * already listed, a button that mustn't read intent from an unpressed field.
 * All of it looks perfect in jsdom.
 *
 * Both doors are walked: on `/new` the list is state and grows in the same
 * tick; on `/g/claim` it is a Dexie write that arrives when it arrives.
 *
 * Also: Create and the quick split's scan pair refuse a too-short list while
 * staying tappable. And once a phone has answered "who are you", nothing asks
 * again — not a second opening of the invite, not a launch.
 */
import { ensureBuild, serveExport, launch, newPhone, PATIENCE, reporter, settle } from "./lib/harness.mjs";

ensureBuild();
const { base, close } = await serveExport();
const browser = await launch();
const ctx = await newPhone(browser);
const page = await ctx.newPage();
const { report, finish } = reporter(page);

/** The add row. The two screens place it under different words. */
const field = (label = "Add someone") => page.getByLabel(label);
const plus = () => page.getByRole("button", { name: "Add", exact: true });

/**
 * Press a button by hand and **hold it**, as a thumb does. `locator.click()`
 * re-resolves and retries a missed press, and an instant down-up ends before
 * React re-renders — either would pass a build where press and screen
 * disagree about what's under the finger.
 */
async function press(button) {
  const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await settle(page, 150);
  await page.mouse.up();
}

const arrived = () => page.waitForURL(/\/g\?id=/, { timeout: PATIENCE }).then(() => true, () => false);

/**
 * The refusal's bloom, gone — the class going is the event "settles" means
 * below. Never a fixed pause.
 */
const flashOver = () => page.waitForFunction(
  () => document.querySelectorAll("[class*=flash]").length === 0, null, { timeout: PATIENCE });
const members = () => page.locator('[aria-label^="Remove "]').count();

// ---- the list you type -------------------------------------------------
await page.goto(`${base}/new`);
await page.locator("#g-name").fill("Trip");

// Create is tappable even with nobody on the list yet — a group of nobody
// isn't a group, but it refuses over that instead of sitting grey, the same
// mechanics as the quick split's scan pair below.
report(!await page.getByRole("button", { name: "Create" }).isDisabled(),
  "Create is tappable before anybody is on the list");
await press(page.getByRole("button", { name: "Create" }));
report(await page.locator(".rows button.row").count() === 0
  && await page.locator(".addrow[class*=flash]").count() === 1
  && await page.locator(".addrow .iconbtn[class*=flash]").count() === 0,
  "and pressing it with nobody on the list refuses, the empty field blooming");
report(await page.getByRole("button", { name: "Create" }).isDisabled(),
  "spent while that refusal is on screen");
await flashOver();
report(!await page.getByRole("button", { name: "Create" }).isDisabled(),
  "and comes back when the flash settles");

// A keystroke is the fix landing, so it ends the flash where it stands rather
// than letting it run out — and whoever was spending a button on that flash
// has to hear it, or Create never comes back.
await press(page.getByRole("button", { name: "Create" }));
report(await page.locator(".addrow[class*=flash]").count() === 1,
  "a refusal over an empty list blooms the placeholder again");
await field().type("T");
await settle(page, 60);
report(await page.locator(".addrow[class*=flash]").count() === 0
  && !await page.getByRole("button", { name: "Create" }).isDisabled(),
  "and typing ends it on the spot, Create with it — no waiting the flash out");
await field().fill("");
await settle(page, 80);

// The plus is never dead, and on an empty row it does not refuse either: the
// caret is the answer, and the next press of it files what was typed.
report(!await plus().isDisabled(), "the plus is tappable on an empty add row");
await press(plus());
await settle(page, 80);
report(await members() === 0
  && await page.locator("[class*=flash]").count() === 0
  && await page.evaluate(() => document.activeElement?.className.includes("addname")),
  "pressing it on an empty row files nothing and blooms nothing — it takes the caret");

// Enter is the keyboard's press of that same plus.
await field().fill("Theo");
await settle(page, 80);
report(await page.locator(".addrow.editing").count() === 1,
  "a name being typed puts the row in a box: it is not on the list yet");
await page.keyboard.press("Enter");
await page.waitForFunction(() => document.querySelectorAll('[aria-label^="Remove "]').length === 1);
report(await page.locator(".addrow.editing").count() === 0, "filing it takes the box away");

// The finger's route: press the plus itself.
await field().fill("Marie");
await settle(page, 80);
await press(plus());
await page.waitForFunction(() => document.querySelectorAll('[aria-label^="Remove "]').length === 2);
report(await field().inputValue() === "", "pressing the plus files the name and empties the field");

// The whole point of the change: leaving the field files nothing.
await field().fill("Sam");
await page.locator("#g-name").click();
await settle(page, 150);
report(await members() === 2 && await field().inputValue() === "Sam",
  "leaving the field files nothing — the name waits in the box");

// A name the list already holds cannot be filed at all: the plus goes dead
// rather than warning after the press.
await field().fill("Marie");
await settle(page, 80);
report(await page.locator(".addwarn").count() === 1 && !await plus().isDisabled(),
  "a name already on the list says why, the plus still tappable");
await press(plus());
report(await members() === 2
  && await page.locator(".addrow[class*=flash]").count() === 1
  && await page.locator(".addrow .iconbtn[class*=flash]").count() === 0,
  "and pressing it over that name blooms the name, filing no second Marie");
await flashOver();
report(await field().inputValue() === "Marie",
  "a refused press leaves the name where it was typed");
await field().fill("");
await settle(page, 80);

// Create is the button that leaves this screen, and everything on it is state:
// a name still in the row when the group is written is a person who was never
// in it. So it refuses rather than acting on the list without them — the plus
// blooms and Create is spent for the length of that flash.
await field().fill("Sam");
await settle(page, 80);
await press(page.getByRole("button", { name: "Create" }));
report(await page.locator(".rows button.row").count() === 0
  && await page.locator(".addrow .iconbtn[class*=flash]").count() === 1
  && await page.locator(".addrow[class*=flash]").count() === 0,
  "Create over an unfiled name is refused, and the plus blooms — not the field");
report(await page.getByRole("button", { name: "Create" }).isDisabled(),
  "and Create is spent while the refusal is on screen");
await flashOver();
report(!await page.getByRole("button", { name: "Create" }).isDisabled(),
  "and comes back when the flash settles");
await field().fill("");
await settle(page, 80);

// ---- the question it ends on -------------------------------------------
await page.getByRole("button", { name: "Create" }).click();
await page.waitForSelector(".rows button.row");
report(await page.locator(".rows button.row").count() === 2, "Create asks which of the two you are");

// Nobody is ticked and a name is being typed, and the button must ignore it:
// it answers to the list, and this name is not on the list.
await field().fill("Nadia");
await settle(page, 80);
report(await page.getByRole("button", { name: "Pick your name" }).count() === 1,
  "the button ignores a name that has only been typed");

await press(plus());
await page.waitForFunction(() => document.querySelectorAll(".rows button.row").length === 3);
report(await page.locator(".rmark svg").count() === 1
  && await page.getByRole("button", { name: "Continue as Nadia" }).count() === 1,
  "filing it here picks it: the check mark moves to the row that arrives");

// The check mark is a shape, and a shape is not a sentence: the row itself has
// to say it is the chosen one, or the only thing naming the pick is the button
// at the foot of the screen.
const picked = page.locator('.rows button.row[aria-pressed="true"]');
report(await picked.count() === 1 && (await picked.innerText()).includes("Nadia"),
  "and the row says so to a screen reader, not only in ink");

await press(page.getByRole("button", { name: "Continue as Nadia" }));
const made = await arrived();
report(made, "and the button creates the group as her");
if (!made) { await browser.close(); close(); finish(); }
const g = new URL(page.url()).searchParams.get("id");

// ---- and again where joining ends --------------------------------------
// Same component, real members: the name is a Dexie write, so the row it adds
// arrives on its own schedule rather than in the tick that asked for it.
await page.goto(`${base}/g/claim?id=${g}`);
await page.waitForSelector(".rows button.row");
report(await page.locator(".rmark svg").count() === 1, "re-opening it ticks whoever this phone is");
// "Have the app?" is an iOS tab's (pnpm homescreen); this browser's taps
// already reach wherever the app is.
report(await page.getByText("Have the app?").count() === 0, "and offers no link to paste elsewhere");

await field("Add your name").fill("Ola");
await settle(page, 150);
report(await page.locator(".rmark svg").count() === 1
  && await page.getByRole("button", { name: "Continue as Nadia" }).count() === 1,
  "typing a name moves neither the tick nor the button");

await press(plus());
await page.waitForFunction(() => document.querySelectorAll(".rows button.row").length === 4);
report(await page.getByRole("button", { name: "Continue as Ola" }).count() === 1,
  "filing it does — a Dexie write away, the tick is on her");

await press(page.getByRole("button", { name: "Continue as Ola" }));
const claimed = await arrived();
report(claimed, "and the button claims her");

if (claimed) {
  await page.goto(`${base}/g/members?id=${g}`);
  await page.waitForSelector(".rows .row");
  report(await page.getByRole("button", { name: "Remove Ola" }).count() === 0
    && await page.getByRole("button", { name: "Remove Nadia" }).count() === 1,
    "and the phone is her: her row carries the check, not a trash");
}

// ---- and never asked again ---------------------------------------------
// A link is how a group is passed around, so the same one lands on a phone
// that is already in the group — off a chat thread, weeks later. That is not
// joining: it opens the group, the way tapping the group's row would.
await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
await page.goto(`${base}/g/members?id=${g}`);
await page.getByRole("button", { name: "Copy invite link" }).first().click();
const link = await page.evaluate(() => navigator.clipboard.readText());
await page.goto(`${base}/join#${new URL(link).hash.slice(1)}`);
const reopened = await arrived();
report(reopened, "re-opening the invite link opens the group, not the question");

// ---- and what the link leaves under the group --------------------------
// A link is tapped in another app, so the browser it opens carries one history
// entry: a group that took that entry for itself had nothing underneath, and
// the device's back button left for the chat rather than climbing this app.
// `/join` gives the entry to the list and pushes the group onto it
// (apps/web/lib/launch.ts).
await page.waitForSelector(".fab");
// The entry directly under this one, not the whole stack: a page that has
// walked around first brings its own, where a tapped link brings none.
report(await page.evaluate(() => {
  const list = navigation.entries();
  const here = navigation.currentEntry.index;
  return here > 0 && new URL(list[here].url).pathname === "/g"
    && new URL(list[here - 1].url).pathname === "/";
}), "and leaves the groups list under it, for the device's back button to climb to");

// The same press from the app's own arrow, which is the bug this pair was
// written for: the document loaded on `/join`, so the list had never drawn,
// and its first arrival was read as a launch — the app walked straight back
// into the group it had just been asked to leave.
await page.locator(".iconbtn[aria-label='Back']").first().click();
await page.waitForURL((url) => url.pathname === "/", { timeout: PATIENCE });
await page.waitForTimeout(600);
report(new URL(page.url()).pathname === "/",
  "backing out of a group joined by link stays on the list");

// Back in, so what follows is about launching rather than about that press.
await page.goto(`${base}/g?id=${g}`);

// And launching the app puts you back where you were, rather than on a list
// with one thing on it (apps/web/lib/launch.ts). Which group that is, `/g`
// records in an effect once it has drawn — so the launch waits for the write,
// not merely for the URL `arrived()` saw. Without this the check raced it and
// failed about a third of the time.
await page.waitForSelector(".fab");
await page.waitForFunction((id) => new Promise((resolve) => {
  const req = indexedDB.open("hajsik");
  req.onsuccess = () => {
    const get = req.result.transaction("device").objectStore("device").get("device");
    get.onsuccess = () => resolve(get.result?.lastOpenedGroupId === id);
  };
}), g, { timeout: PATIENCE });
await page.goto(`${base}/`);
report(await arrived(), "launching the app reopens the group last open");
// Backing out of it is not a launch: the list stays put once it is asked for.
await page.locator(".iconbtn[aria-label='Back']").first().click();
await page.waitForURL((url) => url.pathname === "/", { timeout: PATIENCE });
await page.waitForTimeout(500);
report(new URL(page.url()).pathname === "/", "and Back out of it stays on the list");
// And the next launch honours where that left the app: leaving from the list
// is an instruction, so the group is not walked back into.
await page.goto(`${base}/`);
await page.waitForTimeout(800);
report(new URL(page.url()).pathname === "/", "a launch after that lands on the list, not the group");
// Opening the group again makes it the place to come back to once more.
await page.goto(`${base}/g?id=${g}`);
await page.waitForSelector(".fab");
await page.goto(`${base}/`);
report(await arrived(), "and opening it again makes the next launch reopen it");

// ---- the one screen whose act refuses instead of ignoring ---------------
// A quick split ends on the camera, and the grid a photograph opens is the
// people on the list and nobody else — so a scan taken over an unfiled name,
// or over fewer than two people to divide a bill between, is the one way to
// lose somebody off a bill they are sitting at. It refuses the press rather
// than acting on the list without them (apps/web/app/quick/page.tsx).
await page.goto(`${base}/quick`);

// The pair stays tappable with an empty list and a press refuses rather than
// opening the camera. Wait for the scan credential first: the pair is
// legitimately disabled until it has one.
await page.waitForFunction(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Upload"));
  return btn && !btn.disabled;
});
report(!await page.getByRole("button", { name: "Upload" }).isDisabled(),
  "the scan pair is tappable before anybody is on the list");
await press(page.getByRole("button", { name: "Upload" }));
report(await page.locator(".addrow[class*=flash]").count() === 1
  && await page.locator(".addrow .iconbtn[class*=flash]").count() === 0,
  "and pressing it with nobody on the list refuses, the empty field blooming");
await flashOver();

// One person is still not enough to split a bill.
await field().fill("Ana");
await field().press("Enter");
await page.waitForFunction(() => document.querySelectorAll(".rows .row").length === 2);
await press(page.getByRole("button", { name: "Upload" }));
report(await page.locator(".addrow[class*=flash]").count() === 1,
  "and still refuses with only one person on the list");
await flashOver();

await field().fill("Bo");
await field().press("Enter");
await page.waitForFunction(() => document.querySelectorAll(".rows .row").length === 3);
await field().fill("Cy");
await settle(page, 80);
await press(page.getByRole("button", { name: "Upload" }));
report(new URL(page.url()).pathname === "/quick"
  && await page.locator(".addrow .iconbtn[class*=flash]").count() === 1,
  "a scan pressed over an unfiled name is refused, and the plus blooms");
report(await page.getByRole("button", { name: "Upload" }).isDisabled(),
  "and the pair is spent while the refusal is on screen");
// Spent for the length of the flash and no longer: the retry is the same
// control, once the screen has finished saying no.
await flashOver();
report(!await page.getByRole("button", { name: "Upload" }).isDisabled()
  && await page.locator(".addrow .iconbtn[class*=flash]").count() === 0,
  "and it comes back when the flash settles");
// Filing the name is the fix, and then the same press goes through.
await press(plus());
await page.waitForFunction(() => document.querySelectorAll(".rows .row").length === 4);
report(await field().inputValue() === "" && !await page.getByRole("button", { name: "Upload" }).isDisabled(),
  "filing the name leaves the scan free to run");

await browser.close();
close();
finish();
