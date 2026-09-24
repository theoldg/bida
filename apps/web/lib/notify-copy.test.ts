import { describe, expect, it } from "vitest";
import type { GroupState, Notice, NoticeEntry } from "@bida/core";
import { money } from "./format";
import { pushMessages, pushPayload } from "./notify-copy";

/**
 * The words a notification carries (docs/notifications.md#what-is-said). Money
 * goes through `money()`, so the figures are asserted through it too — the
 * reader's locale decides the symbol, not this test.
 */

const names: Record<string, string> = { ana: "Ana", bo: "Bo", cy: "Cy" };
const name = (id: string) => names[id] ?? "Someone";
const eur = (minor: number) => money(minor, "EUR");

function dinner(over: Partial<Extract<NoticeEntry, { kind: "expense" | "income" }>> = {}): NoticeEntry {
  return {
    kind: "expense", id: "e1", description: "Dinner", amountMinor: 4200, currency: "EUR",
    baseAmountMinor: 4200, share: 1050, paid: null, ...over,
  };
}

function notice(over: Partial<Notice>): Notice {
  return { to: "bo", involved: true, by: "ana", change: "added", moved: [], baseCurrency: "EUR", ...over };
}

const payload = (...told: Notice[]) => pushPayload("g1", "Trip", told, name);

describe("pushPayload: one entry", () => {
  it("names the entry and the reader's share, and opens the entry", () => {
    expect(payload(notice({ after: dinner() }))).toEqual({
      title: "Trip",
      body: `Ana added “Dinner” · ${eur(4200)}\nYour share ${eur(1050)}`,
      url: "/g/entry?id=g1&e=e1",
      tag: "g1",
    });
  });

  it("gives a payer both halves, and an income says received", () => {
    expect(payload(notice({ after: dinner({ paid: 20000, share: 1900, amountMinor: 20000 }) })).body)
      .toBe(`Ana added “Dinner” · ${eur(20000)}\nYou paid ${eur(20000)} · your share ${eur(1900)}`);
    expect(payload(notice({ after: dinner({ kind: "income", paid: 4200, share: null }) })).body)
      .toBe(`Ana added “Dinner” · ${eur(4200)}\nYou received ${eur(4200)}`);
  });

  it("says a changed amount, and the share either side of it", () => {
    const body = payload(notice({
      change: "edited", moved: ["amount"],
      before: dinner({ amountMinor: 4000, share: 1000 }), after: dinner(),
    })).body;
    expect(body).toBe(`Ana changed the amount of “Dinner”: ${eur(4000)} → ${eur(4200)}\n`
      + `Your share ${eur(1000)} → ${eur(1050)}`);
  });

  it("reads a reader taken out of the split as a share of none", () => {
    const body = payload(notice({
      change: "edited", moved: ["split"], before: dinner(), after: dinner({ share: null }),
    })).body;
    expect(body).toBe(`Ana changed how “Dinner” is split\nYour share ${eur(1050)} → none`);
  });

  it("says edited when several fields moved", () => {
    expect(payload(notice({
      change: "edited", moved: ["amount", "payers"], before: dinner({ amountMinor: 1 }), after: dinner(),
    })).body.split("\n")[0]).toBe("Ana edited “Dinner”");
  });

  it("opens the deleted entry on a delete, where Restore is", () => {
    expect(payload(notice({ change: "deleted", before: dinner() }))).toMatchObject({
      body: `Ana deleted “Dinner” · ${eur(4200)}\nYour share was ${eur(1050)}`,
      url: "/g/entry?id=g1&e=e1",
    });
  });

  it("says restored, with the share as it is again", () => {
    expect(payload(notice({ change: "restored", after: dinner() }))).toMatchObject({
      body: `Ana restored “Dinner” · ${eur(4200)}\nYour share ${eur(1050)}`,
      url: "/g/entry?id=g1&e=e1",
    });
  });

  it("gives a phone set to everything the first line alone", () => {
    expect(payload(notice({ involved: false, after: dinner({ share: null }) })).body)
      .toBe(`Ana added “Dinner” · ${eur(4200)}`);
  });

  it("names a transfer from where the reader stands", () => {
    const t = (fromMember: string, toMember: string): NoticeEntry => ({
      kind: "transfer", id: "t1", fromMember, toMember, amountMinor: 2000, currency: "EUR", baseAmountMinor: 2000,
    });
    expect(payload(notice({ after: t("ana", "bo") })).body).toBe(`Ana paid you ${eur(2000)}`);
    expect(payload(notice({ after: t("cy", "bo") })).body).toBe(`Ana recorded that Cy paid you ${eur(2000)}`);
    expect(payload(notice({ after: t("bo", "ana") })).body).toBe(`Ana recorded that you paid them ${eur(2000)}`);
    expect(payload(notice({ after: t("bo", "cy") })).body).toBe(`Ana recorded that you paid Cy ${eur(2000)}`);
    expect(payload(notice({ change: "deleted", before: t("bo", "cy") })).body)
      .toBe(`Ana deleted “you → Cy” · ${eur(2000)}`);
  });

  it("cuts a long description, and quotes nothing for a blank one", () => {
    const long = "x".repeat(200);
    const body = payload(notice({ after: dinner({ description: long }) })).body;
    expect(body).toContain(`“${"x".repeat(59)}…”`);
    expect(payload(notice({ after: dinner({ description: "  " }) })).body.startsWith("Ana added an entry")).toBe(true);
  });

  it("tells one entry's several commands by the latest", () => {
    expect(payload(
      notice({ after: dinner() }),
      notice({ change: "edited", moved: ["amount"], before: dinner(), after: dinner({ amountMinor: 5000 }) }),
    ).body.split("\n")[0]).toBe(`Ana changed the amount of “Dinner”: ${eur(4200)} → ${eur(5000)}`);
  });
});

