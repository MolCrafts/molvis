import { describe, expect, it } from "@rstest/core";
import { cropToContent, findAlphaBounds } from "../src/image_crop";

function makeBuffer(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number],
): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y);
      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return data;
}

function bufferToDataUrl(
  data: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  const imageData = new ImageData(data, width, height);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

describe("findAlphaBounds", () => {
  it("detects tight bounds around opaque region", () => {
    // 16x16 transparent, opaque 4x4 at (3..6, 5..8)
    const data = makeBuffer(16, 16, (x, y) => {
      const inside = x >= 3 && x <= 6 && y >= 5 && y <= 8;
      return inside ? [255, 0, 0, 255] : [0, 0, 0, 0];
    });
    const bounds = findAlphaBounds(data, 16, 16);
    expect(bounds).toEqual({ x: 3, y: 5, width: 4, height: 4 });
  });

  it("returns null when the image is fully transparent", () => {
    const data = makeBuffer(8, 8, () => [0, 0, 0, 0]);
    expect(findAlphaBounds(data, 8, 8)).toBeNull();
  });

  it("honors alphaThreshold for near-transparent pixels", () => {
    const data = makeBuffer(4, 4, (x, y) =>
      x === 2 && y === 2 ? [1, 1, 1, 10] : [0, 0, 0, 0],
    );
    expect(findAlphaBounds(data, 4, 4, 20)).toBeNull();
    expect(findAlphaBounds(data, 4, 4, 0)).toEqual({
      x: 2,
      y: 2,
      width: 1,
      height: 1,
    });
  });
});

describe("cropToContent", () => {
  it("crops to content with padding and clamps to image bounds", async () => {
    const width = 20;
    const height = 20;
    const data = makeBuffer(width, height, (x, y) => {
      const inside = x >= 8 && x <= 11 && y >= 8 && y <= 11;
      return inside ? [0, 128, 0, 255] : [0, 0, 0, 0];
    });
    const source = bufferToDataUrl(data, width, height);

    const cropped = await cropToContent(source, {
      padding: 2,
      mimeType: "image/png",
    });
    const img = await loadImage(cropped);
    // 4x4 drawn region + 2px padding on each side = 8x8
    expect(img.naturalWidth).toBe(8);
    expect(img.naturalHeight).toBe(8);
  });

  it("clamps padding at the image edge", async () => {
    const width = 10;
    const height = 10;
    // Opaque pixel in the top-left corner: padding cannot go below 0.
    const data = makeBuffer(width, height, (x, y) =>
      x === 0 && y === 0 ? [255, 255, 255, 255] : [0, 0, 0, 0],
    );
    const source = bufferToDataUrl(data, width, height);
    const cropped = await cropToContent(source, {
      padding: 100,
      mimeType: "image/png",
    });
    const img = await loadImage(cropped);
    // Padding clamps to the whole image
    expect(img.naturalWidth).toBe(width);
    expect(img.naturalHeight).toBe(height);
  });

  it("returns the source data URL unchanged when fully transparent", async () => {
    const width = 4;
    const height = 4;
    const data = makeBuffer(width, height, () => [0, 0, 0, 0]);
    const source = bufferToDataUrl(data, width, height);
    const cropped = await cropToContent(source, {
      padding: 4,
      mimeType: "image/webp",
    });
    expect(cropped).toBe(source);
  });
});

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode failed"));
    img.src = src;
  });
}
