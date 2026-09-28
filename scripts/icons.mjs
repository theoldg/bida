/**
 * Publish the brand mark: the master SVG for the app to show, and the three
 * raster icons the platforms insist on.
 *
 * `design/brand/logo.svg` is the master — square, with its own near-black
 * ground, so one artwork serves as plain and maskable icon. The PNGs are
 * committed: Android and iOS want raster files in the manifest, and a build
 * step every deploy would regenerate files that change once a year.
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
 * on most Androids — and only what lies outside the central 80% circle may be
 * eaten. The receipt's corners sit inside that circle by construction, so the
 * maskable copy is the artwork as drawn: an inset would only shrink the mark.
 */
const ICONS = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "icon-maskable-512.png", size: 512 },
];

/**
 * The dev Worker's copies wear a blue receipt, so a home screen holding both
 * apps can tell them apart with no word on the icon. They ship in every export,
 * production's too, so the build stays byte-identical; only the dev Worker ever
 * serves them, at the ordinary icon URLs (apps/api/src/dev-env.ts).
 */
const PAPER = 'fill="#ececea"';
if (svg.split(PAPER).length !== 2) throw new Error(`logo.svg must hold exactly one ${PAPER}: the receipt`);
const devSvg = svg.replace(PAPER, 'fill="#86b4ea"');

await mkdir(join(ROOT, "apps/web/public/dev"), { recursive: true });
const browser = await launch();
try {
  for (const { file, size } of ICONS) {
    for (const dev of [false, true]) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(
        `<style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}
         svg{display:block;width:100%;height:100%}</style>${dev ? devSvg : svg}`,
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
