/**
 * Contribution-manifest checks.
 *
 * These assert on `package.json` `contributes` only, so they need no
 * extension host. They previously lived in the extension-host suite and paid
 * a full VS Code download and boot to read a JSON file.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as assert from "assert";

type ViewContribution = { id: string; type?: string };

/**
 * Walk up to the extension root rather than counting `..` segments — the
 * compiled tests live under `out-test/`, so a fixed depth silently breaks
 * whenever the emit layout changes.
 */
function extensionManifestPath(): string {
  let dir = __dirname;
  while (dir !== dirname(dir)) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate) && dir.endsWith("vsc-ext")) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`could not locate vsc-ext/package.json from ${__dirname}`);
}

const pkg = JSON.parse(readFileSync(extensionManifestPath(), "utf8")) as {
  contributes?: {
    commands?: Array<{ command: string }>;
    views?: Record<string, ViewContribution[]>;
    viewsContainers?: { activitybar?: Array<{ id: string }> };
    menus?: Record<string, Array<{ command: string; when?: string }>>;
  };
};

const contributes = pkg.contributes ?? {};
const views = contributes.views ?? {};
const commandIds = new Set((contributes.commands ?? []).map((c) => c.command));

suite("contribution manifest", () => {
  test("declares every command the launcher and editors invoke", () => {
    for (const id of [
      "molvis.quickView",
      "molvis.quickViewSketch",
      "molvis.openWorkbench",
      "molvis.openStage",
      "molvis.openSketch",
      "molvis.openPage",
      "molvis.openStructure",
      "molvis.clearRecent",
      "molvis.openDocs",
      "molvis.showOutput",
      "molvis.reload",
    ]) {
      assert.ok(commandIds.has(id), `missing contributed command ${id}`);
    }
  });

  test("activity bar hosts a native launcher view, not a webview", () => {
    const launcher = views.molvis?.find((v) => v.id === "molvis.launcher");
    assert.ok(launcher, "Expected molvis.launcher in views.molvis");
    assert.notStrictEqual(
      launcher.type,
      "webview",
      "Launcher must be a native tree view, not a heavyweight webview",
    );
  });

  test("the full page is not hosted inside the sidebar", () => {
    assert.strictEqual(
      views.molvis?.find((v) => v.id === "molvis.pageView"),
      undefined,
      "molvis.pageView (full page in sidebar) must be removed",
    );
  });

  test("launcher exposes Open Structure as a view/title action", () => {
    const titleMenus = contributes.menus?.["view/title"] ?? [];
    assert.ok(
      titleMenus.some(
        (m) =>
          m.command === "molvis.openStructure" &&
          m.when?.includes("molvis.launcher"),
      ),
      "view/title must expose Open Structure on the launcher",
    );
  });

  test("declares both activity-bar containers", () => {
    const activitybar = contributes.viewsContainers?.activitybar ?? [];
    assert.ok(
      activitybar.some((c) => c.id === "molvis"),
      "Expected molvis activity bar container",
    );
    assert.ok(
      activitybar.some((c) => c.id === "molvisSketch"),
      "Expected standalone sketch activity container",
    );
  });

  test("the standalone sketch view is a webview", () => {
    const sketchView = views.molvisSketch?.find(
      (v) => v.id === "molvis.sketch",
    );
    assert.ok(sketchView, "Expected molvis.sketch in views.molvisSketch");
    assert.strictEqual(sketchView.type, "webview");
  });
});
