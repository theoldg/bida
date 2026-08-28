/**
 * Downscales a captured photo before it leaves the device. Vision models
 * don't read a receipt better above this, and it keeps the request small
 * enough for the Worker's passthrough to stay under its CPU budget — see
 * docs/receipt-scanning.md.
 */
const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.7;

export async function downscaleToBase64Jpeg(photo: File | Blob): Promise<string> {
  const bitmap = await createImageBitmap(photo);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("downscaleToBase64Jpeg: no 2d context");
  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  return base64FromBytes(new Uint8Array(await blob.arrayBuffer()));
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
