/**
 * SourceMap → Volar CodeMapping adapter tests.
 */

import { describe, expect, test } from "bun:test";
import { SourceMap as VolarSourceMap } from "@volar/source-map";
import {
  generatedToOriginal,
  lowerThunkSource,
  offsetToPosition,
  originalToGenerated,
  positionToOffset,
} from "@thunk/language-core";
import { toVolarMappings } from "./src/volar/mappings";
import { ThunkVirtualCode } from "./src/volar/language";

const basicSource = `const random = thunk {
  return Math.random()
}

const program = thunk {
  const value = run random
  return value * 2
}
`;

describe("toVolarMappings", () => {
  test("maps generated `value` binding back to original (and reverse)", () => {
    const lowered = lowerThunkSource(basicSource, "basic.thunk");
    const volarMaps = toVolarMappings(
      lowered.sourceMap,
      lowered.originalText,
      lowered.generatedText,
    );

    expect(volarMaps.length).toBeGreaterThan(0);

    const nameOffset = basicSource.indexOf("const value") + "const ".length;
    const originalPos = offsetToPosition(basicSource, nameOffset);
    const generatedPos = originalToGenerated(lowered.sourceMap, originalPos);
    expect(generatedPos).toBeDefined();

    const genOffset = positionToOffset(lowered.generatedText, generatedPos!);
    expect(lowered.generatedText.slice(genOffset, genOffset + 5)).toBe("value");

    // Round-trip via language-core (resolution policy oracle)
    const back = generatedToOriginal(lowered.sourceMap, generatedPos!);
    expect(back).toEqual(originalPos);

    // Same offset reachable through Volar SourceMap
    const volarMap = new VolarSourceMap(volarMaps);
    const fromGenerated = [...volarMap.toSourceLocation(genOffset)];
    expect(fromGenerated.length).toBeGreaterThan(0);
    const mappedSource = fromGenerated[0]![0];
    // Most-specific mapping should land on the binding name span
    expect(mappedSource).toBeGreaterThanOrEqual(nameOffset);
    expect(mappedSource).toBeLessThanOrEqual(nameOffset + "value".length);

    const fromSource = [...volarMap.toGeneratedLocation(nameOffset)];
    expect(fromSource.length).toBeGreaterThan(0);
    const mappedGen = fromSource[0]![0];
    expect(mappedGen).toBeGreaterThanOrEqual(genOffset);
    expect(mappedGen).toBeLessThanOrEqual(genOffset + "value".length);
  });

  test("planted generated error offset resolves to an original line", () => {
    // Break the return expression type in source, then map a generated span back.
    const broken = `const random = thunk {
  return Math.random()
}

const program = thunk {
  const value = run random
  return value * "x"
}
`;
    const lowered = lowerThunkSource(broken, "broken.thunk");
    const volarMaps = toVolarMappings(
      lowered.sourceMap,
      lowered.originalText,
      lowered.generatedText,
    );
    const volarMap = new VolarSourceMap(volarMaps);

    // Find the string literal `"x"` in generated output (type-error site).
    const genErrorOffset = lowered.generatedText.indexOf('"x"');
    expect(genErrorOffset).toBeGreaterThan(-1);

    const mapped = [...volarMap.toSourceLocation(genErrorOffset)];
    expect(mapped.length).toBeGreaterThan(0);
    const sourceOffset = mapped[0]![0];
    const sourcePos = offsetToPosition(broken, sourceOffset);
    // Should land on the return line (line index of `return value * "x"`)
    const returnLine = broken
      .split("\n")
      .findIndex((l) => l.includes('return value * "x"'));
    expect(sourcePos.line).toBe(returnLine);
  });
});

describe("ThunkVirtualCode", () => {
  test("exposes embedded TypeScript from lowerThunkSource", () => {
    const snapshot = {
      getText: (start: number, end: number) => basicSource.substring(start, end),
      getLength: () => basicSource.length,
      getChangeRange: () => undefined,
    };
    const code = new ThunkVirtualCode(snapshot, "basic.thunk");
    expect(code.languageId).toBe("thunk");
    expect(code.parseError).toBeUndefined();
    expect(code.embeddedCodes).toHaveLength(1);
    const embedded = code.embeddedCodes![0]!;
    expect(embedded.id).toBe("ts");
    expect(embedded.languageId).toBe("typescript");
    const gen = embedded.snapshot.getText(0, embedded.snapshot.getLength());
    expect(gen).toContain("runEffect(");
    expect(gen).toContain("machine(");
    expect(gen).toContain("succeed(");
    expect(embedded.mappings.length).toBeGreaterThan(0);
  });

  test("surfaces parseError and empty-ish embedded script on syntax error", () => {
    const bad = "const x = thunk {";
    const snapshot = {
      getText: (start: number, end: number) => bad.substring(start, end),
      getLength: () => bad.length,
      getChangeRange: () => undefined,
    };
    const code = new ThunkVirtualCode(snapshot, "bad.thunk");
    expect(code.parseError).toBeDefined();
    expect(code.embeddedCodes).toHaveLength(1);
    expect(code.embeddedCodes![0]!.id).toBe("ts");
  });
});
