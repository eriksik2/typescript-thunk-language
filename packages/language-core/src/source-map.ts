/**
 * Source-map segments: map a range in the generated TypeScript back to the
 * original .thunk source (and vice versa for simple contiguous mappings).
 */

export interface Position {
  readonly line: number; // 0-based
  readonly character: number; // 0-based
}

export interface Range {
  readonly start: Position;
  readonly end: Position;
}

export interface Mapping {
  /** Range in the original .thunk source. */
  readonly original: Range;
  /** Range in the generated TypeScript. */
  readonly generated: Range;
  /** Optional name for debugging. */
  readonly name?: string;
}

export interface SourceMap {
  readonly mappings: readonly Mapping[];
}

export function offsetToPosition(text: string, offset: number): Position {
  let line = 0;
  let character = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return { line, character };
}

export function positionToOffset(text: string, position: Position): number {
  let line = 0;
  let offset = 0;
  while (offset < text.length && line < position.line) {
    if (text[offset] === "\n") line++;
    offset++;
  }
  return Math.min(offset + position.character, text.length);
}

function posInRange(pos: Position, range: Range): boolean {
  if (pos.line < range.start.line || pos.line > range.end.line) return false;
  if (pos.line === range.start.line && pos.character < range.start.character) {
    return false;
  }
  if (pos.line === range.end.line && pos.character > range.end.character) {
    return false;
  }
  return true;
}

function advance(pos: Position, from: Position, to: Position): Position {
  if (to.line === from.line) {
    return {
      line: pos.line,
      character: pos.character + (to.character - from.character),
    };
  }
  return {
    line: pos.line + (to.line - from.line),
    character: to.character,
  };
}

function rangeSpan(range: Range): number {
  if (range.start.line === range.end.line) {
    return range.end.character - range.start.character;
  }
  // Prefer fewer lines, then tighter end character — good enough for overlap picks.
  return (range.end.line - range.start.line) * 1_000_000 + range.end.character;
}

function bestMapping(
  map: SourceMap,
  position: Position,
  side: "original" | "generated",
): Mapping | undefined {
  let best: Mapping | undefined;
  let bestSpan = Infinity;
  for (const m of map.mappings) {
    const range = side === "original" ? m.original : m.generated;
    if (!posInRange(position, range)) continue;
    const span = rangeSpan(range);
    if (span < bestSpan) {
      best = m;
      bestSpan = span;
    }
  }
  return best;
}

/** Map a position in original source → generated TypeScript. */
export function originalToGenerated(
  map: SourceMap,
  position: Position,
): Position | undefined {
  const m = bestMapping(map, position, "original");
  if (!m) return undefined;
  // For wide original → narrow generated (e.g. whole thunk → "defer"),
  // pin to the start of the generated span instead of extrapolating.
  if (rangeSpan(m.original) > rangeSpan(m.generated) * 2) {
    return m.generated.start;
  }
  return advance(m.generated.start, m.original.start, position);
}

/** Map a position in generated TypeScript → original source. */
export function generatedToOriginal(
  map: SourceMap,
  position: Position,
): Position | undefined {
  const m = bestMapping(map, position, "generated");
  if (!m) return undefined;
  if (rangeSpan(m.generated) > rangeSpan(m.original) * 2) {
    return m.original.start;
  }
  return advance(m.original.start, m.generated.start, position);
}
