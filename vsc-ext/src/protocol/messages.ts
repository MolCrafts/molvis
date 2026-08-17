/**
 * Single host ↔ webview postMessage protocol for the MolVis VS Code extension.
 *
 * Quick View is the normative consumer (stage-only). Workbench will be a
 * strict superset (capability messages) of this same module — never a
 * second schema in `page/` or a parallel host bridge.
 *
 * This module is **host-safe**: no stage runtime imports, so the extension
 * host bundle and unit tests can load it without pulling Babylon/WASM.
 *
 * `FileFormat` / `LoadMode` must stay equal to stage's unions
 * (`stage/src/io/formats.ts`, `stage/src/io/index.ts`). Runtime format
 * inference still uses `@molcrafts/molvis-stage/io/formats` (`FILE_FORMAT_REGISTRY`).
 */

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
 * - `Record` — zarr directory (name → text)
 */
export type MolecularFilePayload = string | Uint8Array | Record<string, string>;

/** Hierarchy node for the native Structure Outline tree (Workbench). */
export type StructureOutlineNode = {
  id: string;
  label: string;
  kind: "chain" | "residue" | "atom" | "source";
  atomIndices?: number[];
  children?: StructureOutlineNode[];
};

export type StructureOutlinePayload = {
  filename?: string;
  roots: StructureOutlineNode[];
};

/** Engines the Workbench can host (peers). */
export type WorkbenchSurface = "stage" | "sketch";

/** Host → webview. QV understands the core set; Workbench adds capability. */
export type HostToWebviewMessage =
  | {
      type: "init";
      config?: unknown;
      settings?: unknown;
    }
  | { type: "applySettings"; config?: unknown; settings?: unknown }
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
  | { type: "selectAtoms"; indices: number[] }
  | { type: "enableCapability"; id: string; opts?: unknown }
  | { type: "disableCapability"; id: string }
  /** Workbench: show stage (3D) or sketch (2D) pane. */
  | { type: "setWorkbenchSurface"; surface: WorkbenchSurface };

/** Webview → host. */
export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "saveFile"; data: string; suggestedName: string }
  | { type: "dropUri"; uri: string }
  | { type: "dirtyStateChanged"; isDirty: boolean }
  | { type: "error"; message: string }
  | { type: "structureOutline"; outline: StructureOutlinePayload }
  | {
      type: "capabilityState";
      id: string;
      status: "loading" | "ready" | "error" | "disabled";
      message?: string;
    };

/** Message types handled by Quick View (stage-only surface). */
export const QUICK_VIEW_HOST_MESSAGE_TYPES = [
  "init",
  "applySettings",
  "loadFile",
  "triggerSave",
  "error",
] as const;

export type QuickViewHostMessageType =
  (typeof QUICK_VIEW_HOST_MESSAGE_TYPES)[number];

/** Quick View set + Workbench-only messages. */
export const WORKBENCH_HOST_MESSAGE_TYPES = [
  ...QUICK_VIEW_HOST_MESSAGE_TYPES,
  "selectAtoms",
  "enableCapability",
  "disableCapability",
  "setWorkbenchSurface",
] as const;

export type WorkbenchHostMessageType =
  (typeof WORKBENCH_HOST_MESSAGE_TYPES)[number];

const QUICK_VIEW_HOST_TYPE_SET = new Set<string>(QUICK_VIEW_HOST_MESSAGE_TYPES);
const WORKBENCH_HOST_TYPE_SET = new Set<string>(WORKBENCH_HOST_MESSAGE_TYPES);

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

/** Type guard for host → webview messages that Quick View accepts. */
export function isQuickViewHostMessage(
  data: unknown,
): data is HostToWebviewMessage {
  return isTypedHostMessage(data, QUICK_VIEW_HOST_TYPE_SET);
}

/** Type guard for host → webview messages that Workbench accepts. */
export function isWorkbenchHostMessage(
  data: unknown,
): data is HostToWebviewMessage {
  return isTypedHostMessage(data, WORKBENCH_HOST_TYPE_SET);
}
