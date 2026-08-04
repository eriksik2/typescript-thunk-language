/**
 * Pretty-print TypeScript `Thunk<…>` / symbol display strings into surface form:
 *
 *   Thunk<User>
 *     Requires(Database | Logger)
 *     Once
 *
 *   const Database: symbol { name: string }
 *
 * Empty protocol bags collapse to `Thunk<T>` only.
 */

/** Known empty-bag spellings TypeScript may emit. */
const EMPTY_BAG =
  /^(EmptyProtocols|\{\s*\}|Record<PropertyKey,\s*unknown>|object)$/;

/** `Omit<EmptyProtocols, …>` / `Omit<{}, …>` noise from MergeProtocols before SimplifyEmpty. */
const OMIT_EMPTY_BAG =
  /^Omit<\s*(EmptyProtocols|\{\s*\})\s*,[\s\S]+>$/;

/** Intersection of only empty-like pieces (rare TS display forms). */
function isEmptyLikeBag(bag: string): boolean {
  const trimmed = bag.trim();
  if (!trimmed || EMPTY_BAG.test(trimmed)) return true;
  if (OMIT_EMPTY_BAG.test(trimmed)) return true;
  // A & B where every top-level part is empty-like (must actually split)
  if (trimmed.includes("&")) {
    const parts = splitTopLevelIntersect(trimmed);
    if (parts.length > 1) {
      return parts.every(isEmptyLikeBag);
    }
  }
  return false;
}

function splitTopLevelIntersect(text: string): string[] {
  const parts: string[] = [];
  let depthAngle = 0;
  let depthBrace = 0;
  let depthParen = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "=" && text[i + 1] === ">") {
      i++;
      continue;
    }
    if (c === "<") depthAngle++;
    else if (c === ">") depthAngle--;
    else if (c === "{") depthBrace++;
    else if (c === "}") depthBrace--;
    else if (c === "(") depthParen++;
    else if (c === ")") depthParen--;
    else if (
      c === "&" &&
      depthAngle === 0 &&
      depthBrace === 0 &&
      depthParen === 0
    ) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

/**
 * Split `a, b, c` on top-level commas (angle/brace/paren aware).
 * Skips `=>` so arrow return types do not confuse angle depth.
 */
export function splitTopLevelArgs(args: string): string[] {
  const parts: string[] = [];
  let depthAngle = 0;
  let depthBrace = 0;
  let depthParen = 0;
  let depthBracket = 0;
  let start = 0;

  for (let i = 0; i < args.length; i++) {
    const c = args[i]!;
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(args, i);
      continue;
    }
    if (c === "=" && args[i + 1] === ">") {
      i++;
      continue;
    }
    if (c === "<") depthAngle++;
    else if (c === ">") depthAngle--;
    else if (c === "{") depthBrace++;
    else if (c === "}") depthBrace--;
    else if (c === "(") depthParen++;
    else if (c === ")") depthParen--;
    else if (c === "[") depthBracket++;
    else if (c === "]") depthBracket--;
    else if (
      c === "," &&
      depthAngle === 0 &&
      depthBrace === 0 &&
      depthParen === 0 &&
      depthBracket === 0
    ) {
      parts.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = args.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

function skipString(text: string, start: number): number {
  const quote = text[start]!;
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i;
    i++;
  }
  return text.length - 1;
}

/**
 * Find a `Thunk<...>` span inside `text` (first match).
 * Tracks `(){}[]` depth and skips `=>` / strings so expanded symbol
 * identities in Requires bags do not truncate the span.
 */
export function findThunkTypeSpan(
  text: string,
): { start: number; end: number; inner: string } | undefined {
  const marker = "Thunk<";
  const start = text.indexOf(marker);
  if (start === -1) return undefined;

  let depthAngle = 0;
  let depthBrace = 0;
  let depthParen = 0;
  let depthBracket = 0;
  const argsStart = start + marker.length - 1; // at '<'

  for (let i = argsStart; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i);
      continue;
    }
    if (c === "=" && text[i + 1] === ">") {
      i++;
      continue;
    }
    if (c === "<") depthAngle++;
    else if (c === ">") {
      depthAngle--;
      if (
        depthAngle === 0 &&
        depthBrace === 0 &&
        depthParen === 0 &&
        depthBracket === 0
      ) {
        return {
          start,
          end: i + 1,
          inner: text.slice(argsStart + 1, i),
        };
      }
    } else if (c === "{") depthBrace++;
    else if (c === "}") depthBrace--;
    else if (c === "(") depthParen++;
    else if (c === ")") depthParen--;
    else if (c === "[") depthBracket++;
    else if (c === "]") depthBracket--;
  }
  return undefined;
}

