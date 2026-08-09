/**
 * MolVis service worker.
 *
 * Goals (kept deliberately small — no offline 3D engine promise):
 * 1. Installability (HTTPS + SW + manifest).
 * 2. Intercept Web Share Target POST and stash the file for the page.
 * 3. Precache the app shell so a cold open still paints something.
 * 4. Preserve COOP/COEP on navigation responses so SharedArrayBuffer /
 *    cross-origin isolation (WASM threads path) stays intact.
 *
 * Large WASM / Babylon chunks stay network-first so updates are not stuck
 * behind a stale cache.
 */
/* eslint-disable no-restricted-globals */

const CACHE_VERSION = "molvis-shell-v1";
const SHELL_URLS = ["./", "./index.html", "./manifest.webmanifest"];

/** IndexedDB database used to hand share-target files to the page. */
const SHARE_DB = "molvis-share-target";
const SHARE_STORE = "files";
const SHARE_KEY = "pending";

function withCoiHeaders(response) {
  if (!response || response.type === "opaque") return response;
  const headers = new Headers(response.headers);
  if (!headers.has("Cross-Origin-Opener-Policy")) {
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
  }
  if (!headers.has("Cross-Origin-Embedder-Policy")) {
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  }
  // Same-origin shell assets must be embeddable under COEP.
  if (!headers.has("Cross-Origin-Resource-Policy")) {
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function openShareDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SHARE_STORE)) {
        db.createObjectStore(SHARE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function stashShareFile(file) {
  const db = await openShareDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE, "readwrite");
    tx.objectStore(SHARE_STORE).put(
      {
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
        buffer: file,
      },
      SHARE_KEY,
    );
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        await cache.addAll(SHELL_URLS);
      } catch {
        // Dev / subpath hosts may 404 some shell entries — install still wins.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("molvis-") && key !== CACHE_VERSION)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * Web Share Target (Level 2): OS posts multipart form to `./share-target`.
 * We stash the first file and redirect into the app with `?shared=1`.
 */
async function handleShareTarget(request) {
  try {
    const form = await request.formData();
    const files = form.getAll("structure").filter((v) => v instanceof File);
    const file = files[0];
    if (file && file.size > 0) {
      await stashShareFile(file);
    } else {
      // Fall back: shared URL as text (e.g. RCSB link from the browser).
      const sharedUrl = form.get("url") || form.get("text");
      if (
        typeof sharedUrl === "string" &&
        /^https?:\/\//i.test(sharedUrl.trim())
      ) {
        const target = new URL("./", self.registration.scope);
        target.searchParams.set("url", sharedUrl.trim());
        return Response.redirect(target.href, 303);
      }
    }
  } catch (err) {
    console.warn("[molvis-sw] share-target failed", err);
  }
  const target = new URL("./", self.registration.scope);
  target.searchParams.set("shared", "1");
  return Response.redirect(target.href, 303);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only same-origin.
  if (url.origin !== self.location.origin) return;

  // Share-target POST must hit the SW even when the path has a base.
  if (
    event.request.method === "POST" &&
    /\/share-target\/?$/.test(url.pathname)
  ) {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  if (event.request.method !== "GET") return;

  // Navigation: network-first with shell fallback + COI headers.
  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(event.request);
          return withCoiHeaders(fresh);
        } catch {
          const cache = await caches.open(CACHE_VERSION);
          const cached =
            (await cache.match("./index.html")) ||
            (await cache.match("./")) ||
            (await cache.match(event.request));
          if (cached) return withCoiHeaders(cached);
          throw new Error("offline and no shell cache");
        }
      })(),
    );
    return;
  }

  // App shell assets: cache-first.
  if (
    url.pathname.endsWith("manifest.webmanifest") ||
    url.pathname.includes("/icons/")
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const fresh = await fetch(event.request);
        if (fresh.ok) {
          cache.put(event.request, fresh.clone());
        }
        return fresh;
      })(),
    );
  }
});
