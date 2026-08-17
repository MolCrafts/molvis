import path from "node:path";
import { rspack } from "@rspack/core";

/**
 * Webview worker-request rewrites
 * ===============================
 *
 * Every webview build that folds an engine into its main-thread graph
 * (`rslib.webview.config.mts`, `rslib.webview.page.config.mts`) must redirect
 * the engine's in-graph worker spawn to the vsc-ext wrapper, so the worker
 * stays a separate rslib entry (`rslib.webview.worker.config.mts`) instead of
 * being folded into splitChunks — dual chunk ownership is what produced null
 * module exports on main. These rewrites live here so the two graphs cannot
 * drift apart on which module gets swapped.
 *
 * `NormalModuleReplacementPlugin` matches the **raw request**, not the
 * resolved path. Keep the request regexes as-is and keep every "is this the
 * module we mean" test on the importer context; do not "improve" either into
 * a resolved-path match.
 */

/**
 * The wrappers import the real engine module from a vsc-ext context path —
 * rewriting those would loop the replacement back onto itself.
 */
function importedFromExtension(context: string): boolean {
  return context.includes(`${path.sep}vsc-ext${path.sep}`);
}

/**
 * Core's trajectory runtime → VS Code spawn wrapper, which loads the isolated
 * `out/chunks/worker.js`.
 */
export class TrajectoryRuntimeRewrite {
  private readonly wrapper: string;

  /** @param extensionDir vsc-ext package root (`import.meta.dirname`). */
  constructor(extensionDir: string) {
    this.wrapper = path.resolve(
      extensionDir,
      "./src/webview/spawnTrajectoryWorker.ts",
    );
  }

  plugin(): InstanceType<typeof rspack.NormalModuleReplacementPlugin> {
    return new rspack.NormalModuleReplacementPlugin(
      /trajectory_worker[\\/]runtime\.(ts|js)$/,
      (resource: { context: string; request: string }) => {
        if (importedFromExtension(resource.context)) {
          return;
        }
        resource.request = this.wrapper;
      },
    );
  }
}

/**
 * Stage's compute spawn → VS Code wrapper, which loads the isolated
 * `out/chunks/compute-worker.js`.
 *
 * The request seen here is `"./spawn.js"` (from `stage/compute/runtime`), so
 * the "is this stage's compute dir" test has to live on the importer context.
 */
export class ComputeSpawnRewrite {
  private readonly wrapper: string;

  /** @param extensionDir vsc-ext package root (`import.meta.dirname`). */
  constructor(extensionDir: string) {
    this.wrapper = path.resolve(
      extensionDir,
      "./src/webview/spawnComputeWorker.ts",
    );
  }

  plugin(): InstanceType<typeof rspack.NormalModuleReplacementPlugin> {
    return new rspack.NormalModuleReplacementPlugin(
      /(^|[\\/])spawn\.(ts|js)$/,
      (resource: { context: string; request: string }) => {
        if (!resource.context.endsWith(`${path.sep}compute`)) {
          return;
        }
        if (importedFromExtension(resource.context)) {
          return;
        }
        resource.request = this.wrapper;
      },
    );
  }
}