interface ProtocolEntry {
  name: string;
  payload?: string;
}

/**
 * Parse a protocol bag type string into postfix entries.
 * Handles EmptyProtocols, `{}`, and object types with Requires / Once-like keys.
 */
export function parseProtocolBag(bag: string): ProtocolEntry[] {
  const trimmed = bag.trim();
  if (isEmptyLikeBag(trimmed)) return [];

  // Object type: { ... }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const body = trimmed.slice(1, -1).trim();
    if (!body) return [];
    return parseObjectMembers(body);
  }

  // Fallback: unknown non-empty bag — opaque line (avoid for empty Omit noise)
  return [{ name: "Protocols", payload: trimmed }];
}

function parseObjectMembers(body: string): ProtocolEntry[] {
  const members = splitTopLevelArgs(body);
  const entries: ProtocolEntry[] = [];

  for (const raw of members) {
    const member = raw.replace(/^readonly\s+/, "").trim();
    if (!member) continue;

    // [Requires]: Payload  |  Requires: Payload  |  typeof Requires: …
    const indexed = member.match(
      /^\[\s*(?:typeof\s+)?(\w+)\s*\]\s*:\s*([\s\S]+)$/,
    );
    if (indexed) {
      entries.push(entryFromKey(indexed[1]!, indexed[2]!.trim()));
      continue;
    }

    const plain = member.match(/^(\w+)\s*:\s*([\s\S]+)$/);
    if (plain) {
      entries.push(entryFromKey(plain[1]!, plain[2]!.trim()));
      continue;
    }
  }

  return entries;
}

function entryFromKey(key: string, payload: string): ProtocolEntry {
  const cleaned = payload.replace(/\s+/g, " ").trim();
  // void / undefined → flag-style protocol (Once)
  if (cleaned === "void" || cleaned === "undefined") {
    return { name: key };
  }
  return { name: key, payload: prettyRequiresPayload(cleaned) };
}

/**
 * Surface display for Requires payloads:
 * - `typeof Database` → `Database`
 * - expanded identity `((value: T) => Name) & { key; __assoc }` → `Name`
 * - unions of those → `A | B`
 */
export function prettyRequiresPayload(payload: string): string {
  return splitTopLevelUnion(payload)
    .map(collapseRequiresPayloadPart)
    .filter(Boolean)
    .join(" | ");
}

function splitTopLevelUnion(text: string): string[] {
  const parts: string[] = [];
  let depthAngle = 0;
  let depthBrace = 0;
  let depthParen = 0;
  let depthBracket = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i);
      continue;
    }
    if (c === "=" && text[i + 1] === ">") {
      i++;
      continue;
    }
    if (c === "<") depthAngle++;
    else if (c === ">") depthAngle--;
    else if (c === "{") depthBrace++;
    else if (c === "}") depthBrace--;
    else if (c === "(") depthParen++;
    else if (c === ")") depthParen--;
    else if (c === "[") depthBracket++;
    else if (c === "]") depthBracket--;
    else if (
      c === "|" &&
      depthAngle === 0 &&
      depthBrace === 0 &&
      depthParen === 0 &&
      depthBracket === 0
    ) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function collapseRequiresPayloadPart(part: string): string {
  const t = part.replace(/\s+/g, " ").trim();
  if (!t) return t;

  const typeofMatch = /^typeof\s+(\w+)$/.exec(t);
  if (typeofMatch) return typeofMatch[1]!;

  // ((value: T) => Name) & { readonly key: symbol; readonly __assoc: … }
  const arrowName = t.match(/\)\s*=>\s*(\w+)\s*\)/);
  if (
    arrowName &&
    (/\b__assoc\b/.test(t) || /\bkey\s*:\s*symbol\b/.test(t))
  ) {
    return arrowName[1]!;
  }

  // Bare identifier (already pretty)
  if (/^\w+$/.test(t)) return t;

  // Strip remaining typeof Name inside larger expressions
  return t.replace(/\btypeof\s+(\w+)/g, "$1");
}

