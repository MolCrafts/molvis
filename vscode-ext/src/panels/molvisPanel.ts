import * as vscode from "vscode";

export class MolvisPanel {

    public static currentPanel: MolvisPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _log: vscode.OutputChannel = vscode.window.createOutputChannel("Molvis", { log: true });

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, clickedFiles: vscode.Uri[] | undefined) {
        this._panel = panel;
        this._panel.onDidDispose(this.dispose, null, this._disposables);
        this._panel.webview.html = this._getWebviewContent(panel.webview, extensionUri);
        // if (clickedFiles !== undefined) {
        //   this._panel.webview.html = this._getWebviewContentForFiles(panel.webview, extensionUri, clickedFiles);
        // };
    }

    public static opon(extensionUri: vscode.Uri) {
        const title = "Molvis";
        const panel = vscode.window.createWebviewPanel("molvisPanel", title, vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true
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
        // const cssUri = webview.asWebviewUri(extensionUri, );
        this._log.appendLine("_getWebviewContent");
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'panels', 'index.js'));
        return /*html*/`
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, user-scalable=no, minimum-scale=1.0, maximum-scale=1.0">
                <link rel="icon" href="./favicon.ico" type="image/x-icon">
                <title>Molvis</title>
                <style>
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }
                    html, body, #renderCanvas {
                        width: 100%;
                        height: 100%;
                        overflow: hidden;
                    }
                </style>
            </head>
            <body>
                <canvas id="renderCanvas"></canvas>
                <script type="text/javascript" src="${jsUri}"></script>
                <script type="text/javascript">
                    alert("Hello from Molvis!");
                </script>
            </body>
        </html>
        `;
    }
}