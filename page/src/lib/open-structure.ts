/**
 * Standalone open-structure ingress helpers.
 *
 * Resolves a structure source from URL query params, a Web Share Target
 * hand-off, or the File Handling launch queue — without depending on React
 * or the engine. The page shell turns the result into a `File` and feeds
 * {@link loadFileSmart}.
 */

/** RCSB download base (CORS-enabled for browser fetch). */
export const RCSB_DOWNLOAD_BASE = "https://files.rcsb.org/download";

export type StructureSourceKind = "url" | "pdb" | "shared" | "launch";

export interface StructureSource {
  kind: StructureSourceKind;
  /** Display / inferred filename. */
  filename: string;
  /** Remote fetch URL when kind is url or pdb. */
  url?: string;
  /** Pre-materialized file (share target / launch queue). */
  file?: File;
}

const PDB_ID_RE = /^[0-9][A-Za-z0-9]{3}$/;

/**
 * Normalize a PDB / mmCIF accession (strips whitespace; uppercases).
 * Returns null when the token is not a 4-char RCSB id.
 */
export function normalizePdbId(raw: string): string | null {
  const id = raw.trim().toUpperCase();
  return PDB_ID_RE.test(id) ? id : null;
}

/** Build the RCSB download URL for a PDB id (`.pdb` format). */
export function rcsbPdbUrl(pdbId: string): string {
  return `${RCSB_DOWNLOAD_BASE}/${pdbId.toUpperCase()}.pdb`;
}

/**
 * Guess a download filename from a URL path, falling back to `structure.pdb`.
 */
export function filenameFromUrl(
  url: string,
  fallback = "structure.pdb",
): string {
  try {
    const path = new URL(url).pathname;
    const base = path.split("/").pop() || "";
    if (base?.includes(".")) return decodeURIComponent(base);
  } catch {
    // not a valid absolute URL
  }
  return fallback;
}

/**
 * Read structure open intents from a query-string map.
 *
 * Supported params (first match wins):
 * - `pdb` / `id` — 4-char RCSB accession → download `.pdb`
 * - `url` / `structure` — absolute http(s) URL to a structure file
 * - `shared=1` — signal that the SW stashed a share-target file
 */
export function parseStructureSourceFromParams(
  params: URLSearchParams,
): StructureSource | null {
  const pdbRaw = params.get("pdb") ?? params.get("id");
  if (pdbRaw) {
    const id = normalizePdbId(pdbRaw);
    if (id) {
      return {
        kind: "pdb",
        filename: `${id}.pdb`,
        url: rcsbPdbUrl(id),
      };
    }
  }

  const remote = params.get("url") ?? params.get("structure");
  if (remote) {
    const trimmed = remote.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return {
        kind: "url",
        filename: filenameFromUrl(trimmed),
        url: trimmed,
      };
    }
  }

  if (params.get("shared") === "1") {
    return { kind: "shared", filename: "shared-structure" };
  }

  return null;
}

export interface ResolvedOpenInput {
  /** Remote fetch target for {@link fetchStructureFile}. */
  filename: string;
  url: string;
}

/**
 * Parse free-form user input into a loadable structure.
 *
 * Accepts:
 * - 4-char PDB id (`1CRN`)
 * - absolute `http(s)` structure URL
 * - a page URL that already carries `?pdb=` / `?url=`
 */
export function resolveOpenInput(raw: string): ResolvedOpenInput | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const asPage = new URL(trimmed);
      const fromQuery = parseStructureSourceFromParams(asPage.searchParams);
      if (fromQuery?.kind === "pdb" && fromQuery.url) {
        const id = normalizePdbId(
          asPage.searchParams.get("pdb") ?? asPage.searchParams.get("id") ?? "",
        );
        if (id) {
          return {
            filename: `${id}.pdb`,
            url: rcsbPdbUrl(id),
          };
        }
      }
      if (fromQuery?.kind === "url" && fromQuery.url) {
        return {
          filename: fromQuery.filename,
          url: fromQuery.url,
        };
      }
      return {
        filename: filenameFromUrl(trimmed),
        url: trimmed,
      };
    } catch {
      return null;
    }
  }

  const pdb = normalizePdbId(trimmed);
  if (pdb) {
    return {
      filename: `${pdb}.pdb`,
      url: rcsbPdbUrl(pdb),
    };
  }

  return null;
}

