/**
 * Workspace index over `.thunk` prelude metadata (`feature` / `file` / `tags`).
 * Pure: no FS — callers supply path + text.
 */

import {
  featureQualifiedName,
  fileOwningFeature,
  isFeatureThunkFile,
  ParseError,
  parseThunkSource,
} from "@thunk/language-core";
import {
  buildFeatureRegistry,
  validateMemberPlacement,
  type FeatureDef,
  type FeaturePlacementDiagnostic,
  type FeatureRegistry,
} from "./feature-registry";

export interface ThunkFileMeta {
  readonly fileName: string;
  /** Fully qualified owning feature id. */
  readonly feature?: string;
  /** Local name: feature local or `file` name. */
  readonly localName?: string;
  readonly tags: readonly string[];
  readonly isFeatureFile: boolean;
  readonly valid: boolean;
  readonly error?: string;
}

export interface ThunkWorkspaceIndex {
  readonly files: readonly ThunkFileMeta[];
  readonly byFeature: ReadonlyMap<string, readonly ThunkFileMeta[]>;
  readonly byTag: ReadonlyMap<string, readonly ThunkFileMeta[]>;
  /** All tags declared on feature definition files. */
  readonly featureTags: readonly string[];
  readonly registry: FeatureRegistry;
  readonly placementDiagnostics: readonly FeaturePlacementDiagnostic[];
  readonly featureTree: readonly FeatureTreeNode[];
  filter(query: string): readonly ThunkFileMeta[];
  /** Features matching selected tag toggles (OR). Empty selection → all. */
  featuresMatchingTags(selectedTags: readonly string[]): readonly FeatureDef[];
}

export interface FeatureTreeNode {
  readonly feature: FeatureDef;
  readonly files: readonly ThunkFileMeta[];
  readonly children: readonly FeatureTreeNode[];
}

export function extractThunkFileMeta(
  fileName: string,
  text: string,
): ThunkFileMeta {
  const isFeatureFile = isFeatureThunkFile(fileName);
  try {
    const ast = parseThunkSource(text, fileName);
    const first = ast.statements[0];
    const tags: string[] = [];
    if (ast.statements[1]?.kind === "TagsDeclaration") {
      for (const t of ast.statements[1].tags) tags.push(t.name);
    }

    if (isFeatureFile) {
      if (first?.kind !== "FeatureDeclaration") {
        return {
          fileName,
          tags: [],
          isFeatureFile,
          valid: false,
          error: "feature file must start with `feature <Name>`",
        };
      }
      return {
        fileName,
        feature: featureQualifiedName(first),
        localName: first.name.name,
        tags,
        isFeatureFile,
        valid: true,
      };
    }

    if (first?.kind !== "FileDeclaration") {
      return {
        fileName,
        tags: [],
        isFeatureFile,
        valid: false,
        error: "code file must start with `file <Name> of <Feature.Path>`",
      };
    }
    return {
      fileName,
      feature: fileOwningFeature(first),
      localName: first.name.name,
      tags,
      isFeatureFile,
      valid: true,
    };
  } catch (e) {
    const message =
      e instanceof ParseError
        ? e.message.replace(/\s*\(at offset \d+\)\s*$/, "")
        : e instanceof Error
          ? e.message
          : String(e);
    return {
      fileName,
      tags: [],
      isFeatureFile,
      valid: false,
      error: message,
    };
  }
}

export function indexThunkWorkspace(
  files: readonly { path: string; text: string }[],
): ThunkWorkspaceIndex {
  const registry = buildFeatureRegistry(files);
  const metas = files.map((f) => extractThunkFileMeta(f.path, f.text));
  const placementDiagnostics: FeaturePlacementDiagnostic[] = [
    ...registry.diagnostics,
  ];

  for (const meta of metas) {
    if (!meta.valid || !meta.feature || meta.isFeatureFile) continue;
    const d = validateMemberPlacement(
      meta.fileName,
      meta.feature,
      registry,
    );
    if (d) placementDiagnostics.push(d);
  }

  const byFeature = new Map<string, ThunkFileMeta[]>();
  const byTag = new Map<string, ThunkFileMeta[]>();
  const featureTagSet = new Set<string>();

  for (const f of registry.features) {
    for (const t of f.tags) featureTagSet.add(t);
  }

  for (const meta of metas) {
    if (!meta.valid || !meta.feature) {
      const bucket = byFeature.get("(invalid)") ?? [];
      bucket.push(meta);
      byFeature.set("(invalid)", bucket);
      continue;
    }
    const feat = byFeature.get(meta.feature) ?? [];
    feat.push(meta);
    byFeature.set(meta.feature, feat);
    for (const tag of meta.tags) {
      const t = byTag.get(tag) ?? [];
      t.push(meta);
      byTag.set(tag, t);
    }
  }

  for (const [, list] of byFeature) {
    list.sort((a, b) => a.fileName.localeCompare(b.fileName));
  }
  for (const [, list] of byTag) {
    list.sort((a, b) => a.fileName.localeCompare(b.fileName));
  }
  const sortedFiles = [...metas].sort((a, b) =>
    a.fileName.localeCompare(b.fileName),
  );

  const featureTags = [...featureTagSet].sort((a, b) => a.localeCompare(b));
  const featureTree = buildFeatureTree(registry, byFeature);

  return {
    files: sortedFiles,
    byFeature,
    byTag,
    featureTags,
    registry,
    placementDiagnostics,
    featureTree,
    filter(query: string) {
      const q = query.trim().toLowerCase();
      if (!q) return sortedFiles;
      return sortedFiles.filter((m) => {
        if (m.fileName.toLowerCase().includes(q)) return true;
        if (m.feature?.toLowerCase().includes(q)) return true;
        if (m.localName?.toLowerCase().includes(q)) return true;
        if (m.tags.some((t) => t.toLowerCase().includes(q))) return true;
        return false;
      });
    },
    featuresMatchingTags(selectedTags: readonly string[]) {
      if (selectedTags.length === 0) return registry.features;
      const selected = new Set(selectedTags);
      return registry.features.filter((f) =>
        f.tags.some((t) => selected.has(t)),
      );
    },
  };
}

function buildFeatureTree(
  registry: FeatureRegistry,
  byFeature: Map<string, ThunkFileMeta[]>,
): FeatureTreeNode[] {
  const nodes = new Map<string, FeatureTreeNode>();
  for (const f of registry.features) {
    nodes.set(f.qualifiedName, {
      feature: f,
      files: byFeature.get(f.qualifiedName) ?? [],
      children: [],
    });
  }
  const roots: FeatureTreeNode[] = [];
  for (const f of registry.features) {
    const node = nodes.get(f.qualifiedName)!;
    if (f.parentQualified && nodes.has(f.parentQualified)) {
      const parent = nodes.get(f.parentQualified)!;
      (parent.children as FeatureTreeNode[]).push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (list: FeatureTreeNode[]) => {
    list.sort((a, b) =>
      a.feature.localName.localeCompare(b.feature.localName),
    );
    for (const n of list) sortRec(n.children as FeatureTreeNode[]);
  };
  sortRec(roots);
  return roots;
}

export type {
  FeatureDef,
  FeaturePlacementDiagnostic,
  FeatureRegistry,
} from "./feature-registry";
export { buildFeatureRegistry, validateMemberPlacement } from "./feature-registry";
