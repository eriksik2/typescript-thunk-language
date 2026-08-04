/**
 * Thunk language server entry (Volar + TypeScript project).
 */

import {
  createConnection,
  createServer,
  createTypeScriptProject,
  loadTsdkByPath,
} from "@volar/language-server/node";
import { create as createTypeScriptServices } from "volar-service-typescript";
import {
  createThunkLanguagePlugin,
  createThunkParseService,
} from "./volar/index";

const connection = createConnection();
const server = createServer(connection);

connection.listen();

connection.onInitialize((params) => {
  const tsdkPath = params.initializationOptions?.typescript?.tsdk;
  if (!tsdkPath || typeof tsdkPath !== "string") {
    throw new Error(
      "initializationOptions.typescript.tsdk is required (pass via @volar/vscode getTsdk)",
    );
  }
  const tsdk = loadTsdkByPath(tsdkPath, params.locale);
  const languagePlugin = createThunkLanguagePlugin(tsdk.typescript);

  return server.initialize(
    params,
    createTypeScriptProject(
      tsdk.typescript,
      tsdk.diagnosticMessages,
      () => ({
        languagePlugins: [languagePlugin],
      }),
    ),
    [...createTypeScriptServices(tsdk.typescript), createThunkParseService()],
  );
});

connection.onInitialized(server.initialized);
connection.onShutdown(server.shutdown);