describe("pushPayload: several entries", () => {
  it("counts what was added and sums the shares, opening the group", () => {
    expect(payload(
      notice({ after: dinner() }),
      notice({ after: dinner({ id: "e2", share: 500 }) }),
      notice({ after: dinner({ id: "e3", share: null }) }),
    )).toMatchObject({ body: `Ana added 3 entries\nYour share ${eur(1550)}`, url: "/g?id=g1" });
  });

  it("says changed for any other mix, with no figure", () => {
    expect(payload(
      notice({ after: dinner() }),
      notice({ change: "deleted", before: dinner({ id: "e2" }) }),
    ).body).toBe("Ana changed 2 entries");
  });
});

describe("pushMessages", () => {
  const push = (endpoint: string, scope?: "all") => ({ endpoint, p256dh: "k", auth: "a", ...(scope ? { scope } : {}) });
  const state = {
    group: { id: "g1", name: "Trip", baseCurrency: "EUR", createdAt: 1 },
    members: {
      ana: { id: "ana", groupId: "g1", name: "Ana" },
      bo: { id: "bo", groupId: "g1", name: "Bo" },
      cy: { id: "cy", groupId: "g1", name: "Cy" },
    },
    identities: {
      mine: { id: "mine", groupId: "g1", memberId: "ana", claimedAt: 1, push: push("https://a") },
      bo1: { id: "bo1", groupId: "g1", memberId: "bo", claimedAt: 1, push: push("https://b1") },
      bo2: { id: "bo2", groupId: "g1", memberId: "bo", claimedAt: 1, push: push("https://b2") },
      cy: { id: "cy", groupId: "g1", memberId: "cy", claimedAt: 1, push: push("https://c", "all") },
      quiet: { id: "quiet", groupId: "g1", memberId: "cy", claimedAt: 1, push: null },
    },
  } as unknown as GroupState;

  it("reaches every subscribed device of each member told, never this phone", () => {
    const told = [notice({ after: dinner() }), notice({ to: "cy", involved: false, after: dinner({ share: null }) })];
    const out = pushMessages(state, told, "g1", "mine");
    expect(out.map((m) => m.push.endpoint)).toEqual(["https://b1", "https://b2", "https://c"]);
  });

  it("leaves out a device set to its own entries when it isn't in this one", () => {
    const withoutAll = { ...state, identities: { ...state.identities, cy: { ...state.identities.cy!, push: push("https://c") } } };
    const told = [notice({ to: "cy", involved: false, after: dinner({ share: null }) })];
    expect(pushMessages(withoutAll, told, "g1", "mine")).toEqual([]);
  });
});