/**
 * Format `Thunk<Yield, Bag>` → surface multiline string (no const/prefix).
 */
export function formatThunkType(yieldType: string, bag: string): string {
  const protocols = parseProtocolBag(bag);
  const head = `Thunk<${yieldType.trim()}>`;
  if (protocols.length === 0) return head;

  const lines = [head];
  for (const p of protocols) {
    if (p.payload === undefined) {
      lines.push(`  ${p.name}`);
    } else {
      lines.push(`  ${p.name}(${p.payload})`);
    }
  }
  return lines.join("\n");
}

/**
 * Rewrite any `Thunk<…>` occurrence inside a quick-info / hover display string.
 */
export function formatThunkDisplayString(display: string): string {
  const span = findThunkTypeSpan(display);
  if (!span) return display;

  const args = splitTopLevelArgs(span.inner);
  if (args.length === 0) return display;

  const yieldType = args[0]!;
  const bag = args[1] ?? "EmptyProtocols";
  const pretty = formatThunkType(yieldType, bag);

  return display.slice(0, span.start) + pretty + display.slice(span.end);
}

/**
 * Rewrite raw brand / callable identity encodings into surface `symbol T`.
 *
 * Handles common quick-info shapes:
 * - `const Name: ((value: T) => Name) & { key; __assoc: T }`
 * - `type Name = T & { [__brand_Name]: … } & { __assoc: T }`
 */
export function formatSymbolDisplayString(display: string): string {
  let out = collapseConstIdentity(display);
  out = collapseTypeBrand(out);
  if (/__brand_/.test(out) || /__assoc/.test(out)) {
    out = collapseSymbolTypeAliasBlock(out);
    out = collapseSymbolConstBlock(out);
  }
  return out;
}

function collapseConstIdentity(display: string): string {
  const re =
    /const\s+(\w+)\s*:\s*\(\(value:\s*/g;
  let result = display;
  let match: RegExpExecArray | null;
  const input = display;
  const pieces: { start: number; end: number; replacement: string }[] = [];
  while ((match = re.exec(input)) !== null) {
    const name = match[1]!;
    const valueStart = match.index + match[0].length;
    const afterValue = readTypeUntil(input, valueStart, (c, i, s) => {
      return c === ")" && /^\s*=>/.test(s.slice(i + 1));
    });
    if (afterValue === undefined) continue;
    const valueType = input.slice(valueStart, afterValue).trim();
    // Expect `) => Name) & { … }`
    const arrow = input.slice(afterValue).match(
      new RegExp(`^\\)\\s*=>\\s*${name}\\)\\s*&\\s*\\{`),
    );
    if (!arrow) continue;
    const braceStart = afterValue + arrow[0].length - 1;
    const braceEnd = matchingBrace(input, braceStart);
    if (braceEnd === undefined) continue;
    pieces.push({
      start: match.index,
      end: braceEnd + 1,
      replacement: `const ${name}: symbol ${normalizeAssocType(valueType)}`,
    });
  }
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i]!;
    result = result.slice(0, p.start) + p.replacement + result.slice(p.end);
  }
  return result;
}

