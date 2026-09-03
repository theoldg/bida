import { describe, expect, it } from "vitest";
import { nameKey, nameTaken } from "./names";

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
