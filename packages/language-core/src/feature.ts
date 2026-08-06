/**
 * Feature / file prelude helpers (qualified names, formatting).
 */

import type { FeatureDeclaration, FileDeclaration, Identifier } from "./ast";

/** Local feature name (the ident after `feature`). */
export function featureLocalName(decl: FeatureDeclaration): string {
  return decl.name.name;
}

/** Parent qualified path, or undefined for a root feature. */
export function featureParentQualified(
  decl: FeatureDeclaration,
): string | undefined {
  if (!decl.ofPath || decl.ofPath.length === 0) return undefined;
  return decl.ofPath.map((p) => p.name).join(".");
}

/** Fully qualified feature id: `Name` or `Parent.Path.Name`. */
export function featureQualifiedName(decl: FeatureDeclaration): string {
  const parent = featureParentQualified(decl);
  return parent ? `${parent}.${decl.name.name}` : decl.name.name;
}

/** Owning feature qualified path from `file Name of Feature.Path`. */
export function fileOwningFeature(decl: FileDeclaration): string {
  return decl.ofPath.map((p) => p.name).join(".");
}

/** `feature Name` or `feature Name of A.B` (no trailing newline). */
export function formatFeaturePreludeLine(
  localName: string,
  parentQualified?: string,
): string {
  if (parentQualified) {
    return `feature ${localName} of ${parentQualified}`;
  }
  return `feature ${localName}`;
}

/** `file Name of Feature.Path` (no trailing newline). */
export function formatFilePreludeLine(
  fileName: string,
  featureQualified: string,
): string {
  return `file ${fileName} of ${featureQualified}`;
}

/**
 * Snippet for a new feature editor: name left empty for the user to type.
 * Returns `{ text, nameOffset }` where `nameOffset` is the cursor index.
 */
export function emptyFeaturePreludeSnippet(parentQualified?: string): {
  text: string;
  nameOffset: number;
} {
  if (parentQualified) {
    const prefix = "feature ";
    const suffix = ` of ${parentQualified}\n`;
    return { text: prefix + suffix, nameOffset: prefix.length };
  }
  const text = "feature \n";
  return { text, nameOffset: "feature ".length };
}

/**
 * Snippet for a new code file: `file  of Feature.Path` with cursor on the name.
 */
export function emptyFilePreludeSnippet(featureQualified: string): {
  text: string;
  nameOffset: number;
} {
  const prefix = "file ";
  const suffix = ` of ${featureQualified}\n`;
  return { text: prefix + suffix, nameOffset: prefix.length };
}

/** @deprecated Use emptyFilePreludeSnippet / formatFilePreludeLine */
export function memberFilePrelude(qualifiedFeature: string): string {
  return `file newFile of ${qualifiedFeature}\n`;
}

export function isFeatureThunkFile(fileName: string): boolean {
  return /(^|[/\\])[^/\\]+\.feature\.thunk$/.test(fileName);
}

/** `BankImportSystem.feature.thunk` → `BankImportSystem` */
export function featureFileLocalName(fileName: string): string | undefined {
  const base = fileName.replace(/^.*[/\\]/, "");
  const m = /^(.+)\.feature\.thunk$/.exec(base);
  return m?.[1];
}

export function ofPathFromQualified(parentQualified: string): Identifier[] {
  return parentQualified.split(".").filter(Boolean).map((name) => ({
    kind: "Identifier" as const,
    name,
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    },
  }));
}
