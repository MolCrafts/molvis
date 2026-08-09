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

// ---------------------------------------------------------------------------
// Shareable deep links (so users never hand-build ?pdb= / ?url=)
// ---------------------------------------------------------------------------

/** A structure that can be re-opened via a public deep link. */
export type ShareableStructure =
  | { kind: "pdb"; pdbId: string }
  | { kind: "url"; url: string };

/** sessionStorage key for the last shareable structure loaded this tab. */
export const LAST_SHAREABLE_KEY = "molvis.lastShareable";

/**
 * Build a shareable MolVis deep link for an RCSB id or remote file URL.
 * Strips any existing structure query keys from `baseHref` first.
 */
export function buildShareUrl(
  share: ShareableStructure,
  baseHref: string = typeof window !== "undefined"
    ? window.location.href
    : "https://localhost/",
): string {
  const base = new URL(baseHref);
  for (const key of ["pdb", "id", "url", "structure", "shared"]) {
    base.searchParams.delete(key);
  }
  if (share.kind === "pdb") {
    base.searchParams.set("pdb", share.pdbId);
  } else {
    base.searchParams.set("url", share.url);
  }
  return base.toString();
}

/** Persist the last shareable structure for "Copy share link" in the toolbar. */
export function rememberShareable(share: ShareableStructure | null): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (!share) {
      sessionStorage.removeItem(LAST_SHAREABLE_KEY);
      return;
    }
    sessionStorage.setItem(LAST_SHAREABLE_KEY, JSON.stringify(share));
  } catch {
    // private mode / quota
  }
}

/** Read the last shareable structure from this tab, if any. */
export function readRememberedShareable(): ShareableStructure | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(LAST_SHAREABLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ShareableStructure;
    if (parsed?.kind === "pdb" && typeof parsed.pdbId === "string") {
      const id = normalizePdbId(parsed.pdbId);
      return id ? { kind: "pdb", pdbId: id } : null;
    }
    if (
      parsed?.kind === "url" &&
      typeof parsed.url === "string" &&
      /^https?:\/\//i.test(parsed.url)
    ) {
      return { kind: "url", url: parsed.url };
    }
  } catch {
    // corrupt
  }
  return null;
}

export interface ResolvedOpenInput {
  /** Remote fetch target for {@link fetchStructureFile}. */
  filename: string;
  url: string;
  /** Deep-link form others can re-open. */
  share: ShareableStructure;
}

/**
 * Parse free-form user input into a loadable + shareable structure.
 *
 * Accepts:
 * - 4-char PDB id (`1CRN`)
 * - absolute `http(s)` structure URL
 * - a full MolVis deep link that already carries `?pdb=` / `?url=`
 */
export function resolveOpenInput(raw: string): ResolvedOpenInput | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Full MolVis (or any) URL with our query params.
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
            share: { kind: "pdb", pdbId: id },
          };
        }
      }
      if (fromQuery?.kind === "url" && fromQuery.url) {
        return {
          filename: fromQuery.filename,
          url: fromQuery.url,
          share: { kind: "url", url: fromQuery.url },
        };
      }
      // Bare structure file URL (not a MolVis page).
      return {
        filename: filenameFromUrl(trimmed),
        url: trimmed,
        share: { kind: "url", url: trimmed },
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
      share: { kind: "pdb", pdbId: pdb },
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
 * Share a deep link via the Web Share API when available, else copy.
 * Returns `"shared" | "copied" | "failed"`.
 */
export async function shareOrCopyUrl(
  url: string,
  title = "MolVis structure",
): Promise<"shared" | "copied" | "failed"> {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function"
  ) {
    try {
      await navigator.share({ title, url, text: title });
      return "shared";
    } catch (err) {
      // User cancel is not a failure for our status bar.
      if (err instanceof DOMException && err.name === "AbortError") {
        return "failed";
      }
    }
  }
  const ok = await copyTextToClipboard(url);
  return ok ? "copied" : "failed";
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
