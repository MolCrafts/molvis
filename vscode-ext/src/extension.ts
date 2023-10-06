// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import initMolvisApp from 'app_package';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	const log = vscode.window.createOutputChannel("Molvis", {log: true});
	log.show(true);
	log.appendLine('Congratulations, molvis is running!');
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('molvis.openNewPanel', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		log.appendLine('Open a new panel');
		let panel = vscode.window.createWebviewPanel("molvisApp", "Molvis", vscode.ViewColumn.Beside, {enableScripts: true});
		panel.webview.html = `
		<!DOCTYPE html>
		<html>
		<head>
			<title>Canvas Example</title>
		</head>
		<body>
			<canvas id="molvisCanvas" width="400" height="400"></canvas>
		</body>
        <script>
            const vscode = acquireVsCodeApi();
            window.addEventListener('message', event => {
                const message = event.data;
                switch (message.command) {
                    case 'getCanvas':
                        vscode.postMessage({
                            command: 'returnCanvas',
                            data: document.getElementById("molvisCanvas");
                        });
                        break;
                }
            });
        </script>
		</html>
	`;
        panel.webview.postMessage({command: 'getCanvas'});
		panel.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'returnCanvas':
						initMolvisApp({
                            canvas: message.data
						});
						break;
				}
			},
			undefined,
			context.subscriptions
		);
	
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
