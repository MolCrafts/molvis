/**
 * Single host ↔ webview postMessage protocol for the MolVis VS Code extension.
 *
 * Stage and Sketch editor tabs share this protocol with Quick look.
 * Never a second schema in `page/`.
 *
 * This module is **host-safe**: no stage runtime imports, so the extension
 * host bundle and unit tests can load it without pulling Babylon/WASM.
 *
 * `FileFormat` / `LoadMode` must stay equal to stage's unions
 * (`stage/src/io/formats.ts`, `stage/src/io/index.ts`). Runtime format
 * inference still uses `@molcrafts/molvis-stage/io/formats` (`FILE_FORMAT_REGISTRY`).
 */

/**
 * Which chrome the page shell should show.
 *
 * Structurally re-declared rather than imported: this module is host-safe and
 * must not pull the page runtime. Unlike `FileFormat` / `LoadMode`, which rely
 * on the `@see` convention alone, this one is pinned at compile time.
 * @see vsc-ext/src/webview/attachPageHost.ts `_SurfaceLockstep`
 * @see page/src/lib/mount-opts.ts `MolvisSurface` — keep in lockstep.
 */
export const PAGE_SURFACES = ["full", "canvas"] as const;
export type PageSurface = (typeof PAGE_SURFACES)[number];

/**
 * Molecular file format ids.
 * @see stage/src/io/formats.ts `FileFormat` — keep in lockstep.
 */
export type FileFormat =
  | "pdb"
  | "xyz"
  | "cif"
  | "lammps"
  | "lammps-dump"
  | "sdf"
  | "dcd"
  | "cube"
  | "chgcar"
  | "gro"
  | "mol2"
  | "poscar"
  | "trr"
  | "xtc";

/**
 * How a `loadFile` combines with the scene already in the webview.
 * @see stage/src/io/index.ts `LoadMode`
 */
export type LoadMode = "replace" | "augment" | "extend";

/**
 * Payload for `loadFile`:
 * - `string` — decoded text for small/eager loads
 * - `Uint8Array` — raw bytes for streaming trajectories and binary formats
 * - `Record` — mrec (zarr) directory, store path → raw bytes. The host posts
 *   typed arrays (VS Code's serializer moves them as buffers, no base64);
 *   base64 `string` values are still accepted during the transition.
 */
export type MolecularFilePayload =
  | string
  | Uint8Array
  | Record<string, Uint8Array | string>;

/**
 * Hierarchy node for the native Structure Outline tree.
 * Mirrors `stage/src/system/structure_outline.ts`: a node lists only the
 * atoms it owns, and a group says how many it covers (plus a range when the
 * cover is contiguous) instead of repeating its children's indices.
 */
export type StructureOutlineNode = {
  id: string;
  label: string;
  kind: "chain" | "residue" | "atom" | "source";
  /** Atoms owned directly by this node. Absent on pure group nodes. */
  atomIndices?: number[];
  /** Atoms covered, listed or not. */
  atomCount: number;
  /** Contiguous `[start, end)` cover, when the node has one. */
  atomRange?: { start: number; end: number };
  children?: StructureOutlineNode[];
};

export type StructureOutlinePayload = {
  filename?: string;
  roots: StructureOutlineNode[];
};

/** Host → webview (stage surfaces). */
export type HostToWebviewMessage =
  | {
      type: "init";
      config?: unknown;
      settings?: unknown;
      /**
       * Chrome the page shell should start with. Absent for the stage-only
       * surfaces, which have no chrome to switch. Riding `init` — the first
       * message a host can send — is what stops the page painting full chrome
       * and then correcting itself.
       */
      surface?: PageSurface;
    }
  | { type: "applySettings"; config?: unknown; settings?: unknown }
  /**
   * Switch the page shell's chrome on a running webview.
   *
   * The run-time counterpart of `init.surface`: `init` sets the surface a
   * panel opens with, this changes it in place. Promotion is therefore a
   * message, not a new webview — the parsed frame stays in wasm memory where
   * it already is.
   */
  | { type: "setSurface"; surface: PageSurface }
  | {
      type: "loadFile";
      content: MolecularFilePayload;
      filename: string;
      format?: FileFormat;
      mode?: LoadMode;
      /**
       * When true, `content` is raw bytes (`Uint8Array`) for the streaming
       * worker path (large trajectories). Avoids V8 string-length caps.
       */
      stream?: boolean;
    }
  | { type: "triggerSave" }
  | { type: "error"; message: string }
  | {
      type: "selectAtoms";
      /** Explicit rows. */
      indices?: number[];
      /** Contiguous rows `[start, end)` — whole-frame select in two numbers. */
      range?: { start: number; end: number };
    }
  | { type: "enableCapability"; id: string; opts?: unknown }
  | { type: "disableCapability"; id: string }
  | {
      type: "openUri";
      uri: string;
      filename: string;
      format: FileFormat;
      /** Source size in bytes. */
      size: number;
      /** File mtime in milliseconds. */
      mtime: number;
      mode?: LoadMode;
      /** Optional prebuilt .molidx v2 bytes (Remote index-near-data). */
      index?: Uint8Array;
    }
  | {
      type: "bytes";
      fetchId: number;
      data: Uint8Array | null;
      error?: string;
    }
  /**
   * Host-side load lifecycle, sent around the payload itself: `"reading"`
   * before the host reads the file and ships `loadFile`/`openUri`,
   * `"cancelled"` if it never gets that far (format picker dismissed, read
   * failed). The read plus the wire hop can take seconds on Remote-SSH, and
   * until the payload lands the webview has nothing to show but an empty
   * scene.
   */
  | {
      type: "loadPhase";
      phase: "reading" | "cancelled";
      filename: string;
      bytes?: number;
    };

