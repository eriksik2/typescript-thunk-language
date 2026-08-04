import * as serverProtocol from "@volar/language-server/protocol";
import { createLabsInfo, getTsdk } from "@volar/vscode";
import * as vscode from "vscode";
import * as lsp from "vscode-languageclient/node";

let client: lsp.BaseLanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext) {
  // Prefer bundled server next to the extension; fall back to workspace package.
  const bundled = vscode.Uri.joinPath(context.extensionUri, "dist", "server.js");
  const workspaceServer = vscode.Uri.joinPath(
    context.extensionUri,
    "node_modules",
    "@thunk/language-service",
    "dist",
    "server.js",
  );

  let serverModule = bundled.fsPath;
  try {
    await vscode.workspace.fs.stat(bundled);
  } catch {
    serverModule = workspaceServer.fsPath;
  }

  const serverOptions: lsp.ServerOptions = {
    run: {
      module: serverModule,
      transport: lsp.TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: lsp.TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };

  const clientOptions: lsp.LanguageClientOptions = {
    documentSelector: [{ language: "thunk" }],
    initializationOptions: {
      typescript: {
        tsdk: (await getTsdk(context))!.tsdk,
      },
    },
  };

  client = new lsp.LanguageClient(
    "thunk-language-server",
    "Thunk Language Server",
    serverOptions,
    clientOptions,
  );

  await client.start();

  const labsInfo = createLabsInfo(serverProtocol);
  labsInfo.addLanguageClient(client);
  return labsInfo.extensionExports;
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
