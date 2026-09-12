import { describe, expect, it } from "vitest";
import { resumeGroupId } from "./launch";

const GROUP = { id: "g1" };

describe("resumeGroupId", () => {
  it("reopens the group this phone last had open", () => {
    expect(resumeGroupId({ lastOpenedGroupId: "g1" }, GROUP)).toBe("g1");
  });

  it("has nowhere to go on a phone that has never opened one", () => {
    expect(resumeGroupId({}, undefined)).toBeUndefined();
    expect(resumeGroupId(undefined, undefined)).toBeUndefined();
  });

  it("stays on the list when the remembered group is gone", () => {
    // Forgetting a group leaves the id behind — nothing clears it — so the
    // missing row is what has to say no.
    expect(resumeGroupId({ lastOpenedGroupId: "g1" }, undefined)).toBeUndefined();
  });

  it("stays on the list when the group was forgotten on this phone", () => {
    expect(resumeGroupId({ lastOpenedGroupId: "g1", leftGroups: ["g1"] }, GROUP)).toBeUndefined();
  });

  it("stays on the list when the group is archived", () => {
    expect(resumeGroupId({ lastOpenedGroupId: "g1" }, { id: "g1", archivedAt: 1 })).toBeUndefined();
  });

  it("never opens a group other than the one remembered", () => {
    expect(resumeGroupId({ lastOpenedGroupId: "g1" }, { id: "g2" })).toBeUndefined();
  });
});
