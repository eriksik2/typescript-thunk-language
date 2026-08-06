/**
 * Thunk Code Browser — hierarchical features; +file / +feature create flows.
 */

import {
  emptyFeaturePreludeSnippet,
  emptyFilePreludeSnippet,
  parseThunkSource,
} from "@thunk/language-core";
import {
  indexThunkWorkspace,
  type FeatureDef,
  type FeatureTreeNode,
  type ThunkFileMeta,
  type ThunkWorkspaceIndex,
} from "@thunk/language-service";
import * as path from "node:path";
import * as vscode from "vscode";
import { ThunkTagFilterViewProvider } from "./tag-filter-view";

export type BrowserGroupMode = "files" | "features" | "tags";

type BrowserNode =
  | {
      kind: "feature";
      id: string;
      feature: FeatureDef;
      children: BrowserNode[];
    }
  | { kind: "group"; id: string; label: string; children: BrowserNode[] }
  | { kind: "file"; id: string; meta: ThunkFileMeta }
  | {
      kind: "action";
      id: string;
      label: string;
      action: "addFile" | "addFeature";
      featureQualified?: string;
      featureFolder?: string;
    };

interface PendingFeatureCreate {
  kind: "feature";
  parentQualified?: string;
  parentFolder: string;
}

interface PendingFileCreate {
  kind: "file";
  featureQualified: string;
  featureFolder: string;
}

type PendingCreate = PendingFeatureCreate | PendingFileCreate;

