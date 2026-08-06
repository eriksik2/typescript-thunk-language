/**
 * Feature registry: discover `*.feature.thunk`, ownership folders, placement rules.
 */

import {
  featureFileLocalName,
  featureParentQualified,
  featureQualifiedName,
  isFeatureThunkFile,
  ParseError,
  parseThunkSource,
} from "@thunk/language-core";
import * as path from "node:path";

export interface FeatureDef {
  readonly localName: string;
  readonly qualifiedName: string;
  readonly parentQualified?: string;
  /** Absolute path to `Name.feature.thunk`. */
  readonly featureFilePath: string;
  /** Directory that owns this feature (dirname of the feature file). */
  readonly folderPath: string;
  /** Tags declared on the feature file prelude. */
  readonly tags: readonly string[];
}

export interface FeaturePlacementDiagnostic {
  readonly fileName: string;
  readonly message: string;
}

export interface FeatureRegistry {
  readonly features: readonly FeatureDef[];
  readonly byQualified: ReadonlyMap<string, FeatureDef>;
  /** Longest feature folder that is a prefix of `dirPath` (inclusive). */
  owningFeature(dirOrFilePath: string): FeatureDef | undefined;
  diagnostics: readonly FeaturePlacementDiagnostic[];
}

function norm(p: string): string {
  return path.normalize(p);
}

function isUnder(child: string, parent: string): boolean {
  const c = norm(child);
  const p = norm(parent);
  if (c === p) return true;
  const prefix = p.endsWith(path.sep) ? p : p + path.sep;
  return c.startsWith(prefix);
}

function isStrictUnder(child: string, parent: string): boolean {
  const c = norm(child);
  const p = norm(parent);
  if (c === p) return false;
  return isUnder(c, p);
}

export function buildFeatureRegistry(
  files: readonly { path: string; text: string }[],
): FeatureRegistry {
  const diagnostics: FeaturePlacementDiagnostic[] = [];
  const defs: FeatureDef[] = [];
  const byQualified = new Map<string, FeatureDef>();

  for (const f of files) {
    if (!isFeatureThunkFile(f.path)) continue;
    try {
      const ast = parseThunkSource(f.text, f.path);
      const stmt = ast.statements[0];
      if (stmt?.kind !== "FeatureDeclaration") {
        diagnostics.push({
          fileName: f.path,
          message: "feature file must start with `feature <Name>`",
        });
        continue;
      }
      const localName = stmt.name.name;
      const expectedBase = featureFileLocalName(f.path);
      if (expectedBase && expectedBase !== localName) {
        diagnostics.push({
          fileName: f.path,
          message: `feature file name '${expectedBase}.feature.thunk' does not match declared feature '${localName}'`,
        });
      }
      const parentQualified = featureParentQualified(stmt);
      const qualifiedName = featureQualifiedName(stmt);
      const folderPath = path.dirname(f.path);
      const tags: string[] = [];
      if (ast.statements[1]?.kind === "TagsDeclaration") {
        for (const t of ast.statements[1].tags) tags.push(t.name);
      }
      const def: FeatureDef = {
        localName,
        qualifiedName,
        parentQualified,
        featureFilePath: f.path,
        folderPath,
        tags,
      };
      if (byQualified.has(qualifiedName)) {
        diagnostics.push({
          fileName: f.path,
          message: `duplicate feature '${qualifiedName}'`,
        });
        continue;
      }
      byQualified.set(qualifiedName, def);
      defs.push(def);
    } catch (e) {
      const message =
        e instanceof ParseError
          ? e.message.replace(/\s*\(at offset \d+\)\s*$/, "")
          : e instanceof Error
            ? e.message
            : String(e);
      diagnostics.push({ fileName: f.path, message });
    }
  }

  // Parent existence + folder placement for subfeatures
  for (const def of defs) {
    if (!def.parentQualified) {
      continue;
    }
    const parent = byQualified.get(def.parentQualified);
    if (!parent) {
      diagnostics.push({
        fileName: def.featureFilePath,
        message: `parent feature '${def.parentQualified}' not found`,
      });
      continue;
    }
    if (!isStrictUnder(def.folderPath, parent.folderPath)) {
      diagnostics.push({
        fileName: def.featureFilePath,
        message: `subfeature '${def.qualifiedName}' must live in a nested subfolder of '${def.parentQualified}'`,
      });
      continue;
    }
    // Nearest ancestor feature folder (excluding self) must be the declared parent
    const nearest = nearestFeatureFolder(def.folderPath, defs, def);
    if (nearest && nearest.qualifiedName !== def.parentQualified) {
      diagnostics.push({
        fileName: def.featureFilePath,
        message: `subfeature '${def.qualifiedName}' sits under feature '${nearest.qualifiedName}', but declares parent '${def.parentQualified}'`,
      });
    }
  }

  function owningFeature(dirOrFilePath: string): FeatureDef | undefined {
    const dir = path.extname(dirOrFilePath)
      ? path.dirname(dirOrFilePath)
      : dirOrFilePath;
    return nearestFeatureFolder(dir, defs);
  }

  return {
    features: defs,
    byQualified,
    owningFeature,
    diagnostics,
  };
}

/** Feature with the longest folderPath that is a prefix of `dir` (optionally excluding one). */
function nearestFeatureFolder(
  dir: string,
  defs: readonly FeatureDef[],
  exclude?: FeatureDef,
): FeatureDef | undefined {
  let best: FeatureDef | undefined;
  for (const d of defs) {
    if (exclude && d.qualifiedName === exclude.qualifiedName) continue;
    if (!isUnder(dir, d.folderPath)) continue;
    if (
      !best ||
      norm(d.folderPath).length > norm(best.folderPath).length
    ) {
      best = d;
    }
  }
  return best;
}

/**
 * Validate that a member file's declared feature matches folder ownership.
 * Feature definition files are checked separately in the registry build.
 */
export function validateMemberPlacement(
  filePath: string,
  declaredQualified: string,
  registry: FeatureRegistry,
): FeaturePlacementDiagnostic | undefined {
  if (isFeatureThunkFile(filePath)) return undefined;
  const owner = registry.owningFeature(filePath);
  if (!owner) {
    return {
      fileName: filePath,
      message: `file declares feature '${declaredQualified}' but is not under any feature folder (add a *.feature.thunk ancestor)`,
    };
  }
  if (owner.qualifiedName !== declaredQualified) {
    return {
      fileName: filePath,
      message: `file declares feature '${declaredQualified}' but folder belongs to '${owner.qualifiedName}'`,
    };
  }
  return undefined;
}
