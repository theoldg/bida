import { describe, expect, it } from "vitest";
import { devAssetPath } from "./dev-env";

describe("devAssetPath", () => {
  it("swaps every manifest icon for its stamped copy", () => {
    for (const icon of ["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"]) {
      expect(devAssetPath(icon)).toBe(`/dev${icon}`);
    }
  });

  it("leaves everything else alone", () => {
    for (const path of ["/", "/g", "/g.txt", "/logo.svg", "/manifest.webmanifest", "/dev/icon-192.png"]) {
      expect(devAssetPath(path)).toBe(path);
    }
  });
});
