/**
 * Rewrite Thunk types inside LSP hover markdown / MarkedString contents.
 */

import type { Hover, MarkedString, MarkupContent } from "vscode-languageserver-protocol";
import { formatHoverDisplayString } from "./format-thunk-type";

function prettyMarkedString(content: MarkedString): MarkedString {
  if (typeof content === "string") {
    return formatHoverDisplayString(content);
  }
  return {
    ...content,
    value: formatHoverDisplayString(content.value),
  };
}

function prettyMarkup(contents: MarkupContent | MarkedString | MarkedString[]): typeof contents {
  if (typeof contents === "string") {
    return formatHoverDisplayString(contents);
  }
  if (Array.isArray(contents)) {
    return contents.map(prettyMarkedString);
  }
  if ("kind" in contents) {
    return {
      ...contents,
      value: formatHoverDisplayString(contents.value),
    };
  }
  return prettyMarkedString(contents as MarkedString);
}

/** Apply Thunk / symbol pretty-printing to a hover result (in place shape preserved). */
export function prettyPrintThunkHover(hover: Hover): Hover {
  return {
    ...hover,
    contents: prettyMarkup(hover.contents as MarkupContent | MarkedString | MarkedString[]),
  };
}
