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
  description?: string;
  contributes?: {
    commands?: Array<{ command: string }>;
    views?: Record<string, Array<ViewContribution & { when?: string }>>;
    viewsContainers?: { activitybar?: Array<{ id: string; icon?: string }> };
    viewsWelcome?: Array<{ view: string }>;
    menus?: Record<string, Array<{ command: string; when?: string }>>;
    customEditors?: Array<{
      viewType: string;
      displayName: string;
      selector: Array<{ filenamePattern: string }>;
      priority?: string;
    }>;
    configuration?: {
      properties?: Record<
        string,
        {
          type?: string;
          enum?: string[];
          default?: unknown;
          markdownDescription?: string;
        }
      >;
    };
    configurationDefaults?: {
      "workbench.editorAssociations"?: Record<string, string>;
    };
  };
};

const contributes = pkg.contributes ?? {};

const views = contributes.views ?? {};
const commandIds = new Set((contributes.commands ?? []).map((c) => c.command));

suite("contribution manifest", () => {
  test("marketplace description uses the project tagline", () => {
    const description = pkg.description ?? "";
    assert.match(
      description,
      /visual workspace/i,
      "description must reuse the project tagline, not a format laundry list",
    );
    assert.match(
      description,
      /people and agents/i,
      "description must name the people-and-agents workspace, matching root README / docs hero",
    );
    assert.doesNotMatch(
      description,
      /PDB,\s*XYZ,\s*CIF/,
      "formats belong in the README, not the marketplace one-liner",
    );
  });

  test("declares every command the files view and editors invoke", () => {
    for (const id of [
      "molvis.quickView",
      "molvis.openStage",
      "molvis.openSketch",
      "molvis.openPage",
      "molvis.openInPage",
      "molvis.openStructure",
      "molvis.refreshFiles",
      "molvis.clearRecent",
      "molvis.reload",
    ]) {
      assert.ok(commandIds.has(id), `missing contributed command ${id}`);
    }
  });

  test("Quick look tabs expose the promote-to-Page action", () => {
    const titleMenus = contributes.menus?.["editor/title"] ?? [];
    const promote = titleMenus.find((m) => m.command === "molvis.openInPage");
    assert.ok(promote, "editor/title must offer molvis.openInPage");
    for (const surface of [
      "activeWebviewPanelId == molvis.quickView",
      "activeCustomEditorId == molvis.editor",
      "activeCustomEditorId == molvis.binaryEditor",
    ]) {
      assert.ok(
        promote.when?.includes(surface),
        `molvis.openInPage must be shown on ${surface}`,
      );
    }
  });

  test("defaultViewer chooses whether the interface starts visible", () => {
    const prop =
      contributes.configuration?.properties?.["molvis.defaultViewer"];
    assert.ok(prop, "molvis.defaultViewer must be contributed");
    // Enum values are kept even though the meaning changed: renaming them
    // would silently invalidate every user's stored setting.
    assert.deepStrictEqual(prop.enum, ["quickLook", "page"]);
    assert.strictEqual(
      prop.default,
      "quickLook",
      "the canvas-only start stays the default; the full interface is opt-in",
    );
    // There is one viewer now, so promoting cannot reload anything. This text
    // ships in the settings UI — a stale rationale there is a lie to the user.
    assert.ok(
      prop.markdownDescription,
      "the setting must explain itself in the settings UI",
    );
    assert.doesNotMatch(
      prop.markdownDescription,
      /reload/i,
      "promoting is a chrome switch in the same webview, not a reload",
    );
  });

  test("does not contribute a Workbench command", () => {
    assert.ok(!commandIds.has("molvis.openWorkbench"));
    assert.ok(!commandIds.has("molvis.loadInWorkbench"));
    assert.ok(!commandIds.has("molvis.openRecentInStage"));
  });

  test("activity bar hosts a native files view, not a webview", () => {
    const files = views.molvis?.find((v) => v.id === "molvis.files");
    assert.ok(files, "Expected molvis.files in views.molvis");
    assert.notStrictEqual(
      files.type,
      "webview",
      "Files must be a native tree view, not a heavyweight webview",
    );
  });

  test("the full page is not hosted inside the sidebar", () => {
    assert.strictEqual(
      views.molvis?.find((v) => v.id === "molvis.pageView"),
      undefined,
      "molvis.pageView (full page in sidebar) must be removed",
    );
  });

  test("files view title only exposes Open Structure and Refresh", () => {
    const titleMenus = contributes.menus?.["view/title"] ?? [];
    const filesActions = titleMenus.filter((m) =>
      m.when?.includes("molvis.files"),
    );
    assert.ok(
      filesActions.some((m) => m.command === "molvis.openStructure"),
      "view/title must expose Open Structure on Files",
    );
    assert.ok(
      filesActions.some((m) => m.command === "molvis.refreshFiles"),
      "view/title must expose Refresh on Files",
    );
    assert.ok(
      !filesActions.some(
        (m) =>
          m.command === "molvis.openStage" || m.command === "molvis.openSketch",
      ),
      "Files title must not host Stage or Sketch — those are other views",
    );
  });

  test("activity bar has a single MolVis container", () => {
    const activitybar = contributes.viewsContainers?.activitybar ?? [];
    assert.strictEqual(activitybar.length, 1);
    assert.strictEqual(activitybar[0]?.id, "molvis");
    assert.strictEqual(views.molvisSketch, undefined);
  });

  test("activity bar Stage and Sketch views are native trees hidden until loaded", () => {
    const stage = views.molvis?.find((v) => v.id === "molvis.stageOutline");
    const sketch = views.molvis?.find((v) => v.id === "molvis.sketchOutline");
    assert.ok(stage);
    assert.ok(sketch);
    assert.notStrictEqual(stage.type, "webview");
    assert.notStrictEqual(sketch.type, "webview");
    assert.ok(stage.when?.includes("molvis.hasStageOutline"));
    assert.ok(sketch.when?.includes("molvis.hasSketchOutline"));
    assert.strictEqual(
      views.molvis?.find(
        (v) => v.id === "molvis.sketch" && v.type === "webview",
      ),
      undefined,
      "Sketch canvas must not live in the activity bar",
    );
  });

  test("outline views do not host Open Stage or Open Sketch", () => {
    const titleMenus = contributes.menus?.["view/title"] ?? [];
    assert.ok(
      !titleMenus.some(
        (m) =>
          (m.command === "molvis.openStage" ||
            m.command === "molvis.openSketch") &&
          (m.when?.includes("stageOutline") ||
            m.when?.includes("sketchOutline")),
      ),
    );
    const welcome = pkg.contributes?.viewsWelcome ?? [];
    assert.ok(!welcome.some((w) => w.view === "molvis.stageOutline"));
    assert.ok(!welcome.some((w) => w.view === "molvis.sketchOutline"));
    assert.ok(welcome.some((w) => w.view === "molvis.files"));
  });

  test("command palette only shows single-purpose commands", () => {
    const palette = contributes.menus?.commandPalette ?? [];
    const hidden = new Set(
      palette.filter((m) => m.when === "false").map((m) => m.command),
    );
    const shown = (contributes.commands ?? [])
      .map((c) => c.command)
      .filter((id) => !hidden.has(id));
    assert.deepStrictEqual(
      shown.sort(),
      [
        "molvis.openInPage",
        "molvis.openPage",
        "molvis.openSketch",
        "molvis.openStage",
        "molvis.openStructure",
        "molvis.quickView",
        "molvis.reload",
      ].sort(),
    );
  });

  test("the activity-bar icon is shaped the way VS Code renders one", () => {
    // The container icon is painted as a CSS mask at 24px. VS Code's own
    // icons declare an explicit 24x24 box with the artwork centred in it;
    // this one came out of a tracer with no intrinsic size and a fractional,
    // off-origin viewBox, which is the one structural difference between it
    // and every icon that is known to render. Pin the shape, not the artwork.
    const container = (contributes.viewsContainers?.activitybar ?? []).find(
      (c) => c.id === "molvis",
    );
    assert.ok(container, "no molvis activity-bar container");
    const iconPath = container.icon;
    assert.ok(
      typeof iconPath === "string" && iconPath.endsWith(".svg"),
      `activity-bar icon must be an svg: ${iconPath}`,
    );
    const svg = readFileSync(
      join(dirname(extensionManifestPath()), iconPath),
      "utf8",
    );
    assert.match(svg, /<svg[^>]*\swidth="24"/, "icon needs width=24");
    assert.match(svg, /<svg[^>]*\sheight="24"/, "icon needs height=24");
    assert.match(
      svg,
      /<svg[^>]*\sviewBox="0 0 24 24"/,
      "icon needs a 0 0 24 24 viewBox",
    );
    assert.ok(
      svg.includes("currentColor"),
      "icon must paint with currentColor so the theme drives it",
    );
  });

  test("byte-payload formats default to one Quick look editor, not a picker list", () => {
    // STL sits with the binary trajectories: the extension does not say which
    // half of the format a given file is, and reading bytes is right for both.
    const editors = contributes.customEditors ?? [];
    const binary = editors.find((e) => e.viewType === "molvis.binaryEditor");
    const text = editors.find((e) => e.viewType === "molvis.editor");
    assert.strictEqual(binary?.displayName, "Quick look");
    assert.strictEqual(text?.displayName, "Quick look");
    assert.deepStrictEqual(binary?.selector, [
      { filenamePattern: "*.{dcd,trr,xtc,stl}" },
    ]);
    assert.strictEqual(binary?.priority, "default");
    const associations =
      contributes.configurationDefaults?.["workbench.editorAssociations"] ?? {};
    assert.strictEqual(associations["*.dcd"], "molvis.binaryEditor");
    assert.strictEqual(associations["*.trr"], "molvis.binaryEditor");
    assert.strictEqual(associations["*.xtc"], "molvis.binaryEditor");
    assert.strictEqual(associations["*.stl"], "molvis.binaryEditor");
  });
});
