/**
 * Pretty-print TypeScript `Thunk<…>` display strings into surface form:
 *
 *   Thunk<User>
 *     Requires(Database | Logger)
 *     Once
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
  // A & B where every top-level part is empty-like
  if (trimmed.includes("&")) {
    const parts = splitTopLevelIntersect(trimmed);
    return parts.length > 0 && parts.every(isEmptyLikeBag);
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

/**
 * Find a `Thunk<...>` span inside `text` (first match, nested-angle aware).
 * Returns [start, endExclusive] of the whole `Thunk<...>` including name.
 */
export function findThunkTypeSpan(
  text: string,
): { start: number; end: number; inner: string } | undefined {
  const marker = "Thunk<";
  const start = text.indexOf(marker);
  if (start === -1) return undefined;

  let depth = 0;
  const argsStart = start + marker.length - 1; // at '<'
  for (let i = argsStart; i < text.length; i++) {
    const c = text[i]!;
    if (c === "<") depth++;
    else if (c === ">") {
      depth--;
      if (depth === 0) {
        return {
          start,
          end: i + 1,
          inner: text.slice(argsStart + 1, i),
        };
      }
    }
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
  // never alone shouldn't appear for Requires in pretty form; still show
  return { name: key, payload: prettyRequiresPayload(cleaned) };
}

/**
 * Surface display: `typeof Database | typeof Logger` → `Database | Logger`.
 */
function prettyRequiresPayload(payload: string): string {
  return payload.replace(/\btypeof\s+(\w+)/g, "$1");
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
 * Leaves non-Thunk displays unchanged.
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