function collapseTypeBrand(display: string): string {
  const re = /type\s+(\w+)\s*=\s*/g;
  let result = display;
  const pieces: { start: number; end: number; replacement: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(display)) !== null) {
    const name = match[1]!;
    const bodyStart = match.index + match[0].length;
    if (!display.slice(bodyStart).includes(`__brand_${name}`)) continue;
    // Find end of type alias body: until newline+const/type or end, but prefer full brand chain
    let bodyEnd = bodyStart;
    // Scan until we've closed all brand intersections — look for __assoc block end
    const assocIdx = display.indexOf("__assoc", bodyStart);
    if (assocIdx === -1) continue;
    const braceBefore = display.lastIndexOf("{", assocIdx);
    if (braceBefore === -1) continue;
    const braceEnd = matchingBrace(display, braceBefore);
    if (braceEnd === undefined) continue;
    bodyEnd = braceEnd + 1;
    while (display[bodyEnd] === ";" || display[bodyEnd] === " ") bodyEnd++;

    const body = display.slice(bodyStart, bodyEnd);
    const first = body.split(/\s*&\s*\{\s*readonly\s*\[__brand_/)[0]?.trim();
    if (!first) continue;
    pieces.push({
      start: match.index,
      end: bodyEnd,
      replacement: `type ${name} = symbol ${normalizeAssocType(first)}`,
    });
  }
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i]!;
    result = result.slice(0, p.start) + p.replacement + result.slice(p.end);
  }
  return result;
}

/** Read until predicate on char at depth 0 of braces/parens/angles. */
function readTypeUntil(
  text: string,
  start: number,
  stop: (c: string, i: number, s: string) => boolean,
): number | undefined {
  let depthAngle = 0;
  let depthBrace = 0;
  let depthParen = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i);
      continue;
    }
    if (c === "=" && text[i + 1] === ">") {
      i++;
      continue;
    }
    if (
      depthAngle === 0 &&
      depthBrace === 0 &&
      depthParen === 0 &&
      stop(c, i, text)
    ) {
      return i;
    }
    if (c === "<") depthAngle++;
    else if (c === ">") depthAngle--;
    else if (c === "{") depthBrace++;
    else if (c === "}") depthBrace--;
    else if (c === "(") depthParen++;
    else if (c === ")") depthParen--;
  }
  return undefined;
}

function matchingBrace(text: string, openIdx: number): number | undefined {
  if (text[openIdx] !== "{") return undefined;
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i);
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return undefined;
}

function normalizeAssocType(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/;+\s*$/, "")
    .replace(/\s*;\s*/g, "; ")
    .replace(/;\s*}/g, " }")
    .replace(/{\s+/g, "{ ")
    .replace(/\s+}/g, " }");
}

function collapseSymbolTypeAliasBlock(display: string): string {
  const re =
    /type\s+(\w+)\s*=\s*([\s\S]*?)(?=\nconst\s|\n*$)/;
  const m = re.exec(display);
  if (!m || !/__brand_/.test(m[0]!)) return display;
  const name = m[1]!;
  const body = m[2]!;
  const first = body.split(/\s*&\s*\{\s*readonly\s*\[__brand_/)[0]?.trim();
  if (!first) return display;
  const assoc = normalizeAssocType(first);
  return (
    display.slice(0, m.index) +
    `type ${name} = symbol ${assoc}` +
    display.slice(m.index! + m[0]!.length)
  );
}

function collapseSymbolConstBlock(display: string): string {
  const re =
    /const\s+(\w+)\s*:\s*\([\s\S]*?=>\s*\1\)\s*&\s*\{/;
  const m = re.exec(display);
  if (!m) return display;
  const braceStart = m.index + m[0].length - 1;
  const braceEnd = matchingBrace(display, braceStart);
  if (braceEnd === undefined) return display;
  const valueMatch = m[0]!.match(/\(value:\s*([\s\S]*?)\)\s*=>/);
  const assoc = normalizeAssocType(valueMatch?.[1] ?? "");
  if (!assoc) return display;
  return (
    display.slice(0, m.index) +
    `const ${m[1]}: symbol ${assoc}` +
    display.slice(braceEnd + 1)
  );
}

/**
 * Full surface pretty-print for hover / quick-info display strings.
 * Symbol encoding first, then Thunk / Requires.
 */
export function formatHoverDisplayString(display: string): string {
  return formatThunkDisplayString(formatSymbolDisplayString(display));
}
