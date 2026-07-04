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
 * `specs.json` is an array of { name, spec } where `spec` is a RenderSceneSpec
 * (see examples/headless_render.ts). Each render is written to
 * `<outdir>/<name>.png`.
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
  const dist = resolve(args.dist ?? "examples-dist/headless");
  const specsPath = resolve(args.specs);
  const outdir = resolve(args.outdir ?? ".");
  await mkdir(outdir, { recursive: true });

  const specs = JSON.parse(await readFile(specsPath, "utf8"));
  const { server, port } = await serveDir(dist);
  const url = `http://127.0.0.1:${port}/`;

  const browser = await chromium.launch({
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
  const page = await browser.newPage();
  page.on("console", (msg) => console.log(`  [page] ${msg.text()}`));
  page.on("pageerror", (err) => console.error(`  [page error] ${err.message}`));

  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction("window.molvisReady === true", { timeout: 60000 });

  for (const { name, spec } of specs) {
    console.log(`rendering ${name} …`);
    const dataUrl = await page.evaluate(
      async (s) => await window.molvisRenderScene(s),
      spec,
    );
    const b64 = dataUrl.split(",")[1];
    const buf = Buffer.from(b64, "base64");
    const outPath = join(outdir, `${name}.png`);
    await writeFile(outPath, buf);
    console.log(`  wrote ${outPath} (${buf.length} bytes)`);
  }

  await browser.close();
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
