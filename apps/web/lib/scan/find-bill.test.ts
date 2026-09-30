import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { SCANIC_ASSETS, billBox, type Quad } from "./find-bill";

/** A w×h rectangle centred on (cx, cy), turned by `deg`, corners TL TR BR BL. */
function turned(cx: number, cy: number, w: number, h: number, deg: number): Quad {
  const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const at = (x: number, y: number) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos });
  return [at(-w / 2, -h / 2), at(w / 2, -h / 2), at(w / 2, h / 2), at(-w / 2, h / 2)];
}

describe("billBox", () => {
  const pad = 0.02 * 4000;

  it("finds the turn and the paper's own size under it", () => {
    const box = billBox(turned(1500, 2000, 900, 3600, 8), 3000, 4000);
    expect((box.angle * 180) / Math.PI).toBeCloseTo(8);
    expect(box.cx).toBeCloseTo(1500);
    expect(box.cy).toBeCloseTo(2000);
    expect(box.width).toBeCloseTo(900 + 2 * pad);
    expect(box.height).toBeCloseTo(3600 + 2 * pad);
  });

  it("turns the other way as readily", () => {
    expect((billBox(turned(1500, 2000, 900, 3600, -12), 3000, 4000).angle * 180) / Math.PI)
      .toBeCloseTo(-12);
  });

  it("never turns a bill on its side: a sideways one is squared, not stood up", () => {
    const box = billBox(turned(2000, 1500, 900, 3000, 87), 4000, 3000);
    expect((box.angle * 180) / Math.PI).toBeCloseTo(-3);
    expect(box.width).toBeCloseTo(3000 + 2 * pad);
  });

  it("trusts a till roll's long sides over a top edge a thumb curled", () => {
    // The corners the model found on a real photo: the top edge slopes 9°, the
    // long sides under 2°, and the roll is all but upright.
    const box = billBox(
      [{ x: 385, y: 58 }, { x: 709, y: 109 }, { x: 663, y: 1474 }, { x: 383, y: 1465 }],
      1200, 1600,
    );
    expect(Math.abs((box.angle * 180) / Math.PI)).toBeLessThan(2.5);
  });
});

it("asks for the model at the version scripts/scanic-assets.mjs copies", () => {
  const pkg = createRequire(import.meta.url).resolve("scanic-ml/package.json");
  const { version } = JSON.parse(readFileSync(pkg, "utf8")) as { version: string };
  expect(SCANIC_ASSETS).toBe(`/scanic/${version}/`);
});
