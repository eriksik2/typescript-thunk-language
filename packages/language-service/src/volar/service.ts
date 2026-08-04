/**
 * Tiny language service plugin: surface parse/lower errors on `.thunk` files.
 */

import type {
  Diagnostic,
  LanguageServicePlugin,
  LanguageServicePluginInstance,
} from "@volar/language-service";
import { URI } from "vscode-uri";
import { ThunkVirtualCode } from "./language";

export function createThunkParseService(): LanguageServicePlugin {
  return {
    name: "thunk-parse",
    capabilities: {
      diagnosticProvider: {
        interFileDependencies: false,
        workspaceDiagnostics: false,
      },
    },
    create(context): LanguageServicePluginInstance {
      return {
        provideDiagnostics(document) {
          const uri = URI.parse(document.uri);
          const script = context.language.scripts.get(uri);
          const root = script?.generated?.root;
          if (!(root instanceof ThunkVirtualCode) || !root.parseError) {
            return;
          }

          const err = root.parseError;
          const start = document.positionAt(
            Math.min(err.offset, document.getText().length),
          );
          const errors: Diagnostic[] = [
            {
              severity: 1,
              range: { start, end: start },
              source: "thunk",
              message: err.message,
            },
          ];
          return errors;
        },
      };
    },
  };
}
