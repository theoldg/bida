#!/usr/bin/env node
/**
 * `pnpm tricount` — a Tricount link, pasted, all the way to a balanced group.
 *
 * `core/tricount.ts` is tested against the shape; this proves the *wiring* —
 * the link field, the key pulled from the paste, the WebCrypto key in the
 * request, the answer reaching the reader, and the plan building the same
 * group the CSV path builds — against the real export in a real browser.
 *
 * **The endpoint is stubbed and the rest is real**, the bargain `stubScan`
 * makes about Gemini (`lib/receipts.mjs`). Tricount's API is undocumented and
 * unreadable from a browser, so `apps/api/src/tricount.ts` is the half tried
 * by hand. Everything on this side is under test, refusals included.
 */
import { ensureBuild, launch, newPhone, PATIENCE, reporter, serveExport }
  from "./lib/harness.mjs";

ensureBuild();
const { base, close } = await serveExport();
const browser = await launch();
const ctx = await newPhone(browser);
const page = await ctx.newPage();
const { report, finish } = reporter(page);

const LINK = "https://tricount.com/tltMJWkWWUUxhUlzFm";

const member = (name) => ({ RegistryMembershipNonUser: { id: 1, alias: { display_name: name } } });

/** One entry in bunq's shape: negative is money out, all the way down. */
const entry = (value, owner, shares, extra = {}) => ({
  RegistryEntry: {
    description: extra.description ?? "Dinner",
    category: extra.category ?? "GENERAL",
    date: extra.date ?? "2026-04-11 18:22:05.000000",
    type_transaction: extra.type ?? "NORMAL",
    amount: { value, currency: "EUR" },
    membership_owned: member(owner),
    allocations: Object.entries(shares).map(([name, v]) => ({
      amount: { value: v, currency: "EUR" },
      membership: member(name),
    })),
  },
});

/**
 * A trip three people split, with one of them paid back at the end — the two
 * readings that are rules rather than recoveries, in one payload
 * (docs/data-model.md#reading-a-tricount-back).
 */
const TRICOUNT = {
  Response: [{
    Registry: {
      title: "Lisbon",
      memberships: [member("Ana"), member("Bo"), member("Cy")],
      all_registry_entry: [
        entry("-30.00", "Ana", { Ana: "-10.00", Bo: "-10.00", Cy: "-10.00" }),
        entry("-21.00", "Bo", { Ana: "-7.00", Bo: "-7.00", Cy: "-7.00" },
          { description: "Tram passes", category: "Transport" }),
        entry("-3.00", "Cy", { Ana: "-3.00" },
          { description: "Cash back", type: "BALANCE" }),
      ],
    },
  }],
};

