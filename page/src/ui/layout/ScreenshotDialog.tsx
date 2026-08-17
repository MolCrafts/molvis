import {
  type CropBounds,
  cropToRect,
  findAlphaBounds,
  type Molvis,
  reencodeImage,
} from "@molcrafts/molvis-stage";
import {
  Camera,
  Crop,
  Download,
  Link2,
  Link2Off,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { ViewerIconAction } from "@/components/viewer/ViewerIconAction";
import { ViewerOperationState } from "@/components/viewer/ViewerOperationState";
import { ViewerToggleAction } from "@/components/viewer/ViewerToggleAction";
import { useViewerOperation } from "@/hooks/useViewerOperation";
import { cn } from "@/lib/utils";

type CropMode = "none" | "auto" | "manual";
type SaveFormat = "png" | "jpg" | "webp";

const FORMAT_TO_EXT: Record<SaveFormat, string> = {
  png: "png",
  jpg: "jpg",
  webp: "webp",
};

const FORMAT_TO_MIME: Record<SaveFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

const formatFromExt = (ext: string): SaveFormat | null => {
  const e = ext.toLowerCase();
  if (e === "png") return "png";
  if (e === "jpg" || e === "jpeg") return "jpg";
  if (e === "webp") return "webp";
  return null;
};

const swapExtension = (name: string, newExt: string): string => {
  const m = name.match(/^(.*?)(\.[^./\\]+)?$/);
  const stem = m?.[1] ?? name;
  return `${stem || "molvis-screenshot"}.${newExt}`;
};

interface ScreenshotDialogProps {
  app: Molvis | null;
}

const MIN_DIM = 16;
const MAX_DIM = 8192;
const AUTO_CROP_PADDING = 8;
/** Default output aspect ratio (width / height). */
const DEFAULT_ASPECT = 4 / 3;

const gcd = (a: number, b: number): number => {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
};

/** Compact aspect label, preferring common standards (4:3, 16:9, …). */
const formatAspectLabel = (w: number, h: number): string => {
  if (!(w > 0) || !(h > 0)) return "–";
  const r = w / h;
  const standards: [number, string][] = [
    [4 / 3, "4:3"],
    [3 / 4, "3:4"],
    [16 / 9, "16:9"],
    [9 / 16, "9:16"],
    [1, "1:1"],
    [3 / 2, "3:2"],
    [2 / 3, "2:3"],
    [21 / 9, "21:9"],
  ];
  for (const [ar, label] of standards) {
    if (Math.abs(r - ar) < 0.012) return label;
  }
  const g = gcd(w, h);
  const rw = Math.round(w / g);
  const rh = Math.round(h / g);
  if (rw > 100 || rh > 100) return r.toFixed(2);
  return `${rw}:${rh}`;
};
const CAPTURE_COPY = {
  running: "Capturing…",
  success: "",
  error: "Could not capture the viewport",
};
const AUTO_CROP_COPY = {
  running: "Cropping…",
  success: "",
  error: "Could not auto-crop the preview",
};
const SAVE_COPY = {
  running: "Encoding and saving the image…",
  success: "Screenshot saved",
  error: "Could not save the screenshot",
};

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const resp = await fetch(dataUrl);
  return await resp.blob();
}

const mimeForExt = (ext: string): string => {
  const e = ext.toLowerCase();
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "webp") return "image/webp";
  return "image/png";
};

const clampDim = (n: number): number =>
  Math.max(MIN_DIM, Math.min(MAX_DIM, Math.round(n)));

async function computeAutoBounds(
  dataUrl: string,
  padding: number,
): Promise<CropBounds | null> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        reject(new Error("Failed to acquire 2D context"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const raw = findAlphaBounds(data.data, canvas.width, canvas.height);
      if (!raw) {
        resolve(null);
        return;
      }
      const x = Math.max(0, raw.x - padding);
      const y = Math.max(0, raw.y - padding);
      const right = Math.min(canvas.width, raw.x + raw.width + padding);
      const bottom = Math.min(canvas.height, raw.y + raw.height + padding);
      resolve({ x, y, width: right - x, height: bottom - y });
    };
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = dataUrl;
  });
}

