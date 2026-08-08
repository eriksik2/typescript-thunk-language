/**
 * Encode surface postfix protocols into a TypeScript ProtocolBag type string.
 */

import type { ProtocolClause } from "./ast";

export interface EncodedProtocolBag {
  /** Type text for the second type arg of Thunk, or undefined if empty. */
  readonly bagType?: string;
  readonly needsTypesImport: boolean;
  /** When true, lowerer should import `Async` from `@thunk/types`. */
  readonly needsAsyncImport?: boolean;
}

/**
 * Encode a Requires payload so bag keys are symbol identities.
 * Bare identifiers become `typeof Name`; unions are mapped per part.
 */
export function encodeRequiresPayload(payload: string): string {
  return splitTopLevelUnion(payload)
    .map(encodeRequiresPayloadPart)
    .join(" | ");
}

function encodeRequiresPayloadPart(part: string): string {
  const t = part.trim();
  if (!t) return t;
  if (/^typeof\s+\w+$/.test(t)) return t;
  if (/^\w+$/.test(t)) return `typeof ${t}`;
  return t;
}

/** Split `A | B | C` on top-level `|` (angle/brace/paren aware). */
function splitTopLevelUnion(text: string): string[] {
  const parts: string[] = [];
  let depthAngle = 0;
  let depthBrace = 0;
  let depthParen = 0;
  let depthBracket = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
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

/**
 * Normalize repeated Requires by unioning payloads; flag protocols once.
 */
export function encodeProtocolBag(
  protocols: readonly ProtocolClause[],
): EncodedProtocolBag {
  if (protocols.length === 0) {
    return { needsTypesImport: false };
  }

  const requiresPayloads: string[] = [];
  const flags = new Set<string>();
  let hasAsync = false;

  for (const p of protocols) {
    if (p.name === "Requires") {
      if (p.payload && p.payload.trim()) {
        requiresPayloads.push(encodeRequiresPayload(p.payload.trim()));
      }
    } else if (p.name === "Async") {
      hasAsync = true;
    } else {
      flags.add(p.name);
    }
  }

  const members: string[] = [];
  if (requiresPayloads.length === 1) {
    members.push(`readonly [Requires]: ${requiresPayloads[0]}`);
  } else if (requiresPayloads.length > 1) {
    members.push(`readonly [Requires]: ${requiresPayloads.join(" | ")}`);
  }
  if (hasAsync) {
    members.push(`readonly [Async]: void`);
  }
  for (const flag of flags) {
    members.push(`readonly ${flag}: void`);
  }

  if (members.length === 0) {
    return { needsTypesImport: true };
  }

  return {
    bagType: `{ ${members.join("; ")} }`,
    needsTypesImport: true,
    needsAsyncImport: hasAsync,
  };
}

/**
 * Lower `Thunk<Y>` + optional `Fail(E)` + postfix protocols → `Thunk<Y | E, Bag>`.
 * Fail is part of the yield (success | errors), before protocol bags.
 */
export function encodeThunkTypeAnnotation(
  baseText: string,
  protocols: readonly ProtocolClause[],
  failPayload?: string,
): {
  typeText: string;
  needsTypesImport: boolean;
  needsAsyncImport: boolean;
  /** Pretty surface when Fail was written: `Thunk<T> Fail(E) …` */
  readonly failPayload?: string;
} {
  const encoded = encodeProtocolBag(protocols);
  const base = baseText.trim();
  const thunkMatch = /^Thunk\s*<([\s\S]*)>$/.exec(base);
  const needsAsyncImport = encoded.needsAsyncImport === true;
  const fail = failPayload?.trim();

  if (!thunkMatch) {
    // Non-Thunk annotation: emit base as-is; Fail/postfix only meaningful on Thunk
    if (protocols.length === 0 && !fail) {
      return {
        typeText: base,
        needsTypesImport: false,
        needsAsyncImport: false,
      };
    }
    let typeText = base;
    if (fail) {
      typeText = `${typeText} | (${fail})`;
    }
    if (encoded.bagType) {
      return {
        typeText: `${typeText} & { __protocols: ${encoded.bagType} }`,
        needsTypesImport: true,
        needsAsyncImport,
        failPayload: fail,
      };
    }
    return {
      typeText,
      needsTypesImport: encoded.needsTypesImport || !!fail,
      needsAsyncImport,
      failPayload: fail,
    };
  }

  const inner = thunkMatch[1]!.trim();
  let yieldType = splitFirstTypeArg(inner);
  if (fail) {
    yieldType = `${yieldType} | (${fail})`;
  }

  if (!encoded.bagType) {
    return {
      typeText: `Thunk<${yieldType}>`,
      needsTypesImport: true,
      needsAsyncImport: false,
      failPayload: fail,
    };
  }

  return {
    typeText: `Thunk<${yieldType}, ${encoded.bagType}>`,
    needsTypesImport: true,
    needsAsyncImport,
    failPayload: fail,
  };
}

/** First top-level type argument (yield), ignoring a possible second bag arg. */
function splitFirstTypeArg(inner: string): string {
  let depthAngle = 0;
  let depthBrace = 0;
  let depthParen = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (c === "<") depthAngle++;
    else if (c === ">") depthAngle--;
    else if (c === "{") depthBrace++;
    else if (c === "}") depthBrace--;
    else if (c === "(") depthParen++;
    else if (c === ")") depthParen--;
    else if (
      c === "," &&
      depthAngle === 0 &&
      depthBrace === 0 &&
      depthParen === 0
    ) {
      return inner.slice(0, i).trim();
    }
  }
  return inner.trim();
}


/**
 * Rewrite surface `Thunk<T> Fail(E) Requires(…) Async` appearing inside opaque
 * TS text (arrow return types, etc.) into encoded `Thunk<T | E, Bag>`.
 */
export function rewriteThunkSurfaceInText(text: string): string {
  // Thunk<…> then optional Fail(…) then zero+ Requires(…)|Async|Once
  const re =
    /Thunk\s*<((?:[^<>]|<[^<>]*>)*)>(?:\s*Fail\s*\(([^)]*)\))?((?:\s*(?:Requires\s*\([^)]*\)|Async|Once))*)/g;
  return text.replace(re, (_match, inner: string, fail: string | undefined, protos: string) => {
    const protocols: { name: string; payload?: string; range: any }[] = [];
    const protoRe = /\s*(Requires)\s*\(([^)]*)\)|\s*(Async|Once)/g;
    let m: RegExpExecArray | null;
    const dummyRange = {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    };
    while ((m = protoRe.exec(protos ?? "")) !== null) {
      if (m[1] === "Requires") {
        protocols.push({ name: "Requires", payload: m[2]!.trim(), range: dummyRange });
      } else if (m[3]) {
        protocols.push({ name: m[3], range: dummyRange });
      }
    }
    const failPayload = fail?.trim() || undefined;
    // Only rewrite when Fail or protocols present — plain Thunk<T> stays
    if (!failPayload && protocols.length === 0) {
      return `Thunk<${inner}>`;
    }
    return encodeThunkTypeAnnotation(`Thunk<${inner}>`, protocols, failPayload).typeText;
  });
}