/** Answer this page's next fetch of the endpoint, and say what was asked. */
function stub(body, status = 200) {
  const asked = [];
  page.route("**/api/tricount", (route) => {
    asked.push(JSON.parse(route.request().postData() ?? "{}"));
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return asked;
}

async function paste(link) {
  await page.goto(`${base}/import`);
  await page.locator("input.linkbox").fill(link);
  await page.getByRole("button", { name: "Fetch it" }).click();
}

/** The readout's rows, as the screen prints them. */
const facts = () => page.locator(".rows .row").evaluateAll(
  (rows) => Object.fromEntries(rows.map((r) => [
    r.querySelector(".rtitle")?.textContent ?? "",
    r.querySelector(".ramt")?.textContent ?? "",
  ])),
);

/* ---- the happy path ----------------------------------------------------- */

const asked = stub(TRICOUNT);
await paste(LINK);
await page.waitForSelector(".rows .row", { timeout: PATIENCE });

report(asked.length === 1, "the link is fetched once", `asked ${asked.length} times`);
report(asked[0]?.key === "tltMJWkWWUUxhUlzFm",
  "the key, and not the link, is what is sent", `sent ${JSON.stringify(asked[0]?.key)}`);
report(/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/.test(asked[0]?.clientKey ?? ""),
  "the handshake's key pair is made on the phone");

const found = await facts();
report(found["People"] === "3", "three people", JSON.stringify(found));
report(found["Currency"]?.includes("EUR"), "in euros", JSON.stringify(found));
report(found["Entries"] === "2", "two entries", JSON.stringify(found));
report(found["Transfers"] === "1", "the repayment came back as a transfer", JSON.stringify(found));

const name = await page.locator("#i-name").inputValue();
report(name === "Lisbon", "the tricount's own title fills the name field", `got ${name}`);

// Through the who-picker and into the group, which is where an import that
// reads right but writes wrong would finally show.
await page.getByRole("button", { name: "Create the group" }).click();
await page.locator(".rows button.row", { hasText: "Ana" }).first().click();
await page.getByRole("button", { name: "Continue as Ana" }).click();
await page.waitForURL(/\/g\?id=/, { timeout: PATIENCE });
await page.waitForFunction(() => document.querySelectorAll(".rows a.row").length >= 3,
  undefined, { timeout: PATIENCE });

const ledger = await page.locator(".rows a.row").evaluateAll(
  (rows) => rows.map((r) => r.textContent?.replace(/\s+/g, " ").trim() ?? ""));
report(ledger.length === 3, "all three landed on the ledger", ledger.join(" | "));
report(ledger.some((r) => r.includes("Tram passes")), "with their own descriptions", ledger.join(" | "));

// The balances are the point, and they are the arithmetic that has to survive
// all three readings. Ana paid 30, owes 17 across the two bills, and was
// handed 3 back: +10. Bo paid 21 and owes 17: +4. Cy owes 17, paid nothing,
// and handed 3 over: −14. They come to zero, which is the only way an import
// is ever right.
const groupId = new URL(page.url()).searchParams.get("id") ?? "";
await page.goto(`${base}/g?id=${groupId}&tab=balances`);
await page.waitForSelector(".balrow", { timeout: PATIENCE });
const owed = await page.locator(".balrow").evaluateAll(
  (rows) => rows.map((r) => [
    r.querySelector(".balname")?.textContent ?? "",
    r.querySelector(".bignum")?.textContent ?? "",
  ].join(" ")));
const has = (who, amount) => report(owed.some((r) => r.includes(who) && r.includes(amount)),
  `${who} is ${amount}`, owed.join(" | "));
has("Ana", "+€10.00");
has("Bo", "+€4.00");
has("Cy", "-€14.00");

/* ---- the refusals ------------------------------------------------------- */

/** Paste something, and read back the sentence the screen refuses with. */
async function refusedBy(link, body, status) {
  await page.unroute("**/api/tricount").catch(() => {});
  if (body !== undefined) stub(body, status);
  await paste(link);
  await page.waitForSelector("p.failure", { timeout: PATIENCE });
  return (await page.locator("p.failure").first().textContent()) ?? "";
}

report((await refusedBy("https://example.com/", undefined)).includes("isn’t a Tricount link"),
  "something that is not a link is refused before anything is sent");

report((await refusedBy(LINK, { error: "no tricount for that link" }, 404))
  .includes("doesn’t open a Tricount"),
  "a link that opens nothing says so");

report((await refusedBy(LINK, { error: "tricount would not open a session" }, 502))
  .includes("isn’t answering"),
  "tricount being down is told apart from the link being wrong");

const mixed = structuredClone(TRICOUNT);
mixed.Response[0].Registry.all_registry_entry[1].RegistryEntry.amount.currency = "USD";
report((await refusedBy(LINK, mixed)).includes("one currency at a time"),
  "two currencies are refused whole, naming both");

const broken = structuredClone(TRICOUNT);
broken.Response[0].Registry.all_registry_entry[0].RegistryEntry.amount.value = "-31.00";
const said = await refusedBy(LINK, broken);
report(said.includes("doesn’t add up") && said.includes("Dinner"),
  "an entry whose shares miss by a cent is refused, by name", said);

await browser.close();
close();
finish();