export class ThunkCodeBrowserProvider
  implements vscode.TreeDataProvider<BrowserNode>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    BrowserNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private mode: BrowserGroupMode = "features";
  private filterQuery = "";
  private tagFilter: string[] = [];
  private index: ThunkWorkspaceIndex | undefined;
  private refreshing: Promise<void> | undefined;

  getMode(): BrowserGroupMode {
    return this.mode;
  }

  getFilter(): string {
    return this.filterQuery;
  }

  getIndex(): ThunkWorkspaceIndex | undefined {
    return this.index;
  }

  setMode(mode: BrowserGroupMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this._onDidChangeTreeData.fire();
  }

  setFilter(query: string): void {
    this.filterQuery = query;
    this._onDidChangeTreeData.fire();
  }

  setTagFilter(tags: string[]): void {
    this.tagFilter = [...tags];
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    void this.rebuild();
  }

  async rebuild(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRebuild().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async doRebuild(): Promise<void> {
    const uris = await vscode.workspace.findFiles(
      "**/*.thunk",
      "**/{node_modules,dist,.git}/**",
    );
    const entries: { path: string; text: string }[] = [];
    for (const uri of uris) {
      try {
        const raw = await vscode.workspace.fs.readFile(uri);
        entries.push({
          path: uri.fsPath,
          text: Buffer.from(raw).toString("utf8"),
        });
      } catch {
        entries.push({ path: uri.fsPath, text: "\n" });
      }
    }
    this.index = indexThunkWorkspace(entries);
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: BrowserNode): vscode.TreeItem {
    if (element.kind === "action") {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.None,
      );
      item.id = element.id;
      item.command = {
        command:
          element.action === "addFile"
            ? "thunk.codeBrowser.addFile"
            : "thunk.codeBrowser.addFeature",
        title: element.label,
        arguments: [element.featureQualified, element.featureFolder],
      };
      item.iconPath = new vscode.ThemeIcon(
        element.action === "addFile" ? "new-file" : "new-folder",
      );
      item.contextValue = "thunkAction";
      return item;
    }
    if (element.kind === "feature") {
      const item = new vscode.TreeItem(
        element.feature.localName,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.id = element.id;
      item.description = element.feature.parentQualified
        ? `of ${element.feature.parentQualified}`
        : element.feature.tags.length > 0
          ? element.feature.tags.join(" ")
          : undefined;
      item.tooltip = [
        element.feature.qualifiedName,
        element.feature.tags.length
          ? `tags ${element.feature.tags.join(", ")}`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n");
      item.contextValue = "thunkFeature";
      item.iconPath = new vscode.ThemeIcon("symbol-structure");
      return item;
    }
    if (element.kind === "group") {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.contextValue = "thunkGroup";
      item.id = element.id;
      return item;
    }
    const base = path.basename(element.meta.fileName);
    const item = new vscode.TreeItem(
      base,
      vscode.TreeItemCollapsibleState.None,
    );
    item.id = element.id;
    item.resourceUri = vscode.Uri.file(element.meta.fileName);
    item.command = {
      command: "vscode.open",
      title: "Open",
      arguments: [vscode.Uri.file(element.meta.fileName)],
    };
    item.tooltip = this.fileTooltip(element.meta);
    item.description = this.fileDescription(element.meta);
    item.contextValue = element.meta.valid ? "thunkFile" : "thunkFileInvalid";
    if (element.meta.isFeatureFile) {
      item.iconPath = new vscode.ThemeIcon("symbol-class");
    }
    return item;
  }

  getChildren(element?: BrowserNode): BrowserNode[] {
    if (!this.index) return [];
    if (element) {
      if (element.kind === "feature" || element.kind === "group") {
        return element.children;
      }
      return [];
    }
    return this.rootNodes();
  }

  private rootNodes(): BrowserNode[] {
    const index = this.index!;
    const filtered = new Set(
      index.filter(this.filterQuery).map((m) => m.fileName),
    );
    const allowedFeatures = new Set(
      index.featuresMatchingTags(this.tagFilter).map((f) => f.qualifiedName),
    );

    if (this.mode === "files") {
      const files = index.files.filter((m) => {
        if (!filtered.has(m.fileName)) return false;
        if (this.tagFilter.length === 0) return true;
        return m.feature ? allowedFeatures.has(m.feature) : false;
      });
      const tree = this.folderTree(files);
      tree.push(this.actionNode("addFeature", undefined, this.workspaceRoot()));
      return tree;
    }

    if (this.mode === "features") {
      const roots = this.mapFeatureTree(
        index.featureTree,
        filtered,
        allowedFeatures,
      );
      const invalid = index.files.filter(
        (m) => filtered.has(m.fileName) && (!m.valid || !m.feature),
      );
      const claimed = new Set(
        index.registry.features.flatMap((f) =>
          (index.byFeature.get(f.qualifiedName) ?? []).map((m) => m.fileName),
        ),
      );
      const orphans = index.files.filter(
        (m) =>
          filtered.has(m.fileName) &&
          m.valid &&
          m.feature &&
          !claimed.has(m.fileName) &&
          !m.isFeatureFile,
      );
      if (orphans.length > 0 || invalid.length > 0) {
        roots.push({
          kind: "group",
          id: "group:(unplaced)",
          label: "(unplaced)",
          children: [...orphans, ...invalid].map((m) => ({
            kind: "file" as const,
            id: `unplaced:${m.fileName}`,
            meta: m,
          })),
        });
      }
      roots.push(
        this.actionNode("addFeature", undefined, this.workspaceRoot()),
      );
      return roots;
    }

    // tags mode — group member files by their own tags (legacy browse)
    const files = index.files.filter((m) => filtered.has(m.fileName));
    const groups: BrowserNode[] = [];
    const keys = [...index.byTag.keys()].sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      const members = (index.byTag.get(key) ?? []).filter((m) =>
        filtered.has(m.fileName),
      );
      if (members.length === 0) continue;
      groups.push({
        kind: "group",
        id: `tag:${key}`,
        label: key,
        children: members.map((m) => ({
          kind: "file" as const,
          id: `tag:${key}:${m.fileName}`,
          meta: m,
        })),
      });
    }
    return groups;
  }

  private mapFeatureTree(
    nodes: readonly FeatureTreeNode[],
    filtered: Set<string>,
    allowedFeatures: Set<string>,
  ): BrowserNode[] {
    const out: BrowserNode[] = [];
    for (const node of nodes) {
      const childFeatures = this.mapFeatureTree(
        node.children,
        filtered,
        allowedFeatures,
      );
      const selfAllowed =
        this.tagFilter.length === 0 ||
        allowedFeatures.has(node.feature.qualifiedName);
      // Keep ancestors if any descendant matches tag filter
      if (!selfAllowed && childFeatures.length === 0) continue;

      const memberFiles = selfAllowed
        ? node.files.filter((m) => filtered.has(m.fileName))
        : [];
      const children: BrowserNode[] = [
        ...memberFiles.map((m) => ({
          kind: "file" as const,
          id: `feature:${node.feature.qualifiedName}:${m.fileName}`,
          meta: m,
        })),
        ...childFeatures,
        this.actionNode(
          "addFile",
          node.feature.qualifiedName,
          node.feature.folderPath,
        ),
        this.actionNode(
          "addFeature",
          node.feature.qualifiedName,
          node.feature.folderPath,
        ),
      ];
      if (
        this.filterQuery.trim() &&
        memberFiles.length === 0 &&
        childFeatures.length === 0
      ) {
        continue;
      }
      out.push({
        kind: "feature",
        id: `feature:${node.feature.qualifiedName}`,
        feature: node.feature,
        children,
      });
    }
    return out;
  }

  private actionNode(
    action: "addFile" | "addFeature",
    featureQualified: string | undefined,
    featureFolder: string | undefined,
  ): BrowserNode {
    const label = action === "addFile" ? "+ file" : "+ feature";
    return {
      kind: "action",
      id: `action:${action}:${featureQualified ?? "root"}`,
      label,
      action,
      featureQualified,
      featureFolder,
    };
  }

  private workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private folderTree(files: readonly ThunkFileMeta[]): BrowserNode[] {
    const rootPath = this.workspaceRoot();
    type DirNode = {
      kind: "dir";
      name: string;
      dirs: Map<string, DirNode>;
      files: ThunkFileMeta[];
    };
    const root: DirNode = { kind: "dir", name: "", dirs: new Map(), files: [] };

    for (const meta of files) {
      let rel = meta.fileName;
      if (rootPath && meta.fileName.startsWith(rootPath)) {
        rel = meta.fileName.slice(rootPath.length).replace(/^[/\\]/, "");
      }
      const parts = rel.split(/[/\\]/);
      let cur = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]!;
        let next = cur.dirs.get(part);
        if (!next) {
          next = { kind: "dir", name: part, dirs: new Map(), files: [] };
          cur.dirs.set(part, next);
        }
        cur = next;
      }
      cur.files.push(meta);
    }

    const toBrowser = (dir: DirNode, prefix: string): BrowserNode[] => {
      const out: BrowserNode[] = [];
      const dirNames = [...dir.dirs.keys()].sort((a, b) => a.localeCompare(b));
      for (const name of dirNames) {
        const child = dir.dirs.get(name)!;
        const id = `${prefix}/${name}`;
        out.push({
          kind: "group",
          id: `dir:${id}`,
          label: name,
          children: toBrowser(child, id),
        });
      }
      const sortedFiles = [...dir.files].sort((a, b) =>
        path.basename(a.fileName).localeCompare(path.basename(b.fileName)),
      );
      for (const meta of sortedFiles) {
        out.push({
          kind: "file",
          id: `file:${meta.fileName}`,
          meta,
        });
      }
      return out;
    };

    return toBrowser(root, "");
  }

  private fileTooltip(meta: ThunkFileMeta): string {
    if (!meta.valid) {
      return `${meta.fileName}\n${meta.error ?? "invalid"}`;
    }
    const kind = meta.isFeatureFile ? "feature" : "file";
    return `${meta.fileName}\n${kind} ${meta.localName} → ${meta.feature}`;
  }

  private fileDescription(meta: ThunkFileMeta): string | undefined {
    if (!meta.valid) return "invalid";
    if (this.mode === "features") {
      return meta.isFeatureFile ? undefined : meta.localName;
    }
    return meta.feature;
  }
}