function inscribeAspect(
  viewW: number,
  viewH: number,
  targetAspect: number,
): CropBounds {
  if (!(targetAspect > 0) || !Number.isFinite(targetAspect)) {
    return { x: 0, y: 0, width: viewW, height: viewH };
  }
  const viewAspect = viewW / viewH;
  if (targetAspect >= viewAspect) {
    const w = viewW;
    const h = w / targetAspect;
    return { x: 0, y: (viewH - h) / 2, width: w, height: h };
  }
  const h = viewH;
  const w = h * targetAspect;
  return { x: (viewW - w) / 2, y: 0, width: w, height: h };
}

async function resampleToSize(
  dataUrl: string,
  targetW: number,
  targetH: number,
  mime: string,
  quality: number,
  opts?: { flattenWhite?: boolean },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to acquire 2D context"));
        return;
      }
      if (opts?.flattenWhite) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, targetW, targetH);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, targetW, targetH);
      resolve(canvas.toDataURL(mime, quality));
    };
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = dataUrl;
  });
}

/** Composite alpha onto white (opaque output / JPEG). */
async function flattenOnWhite(
  dataUrl: string,
  mime: string,
  quality: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to acquire 2D context"));
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL(mime, quality));
    };
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = dataUrl;
  });
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function embedPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (png[i] !== SIG[i]) return png;
  }
  const ppm = Math.round(dpi * 39.3701);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk[4] = 0x70;
  chunk[5] = 0x48;
  chunk[6] = 0x59;
  chunk[7] = 0x73;
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunk[16] = 1;
  view.setUint32(17, crc32(chunk.subarray(4, 17)));

  const insertPos = 8 + 25;
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, insertPos), 0);
  out.set(chunk, insertPos);
  out.set(png.subarray(insertPos), insertPos + chunk.length);
  return out;
}