/** Copy text to the clipboard; returns false when the API is unavailable. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Strip open-structure query keys from the current URL without reloading.
 * Keeps other mount opts (`ws_url`, `theme`, …).
 */
export function stripStructureParamsFromLocation(
  search: string = typeof window !== "undefined" ? window.location.search : "",
  replaceState: (url: string) => void = (url) => {
    if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", url);
    }
  },
): void {
  const params = new URLSearchParams(search);
  let changed = false;
  for (const key of ["pdb", "id", "url", "structure", "shared"]) {
    if (params.has(key)) {
      params.delete(key);
      changed = true;
    }
  }
  if (!changed) return;
  const qs = params.toString();
  const path =
    typeof window !== "undefined"
      ? `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`
      : qs
        ? `?${qs}`
        : "";
  replaceState(path);
}

/**
 * Fetch a remote structure and wrap it as a `File` for the standard ingress.
 * Throws on non-OK HTTP or empty body.
 */
export async function fetchStructureFile(
  url: string,
  filename: string,
  fetchImpl: typeof fetch = fetch,
): Promise<File> {
  const res = await fetchImpl(url, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    // Avoid accidental HTML error pages being parsed as PDB.
    headers: {
      Accept: "text/plain, chemical/*, application/octet-stream, */*",
    },
  });
  if (!res.ok) {
    throw new Error(`Could not download ${filename} (HTTP ${res.status})`);
  }
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new Error(`Downloaded file is empty: ${filename}`);
  }
  const type = res.headers.get("content-type") || "application/octet-stream";
  return new File([buffer], filename, { type, lastModified: Date.now() });
}

// ---------------------------------------------------------------------------
// Share-target hand-off (SW → page via IndexedDB)
// ---------------------------------------------------------------------------

const SHARE_DB = "molvis-share-target";
const SHARE_STORE = "files";
const SHARE_KEY = "pending";

interface StashedShare {
  name: string;
  type: string;
  lastModified: number;
  /** Stored as a Blob/File by the SW. */
  buffer: Blob;
}

function openShareDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SHARE_STORE)) {
        db.createObjectStore(SHARE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

/**
 * Consume a file stashed by the service worker for Web Share Target.
 * Returns null when nothing is pending. Deletes the entry on success.
 */
export async function takeSharedStructureFile(): Promise<File | null> {
  if (typeof indexedDB === "undefined") return null;
  let db: IDBDatabase;
  try {
    db = await openShareDb();
  } catch {
    return null;
  }

  const record = await new Promise<StashedShare | null>((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE, "readwrite");
    const store = tx.objectStore(SHARE_STORE);
    const getReq = store.get(SHARE_KEY);
    getReq.onsuccess = () => {
      const value = getReq.result as StashedShare | undefined;
      if (value) store.delete(SHARE_KEY);
      resolve(value ?? null);
    };
    getReq.onerror = () => reject(getReq.error);
  }).catch(() => null);

  db.close();
  if (!record?.buffer) return null;
  const name = record.name || "shared-structure.pdb";
  return new File([record.buffer], name, {
    type: record.type || "application/octet-stream",
    lastModified: record.lastModified || Date.now(),
  });
}

// ---------------------------------------------------------------------------
// File Handling API (launchQueue)
// ---------------------------------------------------------------------------

interface LaunchParamsLike {
  files?: ReadonlyArray<{ getFile(): Promise<File> }>;
}

/**
 * Register a one-shot consumer for OS file opens (installed PWA on
 * Chromium). Calls `onFile` for the first file of each launch.
 * No-ops when `launchQueue` is unavailable.
 */
export function bindLaunchQueue(
  onFile: (file: File) => void | Promise<void>,
): () => void {
  const w = typeof window !== "undefined" ? window : undefined;
  const queue = (
    w as Window & {
      launchQueue?: {
        setConsumer: (cb: (params: LaunchParamsLike) => void) => void;
      };
    }
  )?.launchQueue;
  if (!queue?.setConsumer) return () => {};

  let cancelled = false;
  queue.setConsumer((params) => {
    if (cancelled) return;
    const handles = params.files ?? [];
    void (async () => {
      for (const handle of handles) {
        try {
          const file = await handle.getFile();
          if (cancelled) return;
          await onFile(file);
          return; // one file per open is enough for MolVis
        } catch (err) {
          console.warn("[molvis] launchQueue file failed", err);
        }
      }
    })();
  });

  return () => {
    cancelled = true;
  };
}