export function registerCodeBrowser(
  context: vscode.ExtensionContext,
): ThunkCodeBrowserProvider {
  const provider = new ThunkCodeBrowserProvider();
  const pendingCreates = new Map<string, PendingCreate>();
  const tagProvider = new ThunkTagFilterViewProvider(provider);

  const view = vscode.window.createTreeView("thunk.codeBrowser", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  const updateTitle = () => {
    const modeLabel =
      provider.getMode() === "files"
        ? "Files"
        : provider.getMode() === "features"
          ? "Features"
          : "Tags";
    const filter = provider.getFilter().trim();
    view.description = filter ? `${modeLabel} · filter: ${filter}` : modeLabel;
  };

  const watchRebuild = () => {
    provider.refresh();
    updateTitle();
  };

  void provider.rebuild().then(updateTitle);

  const watcher = vscode.workspace.createFileSystemWatcher("**/*.thunk");
  watcher.onDidCreate(watchRebuild);
  watcher.onDidChange(() => {
    watchRebuild();
  });
  watcher.onDidDelete(watchRebuild);

  async function setPendingContext(docUri?: string): Promise<void> {
    const pending = docUri ? pendingCreates.get(docUri) : undefined;
    await vscode.commands.executeCommand(
      "setContext",
      "thunk.pendingFeatureCreate",
      pending?.kind === "feature",
    );
    await vscode.commands.executeCommand(
      "setContext",
      "thunk.pendingFileCreate",
      pending?.kind === "file",
    );
  }

  async function addFile(
    featureQualified?: string,
    featureFolder?: string,
  ): Promise<void> {
    if (!featureQualified || !featureFolder) {
      vscode.window.showErrorMessage(
        "Select a feature section to add a file (+ file under a feature).",
      );
      return;
    }
    const snippet = emptyFilePreludeSnippet(featureQualified);
    const doc = await vscode.workspace.openTextDocument({
      language: "thunk",
      content: snippet.text,
    });
    const editor = await vscode.window.showTextDocument(doc);
    const pos = editor.document.positionAt(snippet.nameOffset);
    editor.selection = new vscode.Selection(pos, pos);
    pendingCreates.set(doc.uri.toString(), {
      kind: "file",
      featureQualified,
      featureFolder,
    });
    await setPendingContext(doc.uri.toString());
    vscode.window.setStatusBarMessage(
      "Type the file name, then Save (⌘S) to create Name.thunk",
      8000,
    );
  }

  async function addFeature(
    parentQualified?: string,
    parentFolder?: string,
  ): Promise<void> {
    const folder =
      parentFolder ??
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) {
      vscode.window.showErrorMessage("No workspace folder open.");
      return;
    }
    const snippet = emptyFeaturePreludeSnippet(parentQualified);
    const doc = await vscode.workspace.openTextDocument({
      language: "thunk",
      content: snippet.text,
    });
    const editor = await vscode.window.showTextDocument(doc);
    const pos = editor.document.positionAt(snippet.nameOffset);
    editor.selection = new vscode.Selection(pos, pos);
    pendingCreates.set(doc.uri.toString(), {
      kind: "feature",
      parentQualified,
      parentFolder: folder,
    });
    await setPendingContext(doc.uri.toString());
    vscode.window.setStatusBarMessage(
      "Type the feature name, then Save (⌘S) to create the folder and .feature.thunk",
      8000,
    );
  }

  async function commitNewFeature(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const key = editor.document.uri.toString();
    const pending = pendingCreates.get(key);
    if (!pending || pending.kind !== "feature") return;

    const text = editor.document.getText();
    let localName: string;
    let declaredParent: string | undefined;
    try {
      const ast = parseThunkSource(text, "pending.feature.thunk");
      const stmt = ast.statements[0];
      if (stmt?.kind !== "FeatureDeclaration") {
        vscode.window.showErrorMessage(
          "Feature file must start with `feature <Name>`.",
        );
        return;
      }
      localName = stmt.name.name;
      if (!localName) {
        vscode.window.showErrorMessage("Enter a feature name after `feature`.");
        return;
      }
      declaredParent = stmt.ofPath?.map((p) => p.name).join(".");
    } catch (e) {
      vscode.window.showErrorMessage(
        e instanceof Error ? e.message : String(e),
      );
      return;
    }

    if (pending.parentQualified) {
      if (declaredParent !== pending.parentQualified) {
        vscode.window.showErrorMessage(
          `Expected \`feature ${localName} of ${pending.parentQualified}\`.`,
        );
        return;
      }
    } else if (declaredParent) {
      vscode.window.showErrorMessage(
        "Root feature must be `feature Name` (no `of`).",
      );
      return;
    }

    const featureDir = path.join(pending.parentFolder, localName);
    const dest = path.join(featureDir, `${localName}.feature.thunk`);
    const destUri = vscode.Uri.file(dest);
    try {
      await vscode.workspace.fs.stat(destUri);
      vscode.window.showErrorMessage(`Feature already exists: ${dest}`);
      return;
    } catch {
      // ok
    }

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(featureDir));
    let body = text;
    if (!body.endsWith("\n")) body += "\n";
    await vscode.workspace.fs.writeFile(destUri, Buffer.from(body, "utf8"));

    pendingCreates.delete(key);
    await setPendingContext();
    await vscode.commands.executeCommand(
      "workbench.action.revertAndCloseActiveEditor",
    );
    const created = await vscode.workspace.openTextDocument(destUri);
    await vscode.window.showTextDocument(created);
    watchRebuild();
  }

  async function commitNewFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const key = editor.document.uri.toString();
    const pending = pendingCreates.get(key);
    if (!pending || pending.kind !== "file") return;

    const text = editor.document.getText();
    let localName: string;
    let owningFeature: string;
    try {
      const ast = parseThunkSource(text, "pending.thunk");
      const stmt = ast.statements[0];
      if (stmt?.kind !== "FileDeclaration") {
        vscode.window.showErrorMessage(
          "Code file must start with `file <Name> of <Feature.Path>`.",
        );
        return;
      }
      localName = stmt.name.name;
      if (!localName) {
        vscode.window.showErrorMessage("Enter a file name after `file`.");
        return;
      }
      owningFeature = stmt.ofPath.map((p) => p.name).join(".");
    } catch (e) {
      vscode.window.showErrorMessage(
        e instanceof Error ? e.message : String(e),
      );
      return;
    }

    if (owningFeature !== pending.featureQualified) {
      vscode.window.showErrorMessage(
        `Expected \`file ${localName} of ${pending.featureQualified}\`.`,
      );
      return;
    }

    const dest = path.join(pending.featureFolder, `${localName}.thunk`);
    const destUri = vscode.Uri.file(dest);
    try {
      await vscode.workspace.fs.stat(destUri);
      vscode.window.showErrorMessage(`File already exists: ${dest}`);
      return;
    } catch {
      // ok
    }

    let body = text;
    if (!body.endsWith("\n")) body += "\n";
    await vscode.workspace.fs.writeFile(destUri, Buffer.from(body, "utf8"));

    pendingCreates.delete(key);
    await setPendingContext();
    await vscode.commands.executeCommand(
      "workbench.action.revertAndCloseActiveEditor",
    );
    const created = await vscode.workspace.openTextDocument(destUri);
    await vscode.window.showTextDocument(created);
    watchRebuild();
  }

  context.subscriptions.push(
    view,
    watcher,
    vscode.window.registerWebviewViewProvider(
      ThunkTagFilterViewProvider.viewType,
      tagProvider,
    ),
    vscode.commands.registerCommand("thunk.codeBrowser.refresh", () => {
      provider.refresh();
      updateTitle();
    }),
    vscode.commands.registerCommand("thunk.codeBrowser.setModeFiles", () => {
      provider.setMode("files");
      updateTitle();
    }),
    vscode.commands.registerCommand("thunk.codeBrowser.setModeFeatures", () => {
      provider.setMode("features");
      updateTitle();
    }),
    vscode.commands.registerCommand("thunk.codeBrowser.setModeTags", () => {
      provider.setMode("tags");
      updateTitle();
    }),
    vscode.commands.registerCommand("thunk.codeBrowser.filter", async () => {
      const value = await vscode.window.showInputBox({
        title: "Filter Thunk Code Browser",
        prompt: "Match file name, feature, or tag (case-insensitive)",
        value: provider.getFilter(),
      });
      if (value === undefined) return;
      provider.setFilter(value);
      updateTitle();
    }),
    vscode.commands.registerCommand("thunk.codeBrowser.clearFilter", () => {
      provider.setFilter("");
      updateTitle();
    }),
    vscode.commands.registerCommand("thunk.codeBrowser.addFile", (...args) =>
      addFile(
        args[0] as string | undefined,
        args[1] as string | undefined,
      ),
    ),
    vscode.commands.registerCommand("thunk.codeBrowser.addFeature", (...args) =>
      addFeature(
        args[0] as string | undefined,
        args[1] as string | undefined,
      ),
    ),
    vscode.commands.registerCommand(
      "thunk.codeBrowser.commitNewFeature",
      () => commitNewFeature(),
    ),
    vscode.commands.registerCommand(
      "thunk.codeBrowser.commitNewFile",
      () => commitNewFile(),
    ),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === "thunk" || doc.fileName.endsWith(".thunk")) {
        watchRebuild();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(async (ed) => {
      await setPendingContext(ed?.document.uri.toString());
    }),
    vscode.workspace.onDidCreateFiles(async (e) => {
      for (const uri of e.files) {
        if (!uri.fsPath.endsWith(".thunk")) continue;
        if (uri.fsPath.endsWith(".feature.thunk")) continue;
        try {
          const raw = await vscode.workspace.fs.readFile(uri);
          if (raw.byteLength > 0) continue;
        } catch {
          continue;
        }
        const index =
          provider.getIndex() ??
          (await provider.rebuild(), provider.getIndex());
        const owner = index?.registry.owningFeature(uri.fsPath);
        if (!owner) continue;
        const base = path.basename(uri.fsPath, ".thunk");
        const ident = base.replace(/[^A-Za-z0-9_]/g, "_");
        const name = /^[A-Za-z_]/.test(ident) ? ident : `f_${ident}`;
        const content = `file ${name} of ${owner.qualifiedName}\n\n`;
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
      }
      watchRebuild();
    }),
  );

  return provider;
}
