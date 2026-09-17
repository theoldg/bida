import { describe, expect, it } from "vitest";
import { exportFilename, handoffPlan } from "./export";

describe("which way the file goes out", () => {
  it("shares wherever a share sheet will take a file", () => {
    expect(handoffPlan({ canShare: true, iosApp: false })).toBe("share");
    expect(handoffPlan({ canShare: true, iosApp: true })).toBe("share");
  });

  it("downloads where there is no share sheet and a download is safe", () => {
    expect(handoffPlan({ canShare: false, iosApp: false })).toBe("download");
  });

  /**
   * The one row that matters. A download inside an iOS home-screen app strands
   * the person in a full-screen "Open in …" with no way back to bida, so the
   * absence of a share sheet there means the text, never the download.
   */
  it("never downloads inside an iOS home-screen app", () => {
    expect(handoffPlan({ canShare: false, iosApp: true })).toBe("text");
  });
});

describe("what the file is called", () => {
  const day = Date.UTC(2026, 8, 17, 12);

  it("names the group and the day it left", () => {
    expect(exportFilename("Marrakech", day)).toBe("bida-marrakech-2026-09-17.csv");
  });

  it("slugs a name with spaces and punctuation in it", () => {
    expect(exportFilename("Ski trip 2026!", day)).toBe("bida-ski-trip-2026-2026-09-17.csv");
  });

  it("keeps a name that is all accents or emoji from becoming a bare dash", () => {
    expect(exportFilename("Crète 🏖", day)).toBe("bida-cr-te-2026-09-17.csv");
    expect(exportFilename("🏖", day)).toBe("bida-2026-09-17.csv");
    expect(exportFilename("", day)).toBe("bida-2026-09-17.csv");
  });
});