/** Webview → host. */
export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "saveFile"; data: string; suggestedName: string }
  | { type: "dropUri"; uri: string; mode?: LoadMode }
  | { type: "dirtyStateChanged"; isDirty: boolean }
  /**
   * The user asked for a different surface from inside the canvas.
   *
   * Intent, not state: the host owns the surface bit, so it records this and
   * answers with `setSurface`. That keeps the tab title and the replayed
   * `init` in step with what the user sees.
   */
  | { type: "surfaceChanged"; surface: PageSurface }
  | { type: "error"; message: string }
  | { type: "structureOutline"; outline: StructureOutlinePayload }
  | {
      type: "capabilityState";
      id: string;
      status: "loading" | "ready" | "error" | "disabled";
      message?: string;
    }
  | {
      type: "readRange";
      uri: string;
      /** Inclusive start byte. */
      start: number;
      /** Exclusive end byte. */
      end: number;
      fetchId: number;
    }
  | { type: "cancelRange"; fetchId: number }
  /**
   * How long the webview itself spent on the load that just finished
   * (decode + parse + scene build). The host subtracts it from its own
   * round trip to name the host→webview transfer, which on Remote-SSH is
   * the part that crosses the network.
   */
  | { type: "loadStats"; filename: string; webviewMs: number };

/** Message types handled by Quick look (stage-only surface). */
export const QUICK_VIEW_HOST_MESSAGE_TYPES = [
  "init",
  "applySettings",
  "loadFile",
  "loadPhase",
  "triggerSave",
  "error",
  "selectAtoms",
  "openUri",
  "bytes",
] as const;

export type QuickViewHostMessageType =
  (typeof QUICK_VIEW_HOST_MESSAGE_TYPES)[number];

const QUICK_VIEW_HOST_TYPE_SET = new Set<string>(QUICK_VIEW_HOST_MESSAGE_TYPES);

function isTypedHostMessage(
  data: unknown,
  allowed: Set<string>,
): data is HostToWebviewMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    typeof (data as { type: unknown }).type === "string" &&
    allowed.has((data as { type: string }).type)
  );
}

/**
 * The surface a host message declares, or `null` when it declares none.
 *
 * `null` rather than a default: the default belongs to the page, so a host
 * that stays silent leaves the current surface alone.
 */
export function hostSurfaceOf(
  message: HostToWebviewMessage,
): PageSurface | null {
  if (message.type !== "init" && message.type !== "setSurface") return null;
  const surface = message.surface;
  return surface !== undefined &&
    (PAGE_SURFACES as readonly string[]).includes(surface)
    ? surface
    : null;
}

/**
 * Message types the page surface accepts: the Quick look set plus the chrome
 * switch. Derived, so a type added for Quick look reaches the page too.
 *
 * `attachPageHost` must pass the matching guard — `attachStageHost` defaults to
 * the Quick look one, which drops `setSurface` in its window listener before
 * any observer runs.
 */
export const PAGE_HOST_MESSAGE_TYPES = [
  ...QUICK_VIEW_HOST_MESSAGE_TYPES,
  "setSurface",
] as const;

const PAGE_HOST_TYPE_SET = new Set<string>(PAGE_HOST_MESSAGE_TYPES);

/** Type guard for host → webview messages that the page surface accepts. */
export function isPageHostMessage(data: unknown): data is HostToWebviewMessage {
  return isTypedHostMessage(data, PAGE_HOST_TYPE_SET);
}

/** Type guard for host → webview messages that Quick look accepts. */
export function isQuickViewHostMessage(
  data: unknown,
): data is HostToWebviewMessage {
  return isTypedHostMessage(data, QUICK_VIEW_HOST_TYPE_SET);
}
