import {
  type CropBounds,
  cropToRect,
  findAlphaBounds,
  type Molvis,
  reencodeImage,
} from "@molvis/core";
import { Camera, Crop, Download, Loader2, RefreshCw, X } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, targetW, targetH);
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

  const [widthStr, setWidthStr] = useState("1920");
  const [heightStr, setHeightStr] = useState("1080");
  const [dpiStr, setDpiStr] = useState("96");
  const [transparent, setTransparent] = useState(true);

  const [format, setFormat] = useState<SaveFormat>("png");
  const [filename, setFilename] = useState("molvis-screenshot.png");

  const [cropMode, setCropMode] = useState<CropMode>("none");
  const [manualCrop, setManualCrop] = useState<CropBounds | null>(null);
  const [autoBounds, setAutoBounds] = useState<CropBounds | null>(null);

  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [rawSize, setRawSize] = useState<{ w: number; h: number } | null>(null);

  const [capturing, setCapturing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

  const captureViewport = useCallback(
    async (opts: { transparent: boolean }) => {
      if (!app) return;
      const canvas = app.canvas;
      const w = canvas.width;
      const h = canvas.height;
      setCapturing(true);
      setErrorMsg(null);
      try {
        const raw = await app.screenshot({
          width: w,
          height: h,
          transparentBackground: opts.transparent,
          format: "png",
          autoCrop: false,
        });
        setRawUrl(raw);
        setRawSize({ w, h });
        setManualCrop(null);
        setDraftRect(null);
        setAutoBounds(null);
        setCropMode("none");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Screenshot failed");
      } finally {
        setCapturing(false);
      }
    },
    [app],
  );

  const captureRef = useRef(captureViewport);
  captureRef.current = captureViewport;

  useEffect(() => {
    if (!open || !app) return;
    const canvas = app.canvas;
    setWidthStr(String(canvas.width));
    setHeightStr(String(canvas.height));
    setDpiStr("96");
    setTransparent(true);
    setCropMode("none");
    setManualCrop(null);
    setDraftRect(null);
    setAutoBounds(null);
    setRawUrl(null);
    setFormat("png");
    setFilename("molvis-screenshot.png");
    captureRef.current({ transparent: true });
  }, [open, app]);

  const onFormatChange = (value: string) => {
    const next = value as SaveFormat;
    setFormat(next);
    setFilename((current) => swapExtension(current, FORMAT_TO_EXT[next]));
  };

  const onFilenameChange = (value: string) => {
    setFilename(value);
    const ext = value.match(/\.([a-z0-9]+)$/i)?.[1];
    if (!ext) return;
    const matched = formatFromExt(ext);
    if (matched && matched !== format) setFormat(matched);
  };

  const transparentPrev = useRef(transparent);
  useEffect(() => {
    if (!open) {
      transparentPrev.current = transparent;
      return;
    }
    if (transparentPrev.current === transparent) return;
    transparentPrev.current = transparent;
    if (!transparent && cropMode === "auto") setCropMode("none");
    captureRef.current({ transparent });
  }, [transparent, open, cropMode]);

  useEffect(() => {
    if (cropMode !== "auto" || !rawUrl) {
      setAutoBounds(null);
      return;
    }
    let cancelled = false;
    computeAutoBounds(rawUrl, AUTO_CROP_PADDING)
      .then((bounds) => {
        if (cancelled) return;
        setAutoBounds(bounds);
        if (bounds) {
          setWidthStr(String(Math.round(bounds.width)));
          setHeightStr(String(Math.round(bounds.height)));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : "Auto-crop failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cropMode, rawUrl]);

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
      let dataUrl: string;
      if (frameBounds) {
        const cropped = await cropToRect(rawUrl, frameBounds, "image/png", 1);
        dataUrl = await resampleToSize(cropped, W, H, mime, 0.92);
      } else if (mime === "image/png") {
        dataUrl = rawUrl;
      } else {
        dataUrl = await reencodeImage(rawUrl, mime, 0.92);
      }
      let blob = await dataUrlToBlob(dataUrl);
      blob = await embedDpi(blob, mime, dpiNum);
      return blob;
    },
    [rawUrl, rawSize, frameBounds, widthNum, heightNum, dpiNum],
  );

  const handleSave = async () => {
    if (!rawUrl) return;
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

    if (typeof anyWin.showSaveFilePicker === "function") {
      try {
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
        setOpen(false);
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setErrorMsg(err instanceof Error ? err.message : "Save failed");
      }
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
    setOpen(false);
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
        setWidthStr(String(Math.round(natW)));
        setHeightStr(String(Math.round(natH)));
        return null;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [rawSize]);

  const clearCrop = () => {
    setManualCrop(null);
    setDraftRect(null);
    setAutoBounds(null);
    setCropMode("none");
  };

  const toggleAutoCrop = () => {
    setManualCrop(null);
    setDraftRect(null);
    setCropMode((prev) => (prev === "auto" ? "none" : "auto"));
  };

  const commitWidthBlur = () => {
    const n = Number.parseInt(widthStr, 10);
    const clamped = clampDim(Number.isFinite(n) ? n : MIN_DIM);
    setWidthStr(String(clamped));
  };
  const commitHeightBlur = () => {
    const n = Number.parseInt(heightStr, 10);
    const clamped = clampDim(Number.isFinite(n) ? n : MIN_DIM);
    setHeightStr(String(clamped));
  };
  const commitDpiBlur = () => {
    const n = Number.parseInt(dpiStr, 10);
    if (!Number.isFinite(n) || n < 1) setDpiStr("96");
    else if (n > 2400) setDpiStr("2400");
  };

  const handleMatchViewport = () => {
    if (!app) return;
    const w = app.canvas.width;
    const h = app.canvas.height;
    setWidthStr(String(w));
    setHeightStr(String(h));
    setManualCrop(null);
    setDraftRect(null);
    setCropMode("none");
    captureRef.current({ transparent });
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7"
              aria-label="Screenshot"
            >
              <Camera className="h-3.5 w-3.5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Screenshot</TooltipContent>
      </Tooltip>
      <DialogContent className="max-w-[1140px] p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="text-sm font-semibold">
            Screenshot
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-0 h-[680px]">
          <div className="flex-1 min-w-0 bg-[linear-gradient(45deg,#2a2a2a_25%,transparent_25%),linear-gradient(-45deg,#2a2a2a_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#2a2a2a_75%),linear-gradient(-45deg,transparent_75%,#2a2a2a_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0] bg-neutral-800 relative flex items-center justify-center p-4 overflow-hidden">
            {capturing && !rawUrl ? (
              <div className="flex flex-col items-center gap-2 text-white/80 text-xs">
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
                      className="absolute inset-0 bg-black/50 pointer-events-none"
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
                    <div
                      className="absolute border border-primary ring-1 ring-primary/40 cursor-move"
                      style={{
                        left: `${displayFrame.x}%`,
                        top: `${displayFrame.y}%`,
                        width: `${displayFrame.w}%`,
                        height: `${displayFrame.h}%`,
                      }}
                      onMouseDown={onPreviewMouseDown}
                    />
                  </>
                )}
                {capturing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <Loader2 className="h-6 w-6 animate-spin text-white/80" />
                  </div>
                )}
              </div>
            ) : errorMsg ? (
              <div className="text-destructive text-xs">{errorMsg}</div>
            ) : (
              <div className="text-white/60 text-xs">No preview</div>
            )}

            <div className="absolute left-3 bottom-3 text-[10px] text-white/70 tracking-wide font-mono bg-black/40 px-2 py-0.5 rounded space-x-2">
              <span>
                Output {widthNum || "–"} × {heightNum || "–"}
              </span>
              {rawSize && (
                <span className="opacity-60">
                  viewport {rawSize.w}×{rawSize.h}
                </span>
              )}
              {cropMode !== "none" && (
                <span className="opacity-60">(crop: {cropMode})</span>
              )}
            </div>

            {cropMode !== "none" && (
              <Button
                variant="secondary"
                size="sm"
                className="absolute right-3 bottom-3 h-6 text-[10px] gap-1"
                onClick={clearCrop}
              >
                <X className="h-3 w-3" />
                Clear crop
              </Button>
            )}
          </div>

          <div className="w-[280px] shrink-0 border-l overflow-y-auto">
            <Section title="Output">
              <div className="flex items-center gap-1.5">
                <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
                  Width
                </span>
                <Input
                  type="number"
                  min={MIN_DIM}
                  max={MAX_DIM}
                  value={widthStr}
                  onChange={(e) => setWidthStr(e.target.value)}
                  onBlur={commitWidthBlur}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      (e.target as HTMLInputElement).blur();
                  }}
                  className="h-7 text-xs flex-1 min-w-0"
                />
                <span className="text-[10px] text-muted-foreground">px</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
                  Height
                </span>
                <Input
                  type="number"
                  min={MIN_DIM}
                  max={MAX_DIM}
                  value={heightStr}
                  onChange={(e) => setHeightStr(e.target.value)}
                  onBlur={commitHeightBlur}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      (e.target as HTMLInputElement).blur();
                  }}
                  className="h-7 text-xs flex-1 min-w-0"
                />
                <span className="text-[10px] text-muted-foreground">px</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
                  DPI
                </span>
                <Input
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
                  className="h-7 text-xs flex-1 min-w-0"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs w-full gap-1"
                onClick={handleMatchViewport}
                disabled={capturing || !app}
                title="Recapture using the current camera view at viewport size"
              >
                {capturing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Match viewport
              </Button>
              <div className="flex items-center justify-between gap-2 text-xs">
                <Label
                  htmlFor="screenshot-transparent"
                  className="text-muted-foreground text-[10px] font-normal"
                >
                  Transparent background
                </Label>
                <Switch
                  id="screenshot-transparent"
                  checked={transparent}
                  onCheckedChange={(v) => setTransparent(Boolean(v))}
                />
              </div>
            </Section>

            <Section title="Crop">
              <Button
                variant={cropMode === "auto" ? "secondary" : "outline"}
                size="sm"
                className="h-7 text-xs w-full gap-1"
                onClick={toggleAutoCrop}
                disabled={!transparent}
                title={
                  transparent
                    ? "Trim to non-transparent content"
                    : "Enable transparent background to auto-crop"
                }
              >
                <Crop className="h-3 w-3" />
                Auto-crop
              </Button>
              <p className="text-[10px] text-muted-foreground px-0.5 leading-snug">
                Drag on the preview to define a custom crop region. Width and
                height update to match.
              </p>
            </Section>

            <Section title="Save">
              <div className="flex items-center gap-1.5">
                <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
                  Format
                </span>
                <Select value={format} onValueChange={onFormatChange}>
                  <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="png">PNG</SelectItem>
                    <SelectItem value="jpg">JPEG</SelectItem>
                    <SelectItem value="webp">WebP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
                  Name
                </span>
                <Input
                  value={filename}
                  onChange={(e) => onFilenameChange(e.target.value)}
                  className="h-7 text-xs font-mono flex-1 min-w-0"
                  spellCheck={false}
                />
              </div>
            </Section>

            {errorMsg && (
              <div className="px-2 py-1 text-[10px] text-destructive">
                {errorMsg}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={handleSave}
            disabled={!rawUrl || capturing}
          >
            <Download className="h-3 w-3" />
            Save…
          </Button>
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
    <div className="px-2 py-1 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
      {title}
    </div>
    <div className="px-2 pb-1.5 space-y-1.5">{children}</div>
  </div>
);
