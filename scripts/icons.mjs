/**
 * Publish the brand mark: the master SVG for the app to show, the three
 * raster icons the platforms insist on, and the link-preview banner.
 *
 * `design/brand/logo.svg` is the master — square, with its own near-black
 * ground, so one artwork serves as plain and maskable icon. The PNGs are
 * committed: Android and iOS want raster files in the manifest, and a build
 * step every deploy would regenerate files that change once a year.
 *
 * Run `pnpm icons` after editing the logo or `design/brand/banner.svg`.
 * Chromium comes from the same place the browser checks take it — never run
 * `playwright install`.
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
 * on most Androids — down to about its central 80%. The artwork as drawn fits
 * inside that circle but fills nearly all of it, crowding the rim, so the
 * maskable copy draws the receipt at 72% about the centre. The uncropped icons
 * (tabs, iOS, splash) keep the artwork as drawn.
 */
const MASKABLE_SCALE = 0.72;
const ICONS = [
  { file: "icon-192.png", size: 192, scale: 1 },
  { file: "icon-512.png", size: 512, scale: 1 },
  { file: "icon-maskable-512.png", size: 512, scale: MASKABLE_SCALE },
];

/** Everything after the ground <rect/> is the mark; scale it about the centre. */
function scaled(art, scale) {
  if (scale === 1) return art;
  const ground = /(<rect [^>]*\/>)([\s\S]*)(<\/svg>)/;
  if (!ground.test(art)) throw new Error("logo.svg must open with its ground <rect/>");
  return art.replace(ground, `$1<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">$2</g>$3`);
}

/**
 * The dev Worker's copies wear a blue receipt, so a home screen holding both
 * apps can tell them apart with no word on the icon. They ship in every export,
 * production's too, so the build stays byte-identical; only the dev Worker ever
 * serves them, at the ordinary icon URLs (apps/api/src/dev-env.ts).
 */
const PAPER = 'fill="#ececea"';
if (svg.split(PAPER).length !== 2) throw new Error(`logo.svg must hold exactly one ${PAPER}: the receipt`);
const devSvg = svg.replace(PAPER, 'fill="#86b4ea"');

/**
 * The banner is set in JetBrains Mono, from the app's own committed Latin file
 * (apps/web/public/fonts/, globals.css) inlined, so it draws the app's glyphs
 * — and the render fails rather than fall back to another mono.
 */
async function latinFace() {
  const data = (await readFile(join(ROOT, "apps/web/public/fonts/jetbrains-mono-latin.woff2"))).toString("base64");
  return `@font-face{font-family:"JetBrains Mono";font-weight:400 700;`
    + `src:url(data:font/woff2;base64,${data}) format("woff2")}`;
}

await mkdir(join(ROOT, "apps/web/public/dev"), { recursive: true });
const browser = await launch();
try {
  for (const { file, size, scale } of ICONS) {
    for (const dev of [false, true]) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(
        `<style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}
         svg{display:block;width:100%;height:100%}</style>${scaled(dev ? devSvg : svg, scale)}`,
      );
      const png = await page.screenshot({ omitBackground: false });
      const out = dev ? `dev/${file}` : file;
      await writeFile(join(ROOT, "apps/web/public", out), png);
      await page.close();
      console.log(`${out}  ${size}×${size}`);
    }
  }

  /**
   * The picture a pasted link shows in a chat (app/layout.tsx's openGraph).
   * 1200×630 is the size every scraper takes; `design/brand/banner.svg` keeps
   * what must survive inside the centre square, which some apps crop to.
   */
  const banner = await readFile(join(ROOT, "design/brand/banner.svg"), "utf8");
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(
    `<style>${await latinFace()}
     html,body{margin:0;width:1200px;height:630px;overflow:hidden}
     svg{display:block;width:100%;height:100%}</style>${banner}`,
  );
  const loaded = await page.evaluate(async () => {
    const weights = ["400", "700"];
    await Promise.all(weights.map((w) => document.fonts.load(`${w} 48px "JetBrains Mono"`, "bida")));
    return weights.every((w) => document.fonts.check(`${w} 48px "JetBrains Mono"`, "bida"));
  });
  if (!loaded) throw new Error("JetBrains Mono did not load for the banner");
  await writeFile(join(ROOT, "apps/web/public/og.png"), await page.screenshot());
  await page.close();
  console.log("og.png  1200×630");
} finally {
  await browser.close();
}
