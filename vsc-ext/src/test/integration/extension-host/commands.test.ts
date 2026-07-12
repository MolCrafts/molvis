import * as os from "node:os";
import * as path from "node:path";
import * as assert from "assert";
import * as vscode from "vscode";

async function activateExtension(): Promise<void> {
  const extension = vscode.extensions.getExtension("molcrafts.molvis");
  assert.ok(extension, "Expected molcrafts.molvis extension to be installed");

  if (!extension.isActive) {
    await extension.activate();
  }
}

async function getRegisteredPanels(): Promise<readonly string[]> {
  return (
    (await vscode.commands.executeCommand<readonly string[]>(
      "molvis._test.getRegisteredPanelViewTypes",
    )) ?? []
  );
}

async function waitForRegisteredPanel(
  viewType: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await getRegisteredPanels()).includes(viewType)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const registered = await getRegisteredPanels();
  assert.fail(
    `Expected panel ${viewType} to appear within ${timeoutMs}ms; registered=${registered.join(",")}`,
  );
}

suite("extension host commands", () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("registers expected commands", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("molvis.quickView"));
    assert.ok(commands.includes("molvis.openEditor"));
    assert.ok(commands.includes("molvis.openStructure"));
    assert.ok(commands.includes("molvis.clearRecent"));
    assert.ok(commands.includes("molvis.openDocs"));
    assert.ok(commands.includes("molvis.showOutput"));
    assert.ok(commands.includes("molvis.reload"));
  });

  test("openEditor creates molvis editor webview", async () => {
    await vscode.commands.executeCommand("molvis.openEditor");
    await waitForRegisteredPanel("molvis.workspace");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("activity-bar hosts a native launcher view, not a webview", () => {
    const ext = vscode.extensions.getExtension("molcrafts.molvis");
    assert.ok(ext, "Expected molcrafts.molvis extension to be installed");

    const pkg = ext.packageJSON;
    assert.ok(pkg, "Expected package.json to be readable");

    const views = pkg?.contributes?.views as
      | Record<string, Array<{ id: string; type?: string }>>
      | undefined;
    assert.ok(views, "Expected contributes.views to be defined");
    assert.ok(views?.molvis, "Expected views.molvis to be defined");

    const launcher = views?.molvis?.find((v) => v.id === "molvis.launcher");
    assert.ok(launcher, "Expected molvis.launcher in views.molvis");
    assert.notStrictEqual(
      launcher?.type,
      "webview",
      "Launcher must be a native tree view, not a heavyweight webview",
    );

    // The full page must no longer be hosted inside the sidebar.
    const legacyPageView = views?.molvis?.find(
      (v) => v.id === "molvis.pageView",
    );
    assert.strictEqual(
      legacyPageView,
      undefined,
      "molvis.pageView (full page in sidebar) must be removed",
    );
  });

  test("launcher contributes tree view title actions (not welcome-only)", () => {
    const ext = vscode.extensions.getExtension("molcrafts.molvis");
    assert.ok(ext, "Expected molcrafts.molvis extension to be installed");

    const commands = ext.packageJSON?.contributes?.commands as
      | Array<{ command: string }>
      | undefined;
    const commandIds = new Set((commands ?? []).map((c) => c.command));
    assert.ok(
      commandIds.has("molvis.openStructure"),
      "Launcher needs Open Structure command",
    );
    assert.ok(
      commandIds.has("molvis.openEditor"),
      "Launcher needs Open Workspace command",
    );

    const menus = ext.packageJSON?.contributes?.menus as
      | Record<string, Array<{ command: string; when?: string }>>
      | undefined;
    const titleMenus = menus?.["view/title"] ?? [];
    assert.ok(
      titleMenus.some(
        (m) =>
          m.command === "molvis.openStructure" &&
          m.when?.includes("molvis.launcher"),
      ),
      "view/title must expose Open Structure on the launcher",
    );

    // Activity-bar content is a native tree (Actions/Recent/Help), not a
    // viewsWelcome-only empty shell.
    const views = ext.packageJSON?.contributes?.views as
      | Record<string, Array<{ id: string; type?: string }>>
      | undefined;
    const launcher = views?.molvis?.find((v) => v.id === "molvis.launcher");
    assert.notStrictEqual(launcher?.type, "webview");
  });

  test("activity bar container is declared", () => {
    const ext = vscode.extensions.getExtension("molcrafts.molvis");
    assert.ok(ext, "Expected molcrafts.molvis extension to be installed");

    const containers = ext.packageJSON?.contributes?.viewsContainers as
      | { activitybar?: Array<{ id: string }> }
      | undefined;
    assert.ok(containers, "Expected contributes.viewsContainers to be defined");

    const molvisContainer = containers?.activitybar?.find(
      (c) => c.id === "molvis",
    );
    assert.ok(molvisContainer, "Expected molvis activity bar container");
  });

  test("quickView accepts URI argument", async () => {
    const filePath = path.join(
      os.tmpdir(),
      `molvis-quickview-${Date.now()}.xyz`,
    );
    const fileUri = vscode.Uri.file(filePath);

    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from("1\nframe\nH 0 0 0\n"),
    );

    await vscode.commands.executeCommand("molvis.quickView", fileUri);
    await waitForRegisteredPanel("molvis.quickView");

    await vscode.commands.executeCommand("molvis.reload");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.workspace.fs.delete(fileUri);
  });

  test("showOutput and clearRecent commands are callable", async () => {
    // Smoke: host-side helpers used by the activity-bar Help / Recent sections.
    await vscode.commands.executeCommand("molvis.showOutput");
    await vscode.commands.executeCommand("molvis.clearRecent");
  });
});
