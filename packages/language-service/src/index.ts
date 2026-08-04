/**
 * Minimal language-service proof: lower .thunk → virtual TS, ask TypeScript
 * for quick info, map back to original positions.
 *
 * Architectural kernel for the future Volar / VS Code extension.
 */

import {
  lowerThunkSource,
  originalToGenerated,
  offsetToPosition,
  positionToOffset,
  type LoweredFile,
  type Position,
} from "@thunk/language-core";
import path from "node:path";
import ts from "typescript";
import { formatThunkDisplayString } from "./volar/format-thunk-type";

export interface HoverResult {
  readonly originalPosition: Position;
  readonly generatedPosition: Position;
  readonly displayString: string;
  readonly documentation?: string;
  readonly generatedSnippet: string;
  readonly diagnostics?: string[];
}

export interface ThunkProject {
  hover(fileName: string, position: Position): HoverResult | undefined;
  getLowered(fileName: string): LoweredFile | undefined;
  getDiagnostics(fileName: string): string[];
}

export interface CreateThunkProjectOptions {
  /** Absolute paths → .thunk source text */
  files: Record<string, string>;
  /** Extra .ts files served to the language service */
  shims?: Record<string, string>;
  /** Map module name → absolute file path */
  moduleMap?: Record<string, string>;
  /** Passed to lowerThunkSource */
  runtimeImportPath?: string;
  compilerOptions?: ts.CompilerOptions;
}

export function createThunkProject(
  options: CreateThunkProjectOptions,
): ThunkProject {
  const loweredByOriginal = new Map<string, LoweredFile>();
  const virtualTs = new Map<string, string>();

  for (const [fileName, text] of Object.entries(options.files)) {
    const lowered = lowerThunkSource(text, fileName, {
      runtimeImportPath: options.runtimeImportPath ?? "@thunk/runtime",
    });
    loweredByOriginal.set(path.normalize(fileName), lowered);
    virtualTs.set(path.normalize(lowered.fileName), lowered.generatedText);
  }

  for (const [fileName, text] of Object.entries(options.shims ?? {})) {
    virtualTs.set(path.normalize(fileName), text);
  }

  // Ensure moduleMap targets are loaded
  for (const target of Object.values(options.moduleMap ?? {})) {
    const normalized = path.normalize(target);
    if (!virtualTs.has(normalized) && ts.sys.fileExists(normalized)) {
      const disk = ts.sys.readFile(normalized);
      if (disk !== undefined) virtualTs.set(normalized, disk);
    }
  }

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    ...options.compilerOptions,
  };

  const moduleMap = Object.fromEntries(
    Object.entries(options.moduleMap ?? {}).map(([k, v]) => [
      k,
      path.normalize(v),
    ]),
  );

  const rootNames = [...virtualTs.keys()];

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => rootNames,
    getScriptVersion: () => "1",
    getScriptSnapshot: (fileName) => {
      const normalized = path.normalize(fileName);
      const text = virtualTs.get(normalized);
      if (text !== undefined) {
        return ts.ScriptSnapshot.fromString(text);
      }
      if (ts.sys.fileExists(fileName)) {
        const disk = ts.sys.readFile(fileName);
        if (disk !== undefined) return ts.ScriptSnapshot.fromString(disk);
      }
      return undefined;
    },
    getCurrentDirectory: () => process.cwd(),
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: (f) => virtualTs.has(path.normalize(f)) || ts.sys.fileExists(f),
    readFile: (f) => virtualTs.get(path.normalize(f)) ?? ts.sys.readFile(f),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    resolveModuleNames(moduleNames, containingFile) {
      return moduleNames.map((name) => {
        const mapped = moduleMap[name];
        if (mapped) {
          return {
            resolvedFileName: mapped,
            isExternalLibraryImport: false,
            extension: ts.Extension.Ts,
          };
        }
        // Absolute path imports (file://-style runtime path)
        if (path.isAbsolute(name) && host.fileExists!(name)) {
          return {
            resolvedFileName: path.normalize(name),
            isExternalLibraryImport: false,
            extension: ts.Extension.Ts,
          };
        }
        const resolved = ts.resolveModuleName(
          name,
          containingFile,
          compilerOptions,
          host,
        );
        return resolved.resolvedModule;
      });
    },
  };

  const service = ts.createLanguageService(host, ts.createDocumentRegistry());

  function diagnosticsFor(genFile: string): string[] {
    const diags = [
      ...service.getSyntacticDiagnostics(genFile),
      ...service.getSemanticDiagnostics(genFile),
    ];
    return diags.map((d) =>
      ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    );
  }

  return {
    getLowered(fileName) {
      return loweredByOriginal.get(path.normalize(fileName));
    },
    getDiagnostics(fileName) {
      const lowered = loweredByOriginal.get(path.normalize(fileName));
      if (!lowered) return [];
      return diagnosticsFor(path.normalize(lowered.fileName));
    },
    hover(fileName, position) {
      const lowered = loweredByOriginal.get(path.normalize(fileName));
      if (!lowered) return undefined;

      const generatedPos = originalToGenerated(lowered.sourceMap, position);
      if (!generatedPos) return undefined;

      const genFile = path.normalize(lowered.fileName);
      const genOffset = positionToOffset(lowered.generatedText, generatedPos);
      const info = service.getQuickInfoAtPosition(genFile, genOffset);
      const diagnostics = diagnosticsFor(genFile);

      if (!info) {
        return {
          originalPosition: position,
          generatedPosition: generatedPos,
          displayString: "",
          generatedSnippet: lowered.generatedText.slice(
            Math.max(0, genOffset - 20),
            Math.min(lowered.generatedText.length, genOffset + 40),
          ),
          diagnostics,
        };
      }

      return {
        originalPosition: position,
        generatedPosition: generatedPos,
        displayString: formatThunkDisplayString(
          ts.displayPartsToString(info.displayParts),
        ),
        documentation:
          ts.displayPartsToString(info.documentation) || undefined,
        generatedSnippet: lowered.generatedText.slice(
          Math.max(0, genOffset - 20),
          Math.min(lowered.generatedText.length, genOffset + 40),
        ),
        diagnostics,
      };
    },
  };
}

export function hoverAtOffset(
  project: ThunkProject,
  fileName: string,
  sourceText: string,
  offset: number,
): HoverResult | undefined {
  return project.hover(fileName, offsetToPosition(sourceText, offset));
}