function embedJpegDpi(jpeg: Uint8Array, dpi: number): Uint8Array {
  if (jpeg.length < 20 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  for (let i = 2; i + 18 < jpeg.length; i++) {
    if (
      jpeg[i] === 0xff &&
      jpeg[i + 1] === 0xe0 &&
      jpeg[i + 4] === 0x4a &&
      jpeg[i + 5] === 0x46 &&
      jpeg[i + 6] === 0x49 &&
      jpeg[i + 7] === 0x46 &&
      jpeg[i + 8] === 0x00
    ) {
      const out = new Uint8Array(jpeg);
      out[i + 11] = 1;
      out[i + 12] = (dpi >> 8) & 0xff;
      out[i + 13] = dpi & 0xff;
      out[i + 14] = (dpi >> 8) & 0xff;
      out[i + 15] = dpi & 0xff;
      return out;
    }
  }
  return jpeg;
}

async function embedDpi(blob: Blob, mime: string, dpi: number): Promise<Blob> {
  if (!(dpi > 0) || !Number.isFinite(dpi)) return blob;
  if (Math.round(dpi) === 96) return blob;
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (mime === "image/png") {
    return new Blob([embedPngDpi(buf, dpi) as BlobPart], { type: mime });
  }
  if (mime === "image/jpeg") {
    return new Blob([embedJpegDpi(buf, dpi) as BlobPart], { type: mime });
  }
  return blob;
}

export const ScreenshotDialog: React.FC<ScreenshotDialogProps> = ({ app }) => {
  const [open, setOpen] = useState(false);

  const [widthStr, setWidthStr] = useState("1600");
  const [heightStr, setHeightStr] = useState("1200");
  const [dpiStr, setDpiStr] = useState("96");
  const [transparent, setTransparent] = useState(true);
  const [aspectLocked, setAspectLocked] = useState(true);
  const [lockedAspect, setLockedAspect] = useState(DEFAULT_ASPECT);

  const [format, setFormat] = useState<SaveFormat>("png");
  const [filename, setFilename] = useState("molvis-screenshot.png");

  const [cropMode, setCropMode] = useState<CropMode>("none");
  const [manualCrop, setManualCrop] = useState<CropBounds | null>(null);
  const [autoBounds, setAutoBounds] = useState<CropBounds | null>(null);

  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [rawSize, setRawSize] = useState<{ w: number; h: number } | null>(null);

  const captureOperation = useViewerOperation();
  const cropOperation = useViewerOperation();
  const saveOperation = useViewerOperation();
  const capturing = captureOperation.running;
  // Auto-crop is local to the preview bitmap — keep the form interactive.
  const busy = captureOperation.running || saveOperation.running;
  const operationFeedback =
    saveOperation.feedback ??
    cropOperation.feedback ??
    captureOperation.feedback;

  const imgRef = useRef<HTMLImageElement | null>(null);
  type DragState =
    | {
        mode: "create";
        startPctX: number;
        startPctY: number;
        rectLeft: number;
        rectTop: number;
        rectW: number;
        rectH: number;
      }
    | {
        mode: "move";
        startPctX: number;
        startPctY: number;
        rectLeft: number;
        rectTop: number;
        rectW: number;
        rectH: number;
        baseFrame: CropBounds;
      };
  const dragStateRef = useRef<DragState | null>(null);
  type DraftRectPct = { x: number; y: number; w: number; h: number };
  const [draftRect, setDraftRect] = useState<DraftRectPct | null>(null);

  const widthNum = Number.parseInt(widthStr, 10) || 0;
  const heightNum = Number.parseInt(heightStr, 10) || 0;
  const dpiNum = Number.parseInt(dpiStr, 10) || 96;
  const targetAspect = heightNum > 0 ? widthNum / heightNum : 0;

  // Always capture with alpha; Transparent is applied at preview/export only
  // so option toggles never re-shot the viewport.
  const captureViewport = useCallback(async () => {
    if (!app) return;
    cropOperation.reset();
    saveOperation.reset();
    const canvas = app.canvas;
    const w = canvas.width;
    const h = canvas.height;
    await captureOperation.run(
      async () => {
        const raw = await app.screenshot({
          width: w,
          height: h,
          transparentBackground: true,
          format: "png",
          autoCrop: false,
        });
        setRawUrl(raw);
        setRawSize({ w, h });
        setManualCrop(null);
        setDraftRect(null);
        setAutoBounds(null);
        setCropMode("none");
      },
      CAPTURE_COPY,
      { feedbackMode: "errors" },
    );
  }, [app, captureOperation.run, cropOperation.reset, saveOperation.reset]);

  const captureRef = useRef(captureViewport);
  captureRef.current = captureViewport;

  const syncOutputSize = useCallback(
    (w: number, h: number, opts?: { adoptAspect?: boolean }) => {
      const cw = clampDim(w);
      const ch = clampDim(h);
      setWidthStr(String(cw));
      setHeightStr(String(ch));
      if (opts?.adoptAspect !== false && cw > 0 && ch > 0) {
        setLockedAspect(cw / ch);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open || !app) return;
    const canvas = app.canvas;
    // Default 4:3 output inscribed in the live viewport (native px).
    const frame = inscribeAspect(canvas.width, canvas.height, DEFAULT_ASPECT);
    setWidthStr(String(Math.round(frame.width)));
    setHeightStr(String(Math.round(frame.height)));
    setAspectLocked(true);
    setLockedAspect(DEFAULT_ASPECT);
    setDpiStr("96");
    setTransparent(true);
    setCropMode("none");
    setManualCrop(null);
    setDraftRect(null);
    setAutoBounds(null);
    setRawUrl(null);
    setFormat("png");
    setFilename("molvis-screenshot.png");
    captureOperation.reset();
    cropOperation.reset();
    saveOperation.reset();
    void captureRef.current();
  }, [
    open,
    app,
    captureOperation.reset,
    cropOperation.reset,
    saveOperation.reset,
  ]);

  const onFormatChange = (value: string) => {
    const next = value as SaveFormat;
    setFormat(next);
    setFilename((current) => swapExtension(current, FORMAT_TO_EXT[next]));
    saveOperation.reset();
  };

  const onFilenameChange = (value: string) => {
    setFilename(value);
    saveOperation.reset();
    const ext = value.match(/\.([a-z0-9]+)$/i)?.[1];
    if (!ext) return;
    const matched = formatFromExt(ext);
    if (matched && matched !== format) setFormat(matched);
  };

  useEffect(() => {
    if (cropMode !== "auto" || !rawUrl) {
      setAutoBounds(null);
      cropOperation.reset();
      return;
    }
    let cancelled = false;
    saveOperation.reset();
    void cropOperation.run(
      async () => {
        const bounds = await computeAutoBounds(rawUrl, AUTO_CROP_PADDING);
        if (cancelled) {
          throw new DOMException("Auto-crop cancelled", "AbortError");
        }
        setAutoBounds(bounds);
        if (bounds) {
          syncOutputSize(bounds.width, bounds.height);
        }
      },
      AUTO_CROP_COPY,
      { feedbackMode: "errors" },
    );
    return () => {
      cancelled = true;
    };
  }, [
    cropMode,
    rawUrl,
    cropOperation.reset,
    cropOperation.run,
    saveOperation.reset,
    syncOutputSize,
  ]);

  const frameBounds: CropBounds | null = useMemo(() => {
    if (!rawSize) return null;
    if (cropMode === "manual" && manualCrop) return manualCrop;
    if (cropMode === "auto" && autoBounds) return autoBounds;
    if (!(targetAspect > 0)) return null;
    return inscribeAspect(rawSize.w, rawSize.h, targetAspect);
  }, [cropMode, manualCrop, autoBounds, rawSize, targetAspect]);

  const encodeForSave = useCallback(
    async (mime: string): Promise<Blob> => {
      if (!rawUrl || !rawSize) throw new Error("No capture");
      const W = clampDim(widthNum);
      const H = clampDim(heightNum);
      // JPEG has no alpha; Transparent off flattens onto white at export.
      const flattenWhite = !transparent || mime === "image/jpeg";
      let dataUrl: string;
      if (frameBounds) {
        const cropped = await cropToRect(rawUrl, frameBounds, "image/png", 1);
        dataUrl = await resampleToSize(cropped, W, H, mime, 0.92, {
          flattenWhite,
        });
      } else if (rawSize.w === W && rawSize.h === H) {
        dataUrl = flattenWhite
          ? await flattenOnWhite(rawUrl, mime, 0.92)
          : mime === "image/png"
            ? rawUrl
            : await reencodeImage(rawUrl, mime, 0.92);
      } else {
        dataUrl = await resampleToSize(rawUrl, W, H, mime, 0.92, {
          flattenWhite,
        });
      }
      let blob = await dataUrlToBlob(dataUrl);
      blob = await embedDpi(blob, mime, dpiNum);
      return blob;
    },
    [rawUrl, rawSize, frameBounds, widthNum, heightNum, dpiNum, transparent],
  );

  const handleSave = () => {
    if (!rawUrl || busy) return;
    const anyWin = window as unknown as {
      showSaveFilePicker?: (options: {
        suggestedName?: string;
        types?: {
          description?: string;
          accept: Record<string, string[]>;
        }[];
      }) => Promise<{
        name: string;
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    };

    const mime = FORMAT_TO_MIME[format];
    const ext = FORMAT_TO_EXT[format];
    const suggestedName = filename.trim() || `molvis-screenshot.${ext}`;

    void saveOperation.run(
      async () => {
        if (typeof anyWin.showSaveFilePicker === "function") {
          const handle = await anyWin.showSaveFilePicker({
            suggestedName,
            types: [
              {
                description: `${format.toUpperCase()} image`,
                accept: { [mime]: [`.${ext}`] },
              },
            ],
          });
          const savedExt = handle.name.match(/\.([a-z0-9]+)$/i)?.[1];
          const savedMime = savedExt ? mimeForExt(savedExt) : mime;
          const blob = await encodeForSave(savedMime);
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          return;
        }

        const blob = await encodeForSave(mime);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = suggestedName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      { ...SAVE_COPY, successDetail: suggestedName },
    );
  };

  const onPreviewMouseDown = (e: React.MouseEvent) => {
    const img = imgRef.current;
    if (!img || !rawSize) return;
    if (e.button !== 0) return;
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;

    const insideFrame =
      frameBounds &&
      px >= (frameBounds.x / rawSize.w) * 100 &&
      px <= ((frameBounds.x + frameBounds.width) / rawSize.w) * 100 &&
      py >= (frameBounds.y / rawSize.h) * 100 &&
      py <= ((frameBounds.y + frameBounds.height) / rawSize.h) * 100;

    if (insideFrame && frameBounds) {
      dragStateRef.current = {
        mode: "move",
        startPctX: px,
        startPctY: py,
        rectLeft: rect.left,
        rectTop: rect.top,
        rectW: rect.width,
        rectH: rect.height,
        baseFrame: { ...frameBounds },
      };
    } else {
      dragStateRef.current = {
        mode: "create",
        startPctX: px,
        startPctY: py,
        rectLeft: rect.left,
        rectTop: rect.top,
        rectW: rect.width,
        rectH: rect.height,
      };
      setDraftRect({ x: px, y: py, w: 0, h: 0 });
    }
    e.preventDefault();
  };

  const onCropKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!rawSize || !frameBounds) return;
    const step = event.shiftKey ? 10 : 1;
    const isArrow = [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
    ].includes(event.key);
    if (!isArrow) return;
    event.preventDefault();

    const next = { ...frameBounds };
    if (event.altKey) {
      if (event.key === "ArrowLeft") {
        next.width = Math.max(MIN_DIM, next.width - step);
      } else if (event.key === "ArrowRight") {
        next.width = Math.min(rawSize.w - next.x, next.width + step);
      } else if (event.key === "ArrowUp") {
        next.height = Math.max(MIN_DIM, next.height - step);
      } else if (event.key === "ArrowDown") {
        next.height = Math.min(rawSize.h - next.y, next.height + step);
      }
      syncOutputSize(next.width, next.height);
    } else {
      if (event.key === "ArrowLeft") next.x -= step;
      if (event.key === "ArrowRight") next.x += step;
      if (event.key === "ArrowUp") next.y -= step;
      if (event.key === "ArrowDown") next.y += step;
      next.x = Math.max(0, Math.min(rawSize.w - next.width, next.x));
      next.y = Math.max(0, Math.min(rawSize.h - next.height, next.y));
    }
    setManualCrop(next);
    setCropMode("manual");
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = dragStateRef.current;
      if (!s || !rawSize) return;
      const px = ((e.clientX - s.rectLeft) / s.rectW) * 100;
      const py = ((e.clientY - s.rectTop) / s.rectH) * 100;
      const cx = Math.max(0, Math.min(100, px));
      const cy = Math.max(0, Math.min(100, py));

      if (s.mode === "create") {
        const left = Math.min(s.startPctX, cx);
        const top = Math.min(s.startPctY, cy);
        setDraftRect({
          x: left,
          y: top,
          w: Math.abs(cx - s.startPctX),
          h: Math.abs(cy - s.startPctY),
        });
      } else {
        const dxNat = ((cx - s.startPctX) / 100) * rawSize.w;
        const dyNat = ((cy - s.startPctY) / 100) * rawSize.h;
        const maxX = rawSize.w - s.baseFrame.width;
        const maxY = rawSize.h - s.baseFrame.height;
        const newX = Math.max(0, Math.min(maxX, s.baseFrame.x + dxNat));
        const newY = Math.max(0, Math.min(maxY, s.baseFrame.y + dyNat));
        setManualCrop({
          x: newX,
          y: newY,
          width: s.baseFrame.width,
          height: s.baseFrame.height,
        });
        setCropMode("manual");
      }
    };
    const onUp = () => {
      const s = dragStateRef.current;
      if (!s || !rawSize) {
        dragStateRef.current = null;
        return;
      }
      const wasCreate = s.mode === "create";
      dragStateRef.current = null;
      if (!wasCreate) return;
      setDraftRect((current) => {
        if (!current) return null;
        const minPctW = (4 / Math.max(1, s.rectW)) * 100;
        const minPctH = (4 / Math.max(1, s.rectH)) * 100;
        if (current.w < minPctW || current.h < minPctH) return null;
        const natX = (current.x / 100) * rawSize.w;
        const natY = (current.y / 100) * rawSize.h;
        const natW = (current.w / 100) * rawSize.w;
        const natH = (current.h / 100) * rawSize.h;
        setManualCrop({ x: natX, y: natY, width: natW, height: natH });
        setCropMode("manual");
        syncOutputSize(natW, natH);
        return null;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [rawSize, syncOutputSize]);

  const clearCrop = () => {
    setManualCrop(null);
    setDraftRect(null);
    setAutoBounds(null);
    setCropMode("none");
  };

  const startManualCrop = () => {
    if (!rawSize) return;
    const insetX = rawSize.w * 0.1;
    const insetY = rawSize.h * 0.1;
    const inner = inscribeAspect(
      rawSize.w - insetX * 2,
      rawSize.h - insetY * 2,
      targetAspect,
    );
    const bounds = {
      ...inner,
      x: inner.x + insetX,
      y: inner.y + insetY,
    };
    setManualCrop(bounds);
    setDraftRect(null);
    setAutoBounds(null);
    setCropMode("manual");
    syncOutputSize(bounds.width, bounds.height);
  };

  const toggleAutoCrop = () => {
    setManualCrop(null);
    setDraftRect(null);
    setCropMode((prev) => (prev === "auto" ? "none" : "auto"));
  };

  const onWidthChange = (value: string) => {
    setWidthStr(value);
    if (!aspectLocked || !(lockedAspect > 0)) return;
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    setHeightStr(String(clampDim(Math.round(n / lockedAspect))));
  };

  const onHeightChange = (value: string) => {
    setHeightStr(value);
    if (!aspectLocked || !(lockedAspect > 0)) return;
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    setWidthStr(String(clampDim(Math.round(n * lockedAspect))));
  };

  const commitWidthBlur = () => {
    const n = Number.parseInt(widthStr, 10);
    const w = clampDim(Number.isFinite(n) ? n : MIN_DIM);
    setWidthStr(String(w));
    if (aspectLocked && lockedAspect > 0) {
      setHeightStr(String(clampDim(Math.round(w / lockedAspect))));
    }
  };

  const commitHeightBlur = () => {
    const n = Number.parseInt(heightStr, 10);
    const h = clampDim(Number.isFinite(n) ? n : MIN_DIM);
    setHeightStr(String(h));
    if (aspectLocked && lockedAspect > 0) {
      setWidthStr(String(clampDim(Math.round(h * lockedAspect))));
    }
  };

  const commitDpiBlur = () => {
    const n = Number.parseInt(dpiStr, 10);
    if (!Number.isFinite(n) || n < 1) setDpiStr("96");
    else if (n > 2400) setDpiStr("2400");
  };

  const toggleAspectLock = () => {
    if (aspectLocked) {
      setAspectLocked(false);
      return;
    }
    if (widthNum > 0 && heightNum > 0) {
      setLockedAspect(widthNum / heightNum);
    }
    setAspectLocked(true);
  };

  const handleFitView = () => {
    if (!app) return;
    const w = app.canvas.width;
    const h = app.canvas.height;
    syncOutputSize(w, h);
    setManualCrop(null);
    setDraftRect(null);
    setCropMode("none");
    void captureRef.current();
  };

  const displayFrame = useMemo<DraftRectPct | null>(() => {
    if (draftRect) return draftRect;
    if (!frameBounds || !rawSize) return null;
    return {
      x: (frameBounds.x / rawSize.w) * 100,
      y: (frameBounds.y / rawSize.h) * 100,
      w: (frameBounds.width / rawSize.w) * 100,
      h: (frameBounds.height / rawSize.h) * 100,
    };
  }, [draftRect, frameBounds, rawSize]);

  const previewAspect =
    rawSize && rawSize.w > 0 && rawSize.h > 0 ? rawSize.w / rawSize.h : 16 / 9;
  const retryCurrentOperation = saveOperation.feedback
    ? saveOperation.retry
    : cropOperation.feedback
      ? cropOperation.retry
      : captureOperation.retry;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        setOpen(next);
        if (!next) {
          captureOperation.reset();
          cropOperation.reset();
          saveOperation.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <ViewerIconAction icon={<Camera />} label="Screenshot" />
      </DialogTrigger>
      <DialogContent
        showCloseButton={!busy}
        className="flex aspect-[4/3] h-auto max-h-[calc(100vh-2rem)] w-[min(90vw,71.25rem,calc((100vh-2rem)*4/3))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogHeader className="shrink-0 px-4 py-3 border-b">
          <DialogTitle className="text-sm font-semibold">
            Screenshot
          </DialogTitle>
        </DialogHeader>

        <fieldset
          disabled={busy}
          aria-busy={busy}
          className="m-0 flex min-h-0 min-w-0 flex-1 gap-0 border-0 p-0"
        >
          <div
            className={cn(
              "relative flex min-w-0 flex-1 items-center justify-center overflow-hidden p-4",
              transparent ? "preview-transparency-grid" : "bg-white",
            )}
          >
            {capturing && !rawUrl ? (
              <div className="flex flex-col items-center gap-2 text-label text-preview-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                Capturing…
              </div>
            ) : rawUrl ? (
              <div
                className="relative select-none"
                style={{
                  lineHeight: 0,
                  aspectRatio: previewAspect,
                  maxWidth: "100%",
                  maxHeight: "100%",
                  width: "auto",
                  height: "auto",
                }}
              >
                <img
                  ref={imgRef}
                  src={rawUrl}
                  alt="Screenshot preview"
                  draggable={false}
                  onMouseDown={onPreviewMouseDown}
                  className="block w-full h-full cursor-crosshair"
                />
                {displayFrame && (
                  <>
                    <div
                      className="pointer-events-none absolute inset-0 bg-preview-scrim"
                      style={{
                        clipPath: `polygon(
                          0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
                          ${displayFrame.x}% ${displayFrame.y}%,
                          ${displayFrame.x}% ${displayFrame.y + displayFrame.h}%,
                          ${displayFrame.x + displayFrame.w}% ${displayFrame.y + displayFrame.h}%,
                          ${displayFrame.x + displayFrame.w}% ${displayFrame.y}%,
                          ${displayFrame.x}% ${displayFrame.y}%
                        )`,
                      }}
                    />
                    <button
                      type="button"
                      aria-label={`Adjust crop selection. X ${Math.round(frameBounds?.x ?? 0)}, Y ${Math.round(frameBounds?.y ?? 0)}, width ${Math.round(frameBounds?.width ?? 0)}, height ${Math.round(frameBounds?.height ?? 0)}. Arrow keys move; Alt plus arrow keys resize; hold Shift for 10 pixels.`}
                      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight"
                      className="absolute cursor-move border border-accent bg-transparent ring-1 ring-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      style={{
                        left: `${displayFrame.x}%`,
                        top: `${displayFrame.y}%`,
                        width: `${displayFrame.w}%`,
                        height: `${displayFrame.h}%`,
                      }}
                      onMouseDown={onPreviewMouseDown}
                      onKeyDown={onCropKeyDown}
                    />
                  </>
                )}
                {capturing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-preview-scrim-soft">
                    <Loader2 className="h-6 w-6 animate-spin text-preview-foreground" />
                  </div>
                )}
              </div>
            ) : (
              <div className="text-label text-preview-foreground">
                No preview
              </div>
            )}

            <div className="absolute bottom-3 left-3 rounded-control bg-preview-scrim-muted px-2 py-1 font-mono text-micro tracking-wide text-preview-foreground">
              {widthNum || "–"}×{heightNum || "–"}
            </div>

            {cropMode !== "none" && (
              <ViewerAction
                purpose="dismiss"
                className="absolute right-3 bottom-3"
                onClick={clearCrop}
                title="Clear crop"
              >
                <X />
                Clear
              </ViewerAction>
            )}
          </div>

          <div className="w-dialog-sidebar shrink-0 overflow-y-auto border-l">
            <Section title="Output">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-micro text-muted-foreground">
                      Width
                    </span>
                    <Input
                      aria-label="Screenshot width in pixels"
                      type="number"
                      min={MIN_DIM}
                      max={MAX_DIM}
                      value={widthStr}
                      onChange={(e) => onWidthChange(e.target.value)}
                      onBlur={commitWidthBlur}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          (e.target as HTMLInputElement).blur();
                      }}
                      className="h-control-compact text-xs flex-1 min-w-0"
                    />
                    <span className="text-micro text-muted-foreground">px</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-micro text-muted-foreground">
                      Height
                    </span>
                    <Input
                      aria-label="Screenshot height in pixels"
                      type="number"
                      min={MIN_DIM}
                      max={MAX_DIM}
                      value={heightStr}
                      onChange={(e) => onHeightChange(e.target.value)}
                      onBlur={commitHeightBlur}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          (e.target as HTMLInputElement).blur();
                      }}
                      className="h-control-compact text-xs flex-1 min-w-0"
                    />
                    <span className="text-micro text-muted-foreground">px</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-center justify-center gap-1 self-stretch">
                  <button
                    type="button"
                    aria-label={
                      aspectLocked ? "Unlock aspect ratio" : "Lock aspect ratio"
                    }
                    aria-pressed={aspectLocked}
                    title={
                      aspectLocked ? "Unlock aspect ratio" : "Lock aspect ratio"
                    }
                    className={cn(
                      "inline-flex size-7 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-interactive hover:text-foreground",
                      aspectLocked && "text-accent hover:text-accent",
                    )}
                    onClick={toggleAspectLock}
                  >
                    {aspectLocked ? (
                      <Link2 className="size-3.5" />
                    ) : (
                      <Link2Off className="size-3.5" />
                    )}
                  </button>
                  <span
                    className="font-mono text-micro tabular-nums text-muted-foreground"
                    title="Aspect ratio"
                  >
                    {formatAspectLabel(widthNum, heightNum)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-micro text-muted-foreground">
                  DPI
                </span>
                <Input
                  aria-label="Screenshot DPI"
                  type="number"
                  min={1}
                  max={2400}
                  value={dpiStr}
                  onChange={(e) => setDpiStr(e.target.value)}
                  onBlur={commitDpiBlur}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      (e.target as HTMLInputElement).blur();
                  }}
                  className="h-control-compact text-xs flex-1 min-w-0"
                />
              </div>
              <ViewerAction
                purpose="dismiss"
                className="w-full"
                onClick={handleFitView}
                disabled={busy || !app}
                title="Recapture at current viewport size"
              >
                {capturing ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                Fit view
              </ViewerAction>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="screenshot-transparent"
                  checked={transparent}
                  onCheckedChange={(v) => setTransparent(v === true)}
                  className="h-3.5 w-3.5"
                />
                <Label
                  htmlFor="screenshot-transparent"
                  className="cursor-pointer text-micro leading-none font-normal"
                >
                  Transparent
                </Label>
              </div>
            </Section>

            <Section title="Crop">
              <div className="flex gap-2">
                <ViewerAction
                  purpose="dismiss"
                  className="min-w-0 flex-1"
                  onClick={startManualCrop}
                  disabled={!rawSize || busy}
                  title="Drag on preview to set region · arrows move · Alt+arrows resize · Shift for 10px"
                >
                  <Crop />
                  Manual
                </ViewerAction>
                <ViewerToggleAction
                  selected={cropMode === "auto"}
                  className="min-w-0 flex-1"
                  onClick={toggleAutoCrop}
                  disabled={busy}
                  title="Trim to non-transparent content"
                >
                  <Crop />
                  Auto
                </ViewerToggleAction>
              </div>
            </Section>

            <Section title="Save">
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-micro text-muted-foreground">
                  Format
                </span>
                <Select value={format} onValueChange={onFormatChange}>
                  <SelectTrigger
                    aria-label="Screenshot format"
                    className="h-control-compact text-xs flex-1 min-w-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="png">PNG</SelectItem>
                    <SelectItem value="jpg">JPEG</SelectItem>
                    <SelectItem value="webp">WebP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-micro text-muted-foreground">
                  Name
                </span>
                <Input
                  aria-label="Screenshot filename"
                  value={filename}
                  onChange={(e) => onFilenameChange(e.target.value)}
                  className="h-control-compact text-xs font-mono flex-1 min-w-0"
                  spellCheck={false}
                />
              </div>
            </Section>

            {operationFeedback && (
              <div className="p-2">
                <ViewerOperationState
                  {...operationFeedback}
                  action={
                    operationFeedback.phase === "error" ? (
                      <ViewerAction
                        purpose="dismiss"
                        onClick={() => void retryCurrentOperation()}
                      >
                        Retry
                      </ViewerAction>
                    ) : undefined
                  }
                />
              </div>
            )}
          </div>
        </fieldset>

        <div className="flex shrink-0 justify-end gap-2 border-t px-4 py-3">
          <ViewerAction
            purpose="dismiss"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </ViewerAction>
          <ViewerAction onClick={handleSave} disabled={!rawUrl || busy}>
            <Download />
            {saveOperation.running
              ? "Saving…"
              : saveOperation.feedback?.phase === "success"
                ? "Save again…"
                : "Save…"}
          </ViewerAction>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div className="border-b last:border-b-0">
    <div className="px-2 py-1 text-micro uppercase tracking-wide font-semibold text-muted-foreground">
      {title}
    </div>
    <div className="px-2 pb-2 space-y-2">{children}</div>
  </div>
);
