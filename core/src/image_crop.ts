/**
 * Canvas image post-processing shared by every MolVis surface.
 *
 * Trimming transparent margins and re-encoding are the same operations
 * whether the pixels came from the 3D stage's framebuffer or the 2D
 * sketch board, so both engines export images through this module and
 * users get one consistent result. It lives in `core` because the two
 * engines are peers and cannot import each other.
 *
 * Pure canvas work — no molrs, no engine types.
 */

export interface CropOptions {
  padding?: number;
  mimeType?: string;
  quality?: number;
  alphaThreshold?: number;
}

export interface CropBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Scan RGBA pixel data for the tight bounding box of non-transparent pixels.
 * Returns null when every pixel has alpha <= threshold (nothing was drawn).
 */
export function findAlphaBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 0,
): CropBounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      const alpha = pixels[rowStart + x * 4 + 3];
      if (alpha > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function applyPadding(
  bounds: CropBounds,
  width: number,
  height: number,
  padding: number,
): CropBounds {
  const x = Math.max(0, bounds.x - padding);
  const y = Math.max(0, bounds.y - padding);
  const right = Math.min(width, bounds.x + bounds.width + padding);
  const bottom = Math.min(height, bounds.y + bounds.height + padding);
  return { x, y, width: right - x, height: bottom - y };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode screenshot image"));
    img.src = src;
  });
}

/**
 * Re-encode an RGBA canvas to the given mime type. Returns a data URL.
 */
function encodeCanvas(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): string {
  return canvas.toDataURL(mimeType, quality);
}

/**
 * Decode a data URL and re-encode it as the given mime type (no cropping).
 */
export async function reencodeImage(
  dataUrl: string,
  mimeType: string,
  quality = 0.92,
): Promise<string> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to acquire 2D context for re-encode");
  ctx.drawImage(img, 0, 0);
  return encodeCanvas(canvas, mimeType, quality);
}

/**
 * Crop a data URL to the explicit pixel bounds and re-encode. Bounds are
 * clamped to the image extent; empty intersection throws.
 */
export async function cropToRect(
  dataUrl: string,
  bounds: CropBounds,
  mimeType = "image/png",
  quality = 0.92,
): Promise<string> {
  const img = await loadImage(dataUrl);
  const width = img.naturalWidth;
  const height = img.naturalHeight;

  const x = Math.max(0, Math.min(width, Math.floor(bounds.x)));
  const y = Math.max(0, Math.min(height, Math.floor(bounds.y)));
  const right = Math.max(
    x,
    Math.min(width, Math.floor(bounds.x + bounds.width)),
  );
  const bottom = Math.max(
    y,
    Math.min(height, Math.floor(bounds.y + bounds.height)),
  );
  const w = right - x;
  const h = bottom - y;
  if (w <= 0 || h <= 0) {
    throw new Error("Crop bounds have zero area");
  }

  const dest = document.createElement("canvas");
  dest.width = w;
  dest.height = h;
  const ctx = dest.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to acquire 2D context for crop");
  }
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  return encodeCanvas(dest, mimeType, quality);
}

/**
 * Decode a data URL, scan its alpha channel for drawn content, crop to the tight
 * bounds (with optional padding), and re-encode to the requested mime type.
 *
 * Returns the source data URL unchanged if the image is fully transparent.
 * The input must have an alpha channel (PNG from a transparent-background render).
 */
export async function cropToContent(
  dataUrl: string,
  options: CropOptions = {},
): Promise<string> {
  const {
    padding = 8,
    mimeType = "image/webp",
    quality = 0.92,
    alphaThreshold = 0,
  } = options;

  const img = await loadImage(dataUrl);
  const width = img.naturalWidth;
  const height = img.naturalHeight;

  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) {
    throw new Error("Failed to acquire 2D context for crop");
  }
  sourceCtx.drawImage(img, 0, 0);

  const imageData = sourceCtx.getImageData(0, 0, width, height);
  const raw = findAlphaBounds(imageData.data, width, height, alphaThreshold);
  if (!raw) {
    return dataUrl;
  }

  const bounds = applyPadding(raw, width, height, padding);
  const dest = document.createElement("canvas");
  dest.width = bounds.width;
  dest.height = bounds.height;
  const destCtx = dest.getContext("2d");
  if (!destCtx) {
    throw new Error("Failed to acquire 2D context for crop output");
  }
  destCtx.drawImage(
    source,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height,
  );

  return encodeCanvas(dest, mimeType, quality);
}
