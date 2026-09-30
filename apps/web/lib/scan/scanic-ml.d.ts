/**
 * scanic's ML half on its own, aliased in next.config.mjs. Its package exports
 * only the whole library, which reaches this file through an import webpack is
 * told to ignore and so 404s from `_next/static/chunks/` — and would bring the
 * classical detector we don't use. Typed here from its source, v1.6.0.
 */
declare module "scanic/ml" {
  interface MlOptions {
    assetBaseUrl?: string;
    modelFetchTimeoutMs?: number;
    minScore?: number;
  }
  type Corner = { x: number; y: number };
  export function initializeMl(options?: MlOptions): Promise<void>;
  export function detectDocumentMl(
    image: ImageData,
    options?: MlOptions,
  ): Promise<{
    success: boolean;
    corners: Record<"topLeft" | "topRight" | "bottomRight" | "bottomLeft", Corner> | null;
    score: number | null;
  }>;
}
