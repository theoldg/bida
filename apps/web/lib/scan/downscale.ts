import { MAX_IMAGE_BYTES } from "@bida/core";
import { billBox, findBill, type BillBox, type Quad } from "./find-bill";

/**
 * Straightens and crops a captured photo to the bill, then downscales it,
 * before it leaves the device — docs/scan-worker.md#cropping-to-the-bill.
 *
 * The turn happens at full resolution and the shrink after it, so the print is
 * resampled once at its sharpest and once to size — never shrunk and then
 * turned. The cap is on pixels, not the long edge: a till roll is tall and
 * thin, and a long-edge cap spends its whole budget on the roll's length.
 */
const MAX_PIXELS = 1024 * 1024;
const JPEG_QUALITY = 0.7;
/** The long edge the detector is shown; it reads a 224px copy of it anyway. */
const FIND_EDGE = 800;
/** Well under the Worker's cap, so a busy photo shrinks here rather than bouncing there. */
const TARGET_BASE64 = Math.floor(MAX_IMAGE_BYTES * 0.75);
/** The straightened bill at full resolution, within what every phone's canvas allows. */
const MAX_TURNED_PIXELS = 16_000_000;

/** What a photo became, and what each step cost — /diag/crop prints all of it. */
export interface PreparedBill {
  base64: string;
  /** The model's corners in photo pixels, and the box made of them; null sent it whole. */
  quad: Quad | null;
  box: BillBox | null;
  source: { width: number; height: number };
  sent: { width: number; height: number };
  ms: { find: number; turn: number; encode: number; total: number };
}

export async function downscaleToBase64Jpeg(photo: File | Blob): Promise<string> {
  return (await prepareBill(photo)).base64;
}

export async function prepareBill(photo: File | Blob): Promise<PreparedBill> {
  const started = performance.now();
  const bitmap = await createImageBitmap(photo);
  const source = { width: bitmap.width, height: bitmap.height };

  const found = await findBill(thumbnail(bitmap));
  const px = (p: { x: number; y: number }) => ({ x: p.x * source.width, y: p.y * source.height });
  const quad: Quad | null = found ? [px(found[0]), px(found[1]), px(found[2]), px(found[3])] : null;
  const box = quad ? billBox(quad, source.width, source.height) : null;
  const t1 = performance.now();

  const bill = box ? turn(bitmap, box) : bitmap;
  const t2 = performance.now();

  let budget = MAX_PIXELS;
  for (;;) {
    const scale = Math.min(1, Math.sqrt(budget / (bill.width * bill.height)));
    const width = Math.max(1, Math.round(bill.width * scale));
    const height = Math.max(1, Math.round(bill.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = context(canvas);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bill, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
    const base64 = base64FromBytes(new Uint8Array(await blob.arrayBuffer()));
    // A photo of a patterned cloth compresses badly; fewer pixels always fit eventually.
    if (base64.length <= TARGET_BASE64 || budget < 250_000) {
      const done = performance.now();
      return {
        base64, quad, box, source, sent: { width, height },
        ms: { find: t1 - started, turn: t2 - t1, encode: done - t2, total: done - started },
      };
    }
    budget *= 0.7;
  }
}

/**
 * The bill alone, turned square to the frame, at the photo's own resolution.
 * Past the photo's edge is white: paper, as far as the model is concerned.
 */
function turn(bitmap: ImageBitmap, box: BillBox): OffscreenCanvas {
  const scale = Math.min(1, Math.sqrt(MAX_TURNED_PIXELS / (box.width * box.height)));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(box.width * scale)), Math.max(1, Math.round(box.height * scale)));
  const ctx = context(canvas);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(scale, scale);
  ctx.rotate(-box.angle);
  ctx.translate(-box.cx, -box.cy);
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}

function thumbnail(bitmap: ImageBitmap): ImageData {
  const scale = Math.min(1, FIND_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("prepareBill: no 2d context");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function context(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("prepareBill: no 2d context");
  return ctx;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
