import { describe, expect, it } from "vitest";
import { colorSeedFor, memberIdFor, nameKey, nameTaken } from "./names.js";

describe("nameKey", () => {
  it("ignores what nobody can see", () => {
    expect(nameKey("  Ana  ")).toBe("ana");
    expect(nameKey("Ana   Maria")).toBe("ana maria");
    expect(nameKey("ANA")).toBe(nameKey("ana"));
  });

  it("folds a decomposed accent onto the composed one", () => {
    expect(nameKey("Zo\u0065\u0301")).toBe(nameKey("Zo\u00e9"));
  });

  it("keeps different people different", () => {
    expect(nameKey("Ana")).not.toBe(nameKey("Anna"));
  });
});

describe("nameTaken", () => {
  const list = ["Ana", "Bob Smith"];

  it("catches the same name typed differently", () => {
    expect(nameTaken("ana", list)).toBe(true);
    expect(nameTaken(" ANA ", list)).toBe(true);
    expect(nameTaken("bob  smith", list)).toBe(true);
  });

  it("lets a new name through", () => {
    expect(nameTaken("Anna", list)).toBe(false);
    expect(nameTaken("Bob", list)).toBe(false);
  });

  it("treats blank as nobody, taken or not", () => {
    expect(nameTaken("", list)).toBe(false);
    expect(nameTaken("   ", ["", "  "])).toBe(false);
  });
});

describe("memberIdFor", () => {
  const GROUP = "0d3f7c1a-1111-4222-8333-444455556666";
  const OTHER = "9a8b7c6d-1111-4222-8333-444455556666";

  it("gives the same id to the same name, so two phones write one member", () => {
    expect(memberIdFor(GROUP, "Ana")).toBe(memberIdFor(GROUP, "Ana"));
  });

  it("reads the name the way a person does", () => {
    const ana = memberIdFor(GROUP, "Ana");
    for (const typed of ["  Ana  ", "ana", "ANA", "A na".replace(" ", ""), "Ana ".trim()]) {
      expect(memberIdFor(GROUP, typed)).toBe(ana);
    }
    expect(memberIdFor(GROUP, "Ana  Maria")).toBe(memberIdFor(GROUP, "ana maria"));
    // NFC, so a decomposed "é" is the same person as a composed one.
    expect(memberIdFor(GROUP, "Zoé")).toBe(memberIdFor(GROUP, "Zoé"));
  });

  it("keeps one group's Ana out of another's", () => {
    expect(memberIdFor(GROUP, "Ana")).not.toBe(memberIdFor(OTHER, "Ana"));
  });

  it("tells different names apart", () => {
    const ids = ["Ana", "Anna", "Ana B", "Bruno", "Théo", "Theo", "", " "]
      .map((n) => memberIdFor(GROUP, n));
    expect(new Set(ids).size).toBe(7); // "" and " " are the same blank name
  });

  it("is shaped like every other id, so nothing downstream can tell them apart", () => {
    expect(memberIdFor(GROUP, "Ana"))
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe("colorSeedFor", () => {
  const GROUP = "0d3f7c1a-1111-4222-8333-444455556666";

  it("is a hue, and the same one every time", () => {
    const seed = colorSeedFor(GROUP, "Ana");
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(360);
    expect(colorSeedFor(GROUP, " ana ")).toBe(seed);
  });

  it("is not the id, so a member's hue isn't their key in disguise", () => {
    expect(String(colorSeedFor(GROUP, "Ana"))).not.toBe(memberIdFor(GROUP, "Ana").slice(0, 3));
  });
});
