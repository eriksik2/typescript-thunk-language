/**
 * Volar LanguagePlugin for `.thunk` files.
 *
 * Lowers source via language-core into an embedded TypeScript VirtualCode
 * with CodeMappings so hover/diagnostics map back to Thunk syntax.
 */

import {
  forEachEmbeddedCode,
  type CodeMapping,
  type LanguagePlugin,
  type VirtualCode,
} from "@volar/language-core";
// Side-effect: augments LanguagePlugin with `typescript` hooks.
import "@volar/typescript";
import {
  ParseError,
  lowerThunkSource,
  type LoweredFile,
} from "@thunk/language-core";
import type * as ts from "typescript";
import type { URI } from "vscode-uri";
import { toVolarMappings } from "./mappings";

function snapshotFromText(text: string): ts.IScriptSnapshot {
  return {
    getText: (start, end) => text.substring(start, end),
    getLength: () => text.length,
    getChangeRange: () => undefined,
  };
}

function fileNameFromUri(uri: URI | string): string {
  if (typeof uri === "string") return uri;
  return uri.fsPath ?? uri.path;
}

export class ThunkVirtualCode implements VirtualCode {
  id = "root";
  languageId = "thunk";
  mappings: CodeMapping[] = [];
  embeddedCodes: VirtualCode[] = [];

  /** Set when parse/lower fails; consumed by the parse diagnostics service. */
  parseError: ParseError | undefined;
  lowered: LoweredFile | undefined;

  constructor(public snapshot: ts.IScriptSnapshot, private fileName: string) {
    this.onSnapshotUpdated();
  }

  update(newSnapshot: ts.IScriptSnapshot): void {
    this.snapshot = newSnapshot;
    this.onSnapshotUpdated();
  }

  onSnapshotUpdated(): void {
    const text = this.snapshot.getText(0, this.snapshot.getLength());
    this.mappings = [
      {
        sourceOffsets: [0],
        generatedOffsets: [0],
        lengths: [text.length],
        data: {
          completion: true,
          format: true,
          navigation: true,
          semantic: true,
          structure: true,
          verification: true,
        },
      },
    ];

    this.parseError = undefined;
    this.lowered = undefined;

    try {
      const lowered = lowerThunkSource(text, this.fileName, {
        internalImportPath: "@thunk/runtime/internal",
      });
      this.lowered = lowered;
      this.embeddedCodes = [createEmbeddedTs(lowered)];
    } catch (err) {
      this.parseError =
        err instanceof ParseError
          ? err
          : new ParseError(
              err instanceof Error ? err.message : String(err),
              0,
            );
      // Empty embedded script keeps the TS project alive; parse service reports the error.
      this.embeddedCodes = [
        {
          id: "ts",
          languageId: "typescript",
          snapshot: snapshotFromText("// thunk parse error\nexport {};\n"),
          mappings: [],
          embeddedCodes: [],
        },
      ];
    }
  }
}

function createEmbeddedTs(lowered: LoweredFile): VirtualCode {
  return {
    id: "ts",
    languageId: "typescript",
    snapshot: snapshotFromText(lowered.generatedText),
    mappings: toVolarMappings(
      lowered.sourceMap,
      lowered.originalText,
      lowered.generatedText,
    ),
    embeddedCodes: [],
  };
}

export function createThunkLanguagePlugin(
  tsModule: typeof import("typescript"),
): LanguagePlugin<URI, ThunkVirtualCode> {
  return {
    getLanguageId(uri) {
      if (uri.path.endsWith(".thunk")) return "thunk";
    },
    createVirtualCode(uri, languageId, snapshot) {
      if (languageId !== "thunk") return;
      return new ThunkVirtualCode(snapshot, fileNameFromUri(uri));
    },
    updateVirtualCode(_uri, virtualCode, snapshot) {
      virtualCode.update(snapshot);
      return virtualCode;
    },
    typescript: {
      extraFileExtensions: [
        {
          extension: "thunk",
          isMixedContent: true,
          scriptKind: 7 satisfies ts.ScriptKind.Deferred,
        },
      ],
      getServiceScript(root) {
        for (const code of forEachEmbeddedCode(root)) {
          if (code.id === "ts") {
            return {
              code,
              extension: ".ts",
              scriptKind: tsModule.ScriptKind.TS,
              preventLeadingOffset: true,
            };
          }
        }
      },
    },
  };
}
