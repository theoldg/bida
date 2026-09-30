/**
 * Where the bill is in a photo, found by scanic's ML corner detector
 * (docs/scan-worker.md#cropping-to-the-bill). A paper-edge detector finds
 * nothing when a white receipt lies on a white table; the model finds it anyway.
 *
 * The model and its runtime (~2.5 MB) are ours, served from `SCANIC_ASSETS`
 * (`scripts/scanic-assets.mjs`) and fetched only once a scan is tapped — never
 * precached, and never on a page that doesn't scan.
 */
export const SCANIC_ASSETS = "/scanic/0.2.0/";

const ML = { assetBaseUrl: SCANIC_ASSETS, modelFetchTimeoutMs: 20_000 };

export interface Point { x: number; y: number }

/** The paper's corners, in the order the model names them: TL, TR, BR, BL. */
export type Quad = readonly [Point, Point, Point, Point];

/**
 * The bill as an upright rectangle in photo pixels: its centre, its size once
 * turned square to the frame, and the turn that gets it there.
 */
export interface BillBox { cx: number; cy: number; width: number; height: number; angle: number }

/** The model finds the paper's corners; a sliver of margin keeps a corner it clipped. */
const MARGIN = 0.02;

type Detect = typeof import("scanic/ml").detectDocumentMl;

let ready: Promise<Detect | null> | null = null;
let readyMs: number | null = null;

/**
 * Starts the download. Called when a scan door is tapped, so it runs while the
 * camera is open; idempotent, and a failure is tried again on the next tap.
 */
export function warmBillFinder(): Promise<Detect | null> {
  if (ready) return ready;
  const started = performance.now();
  ready = (async () => {
    const { initializeMl, detectDocumentMl } = await import("scanic/ml");
    await initializeMl(ML);
    readyMs = performance.now() - started;
    return detectDocumentMl;
  })().catch(() => {
    ready = null;
    return null;
  });
  return ready;
}

/** How long the model took to arrive, once it has: /diag/crop prints it. */
export function billFinderLoadMs(): number | null {
  return readyMs;
}

/**
 * The paper's corners as fractions of `image`, or null to keep the whole
 * photo: when the model can't be had, isn't confident, or throws. A scan never
 * fails for want of a crop.
 */
export async function findBill(image: ImageData): Promise<Quad | null> {
  const detect = await warmBillFinder();
  if (!detect) return null;
  try {
    const found = await detect(image, ML);
    const c = found.corners;
    if (!found.success || !c) return null;
    const f = (p: Point) => ({ x: p.x / image.width, y: p.y / image.height });
    return [f(c.topLeft), f(c.topRight), f(c.bottomRight), f(c.bottomLeft)];
  } catch {
    return null;
  }
}

/**
 * The upright box around a quad in pixels. The turn is the slope of all four
 * edges, each weighted by its length and taken modulo a quarter turn, so it
 * straightens a tilt and never turns a bill on its side, which the model reads
 * well enough as it is. By length because a till roll's short edges are the
 * ones a thumb curls; its long sides say how it lies.
 */
export function billBox(quad: Quad, photoWidth: number, photoHeight: number): BillBox {
  const [tl, tr, br, bl] = quad;
  // Four times each angle makes a quarter turn a full one, so edges that are
  // 90° apart agree instead of cancelling.
  let sx = 0, sy = 0;
  for (const [a, b] of [[tl, tr], [tr, br], [br, bl], [bl, tl]] as const) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const slope = Math.atan2(b.y - a.y, b.x - a.x);
    sx += length * Math.cos(4 * slope);
    sy += length * Math.sin(4 * slope);
  }
  const angle = Math.atan2(sy, sx) / 4;
  const cx = (tl.x + tr.x + br.x + bl.x) / 4;
  const cy = (tl.y + tr.y + br.y + bl.y) / 4;
  // Each corner, turned by -angle about the centre, bounds the upright box.
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  let halfW = 0, halfH = 0;
  for (const p of quad) {
    const dx = p.x - cx, dy = p.y - cy;
    halfW = Math.max(halfW, Math.abs(dx * cos - dy * sin));
    halfH = Math.max(halfH, Math.abs(dx * sin + dy * cos));
  }
  const pad = MARGIN * Math.max(photoWidth, photoHeight);
  return { cx, cy, width: 2 * (halfW + pad), height: 2 * (halfH + pad), angle };
}
