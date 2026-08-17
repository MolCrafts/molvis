import { getPluginHostModules, type PluginHostModules } from "./host_shared";
import type { MolvisPluginModule, PluginManifest } from "./types";

let importMapReady = false;
let pluginHostModules: PluginHostModules | undefined;
/**
 * Bare host specifier → blob URL. These are process-wide singletons shared by
 * every plugin, created once, and are deliberately never revoked.
 */
const moduleBlobUrls = new Map<string, string>();
/** Absolute source URL → rewritten blob URL (supports multi-chunk graphs). */
const rewrittenModuleBlobs = new Map<string, string>();
/** In-flight rewrite promises for cycle-safe parallel loads. */
const rewriteInFlight = new Map<string, Promise<string>>();
/**
 * Entry URL → every chunk URL its graph pulled in, so unload can revoke them.
 *
 * Without this the rewritten blobs lived forever: each reload leaked a full
 * copy of the plugin's chunks, and the stale cache entry meant "Reload" also
 * re-imported the *old* source instead of re-fetching.
 */
const graphChunks = new Map<string, Set<string>>();

function buildModuleBlob(
  spec: string,
  exports: Record<string, unknown>,
): string {
  const existing = moduleBlobUrls.get(spec);
  if (existing) return existing;

  const hostKey = `__MOLVIS_PLUGIN_HOST_MODULES__`;
  const g = globalThis as typeof globalThis & {
    [key: string]: Record<string, Record<string, unknown>>;
  };
  if (!g[hostKey]) g[hostKey] = {};
  g[hostKey][spec] = exports as Record<string, unknown>;

  const lines: string[] = [
    `const mod = globalThis[${JSON.stringify(hostKey)}][${JSON.stringify(spec)}];`,
  ];

  const keys = Object.keys(exports).filter(
    (k) => k !== "default" && k !== "__esModule",
  );
  if ("default" in exports) {
    lines.push(`export default mod.default ?? mod;`);
  } else {
    lines.push(`export default mod;`);
  }
  for (const key of keys) {
    if (!/^[A-Za-z_$][\w$]*$/.test(key)) continue;
    lines.push(`export const ${key} = mod[${JSON.stringify(key)}];`);
  }

  const blob = new Blob([lines.join("\n")], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  moduleBlobUrls.set(spec, url);
  return url;
}

export async function ensurePluginHostModules(): Promise<PluginHostModules> {
  if (!pluginHostModules) {
    pluginHostModules = await getPluginHostModules();
  }
  const modules = pluginHostModules;
  if (importMapReady) return modules;
  for (const [spec, mod] of Object.entries(modules)) {
    buildModuleBlob(spec, mod as unknown as Record<string, unknown>);
  }
  importMapReady = true;
  return modules;
}

async function rewriteBareImports(source: string): Promise<string> {
  const modules = await ensurePluginHostModules();
  const specs = Object.keys(modules);
  let out = source;
  for (const spec of specs) {
    const blobUrl = moduleBlobUrls.get(spec);
    if (!blobUrl) continue;
    const escaped = spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Static: from"pkg" / from "pkg" / from 'pkg'
    out = out.replace(
      new RegExp(`(from\\s*)(['"])${escaped}\\2`, "g"),
      `$1$2${blobUrl}$2`,
    );
    // Dynamic: import("pkg") — allow whitespace *and* block/line comments
    // between `import(` and the string (TS builds often leave webpackIgnore
    // comments on their own lines, which broke the old `\\s*`-only pattern).
    out = out.replace(
      new RegExp(
        `import\\s*\\((\\s*(?:\\/\\*[\\s\\S]*?\\*\\/\\s*|\\/\\/[^\\n]*\\n\\s*)*)(['"])${escaped}\\2`,
        "g",
      ),
      `import($1$2${blobUrl}$2`,
    );
  }
  return out;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return res.text();
}

export async function fetchPluginManifest(
  manifestUrl: string,
): Promise<PluginManifest> {
  const text = await fetchText(manifestUrl);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid plugin manifest JSON at ${manifestUrl}`);
  }
  const m = json as PluginManifest;
  if (!m || typeof m !== "object") {
    throw new Error("Plugin manifest must be an object");
  }
  if (typeof m.id !== "string" || !m.id) {
    throw new Error("Plugin manifest missing string 'id'");
  }
  if (typeof m.entry !== "string" || !m.entry) {
    throw new Error("Plugin manifest missing string 'entry'");
  }
  if (typeof m.name !== "string") m.name = m.id;
  if (typeof m.version !== "string") m.version = "0.0.0";
  return m;
}

const REL_IMPORT_RE = /(from\s*|import\s*\(\s*)(['"])(\.[^'"]+)\2/g;

/**
 * Fetch a module graph starting at `url`, rewrite bare host imports to
 * shared blobs, and rewrite relative imports to recursively rewritten
 * chunk blobs. Returns a blob: URL ready for `import()`.
 */
export async function rewriteModuleGraph(
  url: string,
  /** Entry that owns this graph; chunks are revoked together with it. */
  owner: string = new URL(url).href,
): Promise<string> {
  const absolute = new URL(url).href;
  let owned = graphChunks.get(owner);
  if (!owned) {
    owned = new Set();
    graphChunks.set(owner, owned);
  }
  owned.add(absolute);

  const cached = rewrittenModuleBlobs.get(absolute);
  if (cached) return cached;

  const inflight = rewriteInFlight.get(absolute);
  if (inflight) return inflight;

  const promise = (async () => {
    // Reserve the key early so mutual imports don't loop forever.
    // Temporary empty string is replaced before return.
    rewrittenModuleBlobs.set(absolute, "");

    const source = await fetchText(absolute);
    let rewritten = await rewriteBareImports(source);

    const relSpecs = new Set<string>();
    for (const match of source.matchAll(REL_IMPORT_RE)) {
      relSpecs.add(match[3]);
    }

    const relToBlob = new Map<string, string>();
    await Promise.all(
      [...relSpecs].map(async (rel) => {
        const childAbs = new URL(rel, absolute).href;
        const childBlob = await rewriteModuleGraph(childAbs, owner);
        relToBlob.set(rel, childBlob);
      }),
    );

    rewritten = rewritten.replace(
      REL_IMPORT_RE,
      (full, prefix: string, quote: string, rel: string) => {
        const blob = relToBlob.get(rel);
        if (!blob) return full;
        return `${prefix}${quote}${blob}${quote}`;
      },
    );

    // Pin the network entry URL for co-located assets (workers, .whl, all.json).
    // rspack often freezes `import.meta.url` to a build-time file: path inside
    // the plugin bundle, and blob modules would make it a blob: URL — both
    // break Release/local flat assets next to plugin.js.
    rewritten =
      `globalThis.__MOLVIS_PLUGIN_ENTRY__=${JSON.stringify(absolute)};\n` +
      rewritten;

    const blob = new Blob([rewritten], { type: "text/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    rewrittenModuleBlobs.set(absolute, blobUrl);
    return blobUrl;
  })();

  rewriteInFlight.set(absolute, promise);
  try {
    return await promise;
  } finally {
    rewriteInFlight.delete(absolute);
  }
}

function coercePluginModule(
  mod: {
    default?: MolvisPluginModule | (new () => MolvisPluginModule);
  } & Partial<MolvisPluginModule>,
): MolvisPluginModule {
  const exported = mod.default ?? mod;
  if (typeof exported === "function") {
    // Class export (`new`-able) or plain factory (`export default () => ({…})`).
    // Arrow functions cannot be constructed, so try the call form as well
    // rather than surfacing a bare "X is not a constructor".
    const callable = exported as unknown as {
      (): unknown;
      new (): unknown;
    };
    let produced: unknown;
    try {
      produced = new callable();
    } catch {
      produced = callable();
    }
    return coercePluginModule(
      produced as Parameters<typeof coercePluginModule>[0],
    );
  }
  if (
    exported &&
    typeof exported === "object" &&
    typeof (exported as MolvisPluginModule).activate === "function" &&
    typeof (exported as MolvisPluginModule).id === "string"
  ) {
    return exported as MolvisPluginModule;
  }
  throw new Error(
    "Plugin module must default-export an object/class with id + activate()",
  );
}

/**
 * Revoke every blob created for `entryUrl`'s module graph and drop it from
 * the rewrite cache, so the next load re-fetches the plugin's current source.
 *
 * Host singleton blobs (`moduleBlobUrls`) are intentionally left alone —
 * other plugins still import them.
 */
export function releasePluginModuleGraph(entryUrl: string): void {
  const owned = graphChunks.get(new URL(entryUrl).href);
  if (!owned) return;
  for (const chunk of owned) {
    const blobUrl = rewrittenModuleBlobs.get(chunk);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    rewrittenModuleBlobs.delete(chunk);
  }
  graphChunks.delete(new URL(entryUrl).href);
}

/**
 * Load a plugin ESM entry (and any relative chunk graph it imports).
 * Bare imports of react / molvis-stage / molvis-core/molrs resolve to host singletons.
 */
export async function loadPluginModule(
  entryUrl: string,
): Promise<MolvisPluginModule> {
  await ensurePluginHostModules();
  const absolute = new URL(entryUrl).href;
  const blobUrl = await rewriteModuleGraph(entryUrl);
  const g = globalThis as { __MOLVIS_PLUGIN_ENTRY__?: string };
  const prevEntry = g.__MOLVIS_PLUGIN_ENTRY__;
  // Visible while the module body runs (capture PLUGIN_ENTRY_AT_LOAD).
  g.__MOLVIS_PLUGIN_ENTRY__ = absolute;
  try {
    const mod = (await import(
      /* webpackIgnore: true */
      /* @vite-ignore */
      blobUrl
    )) as {
      default?: MolvisPluginModule | (new () => MolvisPluginModule);
    } & Partial<MolvisPluginModule>;
    return coercePluginModule(mod);
  } catch (err) {
    throw err instanceof Error
      ? err
      : new Error(`Failed to import plugin: ${String(err)}`);
  } finally {
    g.__MOLVIS_PLUGIN_ENTRY__ = prevEntry;
  }
}
