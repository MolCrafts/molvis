#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
/**
 * Drive the molvis headless render harness (examples/headless_render.ts, built
 * via `rsbuild build -c rsbuild.headless.config.ts`) in headless Chromium and
 * capture one PNG per scene spec.
 *
 * Usage:
 *   node scripts/headless_render_runner.mjs \
 *     --dist examples-dist/headless \
 *     --specs /path/to/specs.json \
 *     --outdir /path/to/out
 *
 * `specs.json` contains optional shared `defaults` plus a `scenes` array of
 * `{ name, spec }`. Molecular appearance belongs under `spec.style`; draw data
 * never carries representation options. See examples/headless_render.ts.
 */
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright";

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".css": "text/css",
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    out[key] = argv[i + 1];
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/headless_render_runner.mjs \\",
    "    --dist examples-dist/headless \\",
    "    --specs examples/headless_smoke.json \\",
    "    --outdir /tmp/molvis-headless",
  ].join("\n");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeSceneSpec(defaults, override) {
  const merged = { ...defaults, ...override };
  for (const key of ["style", "grid", "camera"]) {
    if (defaults[key] !== undefined || override[key] !== undefined) {
      merged[key] = { ...(defaults[key] ?? {}), ...(override[key] ?? {}) };
    }
  }
  if (
    defaults.grid?.style !== undefined ||
    override.grid?.style !== undefined
  ) {
    merged.grid.style = {
      ...(defaults.grid?.style ?? {}),
      ...(override.grid?.style ?? {}),
    };
  }
  return merged;
}

function parseSuite(raw) {
  if (!isObject(raw)) {
    throw new Error("specs file must be an object with a 'scenes' array");
  }
  const defaults = raw.defaults ?? {};
  if (!isObject(defaults)) {
    throw new Error("specs.defaults must be an object");
  }
  if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) {
    throw new Error("specs.scenes must be a non-empty array");
  }

  const names = new Set();
  return raw.scenes.map((entry, index) => {
    if (!isObject(entry) || typeof entry.name !== "string") {
      throw new Error(`specs.scenes[${index}] must have a string name`);
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(entry.name)) {
      throw new Error(
        `specs.scenes[${index}].name may contain only letters, numbers, '.', '_', and '-'`,
      );
    }
    if (names.has(entry.name)) {
      throw new Error(`duplicate scene name '${entry.name}'`);
    }
    names.add(entry.name);
    if (!isObject(entry.spec)) {
      throw new Error(`specs.scenes[${index}].spec must be an object`);
    }
    const spec = mergeSceneSpec(defaults, entry.spec);
    if (!isObject(spec.atoms)) {
      throw new Error(
        `scene '${entry.name}' has no atoms object after defaults are applied`,
      );
    }
    return { name: entry.name, spec };
  });
}

function serveDir(root) {
  const server = createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent(req.url.split("?")[0]);
      if (urlPath === "/" || urlPath === "") urlPath = "/index.html";
      const filePath = join(root, urlPath);
      const data = await readFile(filePath);
      res.setHeader(
        "Content-Type",
        MIME[extname(filePath)] ?? "application/octet-stream",
      );
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      resolvePromise({ server, port: server.address().port });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.specs) {
    throw new Error(`--specs is required\n\n${usage()}`);
  }
  const dist = resolve(args.dist ?? "examples-dist/headless");
  const specsPath = resolve(args.specs);
  const outdir = resolve(args.outdir ?? ".");
  await mkdir(outdir, { recursive: true });

  const specs = parseSuite(JSON.parse(await readFile(specsPath, "utf8")));
  const { server, port } = await serveDir(dist);
  const url = `http://127.0.0.1:${port}/`;
  let browser;
  try {
    browser = await chromium.launch({
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--no-sandbox",
        "--ignore-gpu-blocklist",
        "--disable-dev-shm-usage",
        "--disable-gpu-sandbox",
      ],
    });
    for (const { name, spec } of specs) {
      console.log(`rendering ${name} …`);
      const page = await browser.newPage();
      const pageErrors = [];
      const consoleErrors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
        if (
          args.verbose === "true" ||
          msg.type() === "warning" ||
          msg.type() === "error"
        ) {
          console.log(`  [page:${msg.type()}] ${msg.text()}`);
        }
      });
      page.on("pageerror", (err) => {
        pageErrors.push(err);
        console.error(`  [page error] ${err.message}`);
      });

      try {
        await page.goto(url, { waitUntil: "load" });
        await page.waitForFunction("window.molvisReady === true", {
          timeout: 60000,
        });
        const dataUrl = await page.evaluate(
          async (s) => await window.molvisRenderScene(s),
          spec,
        );
        if (pageErrors.length > 0 || consoleErrors.length > 0) {
          throw new Error(`scene '${name}' emitted a browser error`);
        }
        if (!dataUrl.startsWith("data:image/png;base64,")) {
          throw new Error(`scene '${name}' did not return a PNG data URL`);
        }
        const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        const buf = Buffer.from(b64, "base64");
        if (buf.length === 0) {
          throw new Error(`scene '${name}' returned an empty PNG`);
        }
        const outPath = join(outdir, `${name}.png`);
        await writeFile(outPath, buf);
        console.log(`  wrote ${outPath} (${buf.length} bytes)`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser?.close();
    await new Promise((resolvePromise, reject) => {
      server.close((error) => (error ? reject(error) : resolvePromise()));
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
