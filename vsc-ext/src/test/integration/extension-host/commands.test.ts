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

  test("launcher view has welcome content wired to openEditor", () => {
    const ext = vscode.extensions.getExtension("molcrafts.molvis");
    assert.ok(ext, "Expected molcrafts.molvis extension to be installed");

    const welcomes = ext.packageJSON?.contributes?.viewsWelcome as
      | Array<{ view: string; contents: string }>
      | undefined;
    assert.ok(welcomes, "Expected contributes.viewsWelcome to be defined");

    const launcherWelcome = welcomes?.find((w) => w.view === "molvis.launcher");
    assert.ok(launcherWelcome, "Expected welcome content for molvis.launcher");
    assert.ok(
      launcherWelcome?.contents.includes("command:molvis.openEditor"),
      "Welcome content must offer an Open Workspace action",
    );
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
});
