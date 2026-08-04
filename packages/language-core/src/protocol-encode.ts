/**
 * Encode surface postfix protocols into a TypeScript ProtocolBag type string.
 */

import type { ProtocolClause } from "./ast";

export interface EncodedProtocolBag {
  /** Type text for the second type arg of Thunk, or undefined if empty. */
  readonly bagType?: string;
  readonly needsTypesImport: boolean;
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

  for (const p of protocols) {
    if (p.name === "Requires") {
      if (p.payload && p.payload.trim()) {
        requiresPayloads.push(p.payload.trim());
      }
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
  for (const flag of flags) {
    members.push(`readonly ${flag}: void`);
  }

  if (members.length === 0) {
    return { needsTypesImport: true };
  }

  return {
    bagType: `{ ${members.join("; ")} }`,
    needsTypesImport: true,
  };
}

/**
 * Lower `Thunk<Y>` + postfix protocols → `Thunk<Y, Bag>` encoding.
 * If base is already `Thunk<Y, …>`, replace/merge bag (postfix wins for Requires).
 */
export function encodeThunkTypeAnnotation(
  baseText: string,
  protocols: readonly ProtocolClause[],
): { typeText: string; needsTypesImport: boolean } {
  const encoded = encodeProtocolBag(protocols);
  const base = baseText.trim();
  const thunkMatch = /^Thunk\s*<([\s\S]*)>$/.exec(base);

  if (!thunkMatch) {
    // Non-Thunk annotation: emit base as-is; postfix only meaningful on Thunk
    if (protocols.length === 0) {
      return { typeText: base, needsTypesImport: false };
    }
    // Still attach bag as intersection brand if someone wrote `Foo Requires(A)` — uncommon
    if (encoded.bagType) {
      return {
        typeText: `${base} & { __protocols: ${encoded.bagType} }`,
        needsTypesImport: true,
      };
    }
    return { typeText: base, needsTypesImport: encoded.needsTypesImport };
  }

  const inner = thunkMatch[1]!.trim();
  const yieldType = splitFirstTypeArg(inner);

  if (!encoded.bagType) {
    return {
      typeText: `Thunk<${yieldType}>`,
      needsTypesImport: true,
    };
  }

  return {
    typeText: `Thunk<${yieldType}, ${encoded.bagType}>`,
    needsTypesImport: true,
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
