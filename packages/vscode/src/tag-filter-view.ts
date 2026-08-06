/**
 * Horizontal feature-tag toggle bar (WebviewView).
 */

import type { ThunkCodeBrowserProvider } from "./code-browser";
import * as vscode from "vscode";

export class ThunkTagFilterViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "thunk.tagFilters";

  private view?: vscode.WebviewView;
  private selected = new Set<string>();

  constructor(private readonly browser: ThunkCodeBrowserProvider) {
    browser.onDidChangeTreeData(() => this.render());
  }

  getSelectedTags(): string[] {
    return [...this.selected];
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "toggle" && typeof msg.tag === "string") {
        if (this.selected.has(msg.tag)) this.selected.delete(msg.tag);
        else this.selected.add(msg.tag);
        this.browser.setTagFilter([...this.selected]);
        this.render();
      }
      if (msg?.type === "clear") {
        this.selected.clear();
        this.browser.setTagFilter([]);
        this.render();
      }
    });
    this.render();
  }

  private render(): void {
    if (!this.view) return;
    const index = this.browser.getIndex();
    const tags = index?.featureTags ?? [];
    // Drop selected tags that no longer exist
    for (const t of [...this.selected]) {
      if (!tags.includes(t)) this.selected.delete(t);
    }
    const chips = tags
      .map((t) => {
        const on = this.selected.has(t);
        return `<button class="chip${on ? " on" : ""}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`;
      })
      .join("");

    this.view.webview.html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<style>
  body { margin: 0; padding: 6px 8px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
  .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .chip {
    border: 1px solid var(--vscode-button-border, var(--vscode-widget-border));
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border-radius: 999px;
    padding: 2px 10px;
    cursor: pointer;
    font: inherit;
  }
  .chip.on {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .chip:hover { filter: brightness(1.08); }
  .muted { opacity: 0.7; font-size: 0.9em; }
  .clear { margin-left: auto; background: transparent; border: none; color: var(--vscode-textLink-foreground); cursor: pointer; font: inherit; text-decoration: underline; }
</style>
</head><body>
  <div class="row">
    ${tags.length === 0 ? `<span class="muted">No feature tags</span>` : chips}
    ${this.selected.size > 0 ? `<button class="clear" id="clear">Clear</button>` : ""}
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    for (const btn of document.querySelectorAll('.chip')) {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'toggle', tag: btn.getAttribute('data-tag') });
      });
    }
    document.getElementById('clear')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'clear' });
    });
  </script>
</body></html>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
