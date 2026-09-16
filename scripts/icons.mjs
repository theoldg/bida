/**
 * Publish the brand mark: the master SVG for the app to show, and the three
 * raster icons the platforms insist on.
 *
 * `design/brand/logo.svg` is the master — vector, square, and carrying its own
 * near-black ground, which is what lets the same artwork serve as both the
 * plain and the maskable icon. Committing the PNGs it produces rather than the
 * SVG alone is deliberate: Android and iOS both want raster files named in the
 * manifest, and the alternative is a build step every deploy pays for to
 * produce three files that change once a year.
 *
 * Run `pnpm icons` after editing the logo. Chromium comes from the same place
 * the browser checks take it — never run `playwright install`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, launch } from "./lib/harness.mjs";

const svg = await readFile(join(ROOT, "design/brand/logo.svg"), "utf8");

/**
 * The app shows the real artwork, not a redrawing of it — `components/icons.tsx`
 * points an <img> at this copy. Copied rather than imported because the export
 * serves `public/` verbatim and `design/` is outside it; copied by this script
 * rather than by hand so the one in the app cannot drift from the master.
 */
await writeFile(join(ROOT, "apps/web/public/logo.svg"), svg);
console.log("logo.svg  (copied from design/brand)");

/**
 * A maskable icon is cropped to whatever shape the launcher fancies — a circle
 * on most Androids — so the artwork is inset onto its own ground and only the
 * padding is allowed to be eaten. 72% is inside the 80% safe zone the spec
 * guarantees, with room for the mark's own asymmetry.
 */
const ICONS = [
  { file: "icon-192.png", size: 192, scale: 1 },
  { file: "icon-512.png", size: 512, scale: 1 },
  { file: "icon-maskable-512.png", size: 512, scale: 0.72 },
];

const GROUND = "#141517"; // the logo's own background, so the inset is invisible

/**
 * The dev Worker's copies, stamped so a home screen holding both apps can tell
 * them apart. Ugly on purpose. They ship in every export, production's too, so
 * the build stays byte-identical; only the dev Worker ever serves them, at the
 * ordinary icon URLs (apps/api/src/dev-env.ts). The band sits inside the
 * artwork's box, so the maskable crop keeps it.
 */
const STAMP = `<b style="position:absolute;left:-10%;right:-10%;top:50%;transform:translateY(-50%) rotate(-30deg);
  background:#E0201B;color:#fff;font:900 22cqw/1.25 Arial Black,Arial,sans-serif;text-align:center;
  letter-spacing:.06em;border-block:1.2cqw solid #fff">DEV</b>`;

await mkdir(join(ROOT, "apps/web/public/dev"), { recursive: true });
const browser = await launch();
try {
  for (const { file, size, scale } of ICONS) {
    for (const dev of [false, true]) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(
        `<style>html,body{margin:0;width:${size}px;height:${size}px;background:${GROUND};overflow:hidden}
         div{width:${scale * 100}%;height:${scale * 100}%;margin:${(1 - scale) * 50}% auto;
           position:relative;container-type:size;overflow:hidden}
         svg{display:block;width:100%;height:100%}</style><div>${svg}${dev ? STAMP : ""}</div>`,
      );
      const png = await page.screenshot({ omitBackground: false });
      const out = dev ? `dev/${file}` : file;
      await writeFile(join(ROOT, "apps/web/public", out), png);
      await page.close();
      console.log(`${out}  ${size}×${size}`);
    }
  }
} finally {
  await browser.close();
}
