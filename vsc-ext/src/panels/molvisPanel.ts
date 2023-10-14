import * as vscode from "vscode";

export class MolvisPanel {

    public static currentPanel: MolvisPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _log: vscode.OutputChannel = vscode.window.createOutputChannel("Molvis", { log: true });

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, clickedFiles: vscode.Uri[] | undefined) {
        this._panel = panel;
        this._panel.onDidDispose(this.dispose, null, this._disposables);
        // this._panel.webview.html = this._getWebviewContent(panel.webview, extensionUri);
        this._getWebviewContent(panel.webview, extensionUri);
        // this._log.appendLine(this._getWebviewContent(panel.webview, extensionUri));
        // this._panel.webview.html = `<!DOCTYPE html>
        // <html>
        //   <head>
        //     <meta charset="utf-8">
        //     <title>Babylon.js NPM Package Template</title>
        //   <meta name="viewport" content="width=device-width, initial-scale=1"><script defer src="https://vscode-remote%2Bwsl-002bubuntu.vscode-resource.vscode-cdn.net/home/jicli594/work/molcrafts/projects/molvis/dist/bundle.js"></script></head>
        //   <body>
        //     <h1>Hello, world!</h1>
        //   </body>
        // </html>`;
        // if (clickedFiles !== undefined) {
        //   this._panel.webview.html = this._getWebviewContentForFiles(panel.webview, extensionUri, clickedFiles);
        // };
    }

    public static opon(extensionUri: vscode.Uri) {
        const title = "Molvis";
        const panel = vscode.window.createWebviewPanel("molvisPanel", title, vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, '../dist')]
        });
        MolvisPanel.currentPanel = new MolvisPanel(panel, extensionUri, undefined);
    }

    // public static openFromFiles(extensionUri: vscode.Uri, clickedFiles: vscode.Uri[]) {

    // }

    public dispose() {
        MolvisPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri) {
        this._log.appendLine("_getWebviewContent");
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, '../dist', 'bundle.js'));
        this._log.appendLine(jsUri.toString());
        webview.html = `<!DOCTYPE html>
        <html lang="en">
            <head>
                <title>Molvis</title>
            </head>
            <body>
            <script src="${jsUri}"></script>
            </body>
        </html>`;
    }
}