/**
 * Frontend video export for turntable rotations.
 *
 * Records the live canvas in real time via `canvas.captureStream` +
 * MediaRecorder while the turntable plays. This avoids per-frame GPU
 * readback (which blocks the main thread and freezes the UI for large
 * canvases) — the compositor harvests frames the GPU already drew, so the
 * UI stays responsive and the orbit records smoothly. Output is WebM (the
 * format MediaRecorder supports across Chromium/Firefox). Encoding lives in
 * the frontend so the core engine stays free of media dependencies.
 */

import type { Molvis } from "@molcrafts/molvis-stage";

const WEBM_MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

function pickMimeType(): string {
  for (const mime of WEBM_MIME_CANDIDATES) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(mime)
    ) {
      return mime;
    }
  }
  return "video/webm";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Revoke on the next tick so the click has consumed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** True when the browser can record a canvas (MediaRecorder + captureStream). */
export function canEncodeVideo(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function"
  );
}

/**
 * Record a turntable rotation of the current scene to a WebM video and
 * download it. Real-time: the turntable plays through the animation camera
 * while the canvas stream is recorded, so wall-clock duration equals
 * `opts.duration` seconds and the UI never blocks.
 *
 * @param opts.duration Seconds of footage (one full cycle of the turntable).
 * @param opts.revolutions Whole turns over the duration.
 * @param opts.fps Capture frame rate.
 * @param opts.filename Download name; defaults to `molvis-turntable.webm`.
 */
export async function recordTurntableVideo(
  app: Molvis,
  opts: {
    duration: number;
    revolutions: number;
    fps: number;
    filename?: string;
  },
): Promise<void> {
  const canvas = app.world.scene.getEngine().getRenderingCanvas();
  if (!canvas || !canEncodeVideo()) {
    throw new Error("Video recording is not supported in this browser");
  }

  const animator = app.world.cameraAnimator;
  const mimeType = pickMimeType();
  const stream = canvas.captureStream(opts.fps);
  const recorder = new MediaRecorder(stream, { mimeType });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  animator.play(
    animator.buildTurntable({
      duration: opts.duration,
      revolutions: opts.revolutions,
    }),
  );
  recorder.start();
  try {
    await sleep(opts.duration * 1000);
  } finally {
    recorder.stop();
    animator.stop();
  }
  await stopped;

  triggerDownload(
    new Blob(chunks, { type: mimeType }),
    opts.filename ?? "molvis-turntable.webm",
  );
}
