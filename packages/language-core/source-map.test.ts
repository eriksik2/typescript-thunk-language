import { describe, expect, test } from "bun:test";
import {
  originalToGenerated,
  type SourceMap,
} from "./src/source-map";

describe("source map", () => {
  test("prefers the most specific overlapping mapping", () => {
    const map: SourceMap = {
      mappings: [
        {
          // wide: whole thunk
          original: {
            start: { line: 0, character: 0 },
            end: { line: 2, character: 1 },
          },
          generated: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 },
          },
          name: "defer",
        },
        {
          // narrow: binding name
          original: {
            start: { line: 1, character: 8 },
            end: { line: 1, character: 13 },
          },
          generated: {
            start: { line: 0, character: 20 },
            end: { line: 0, character: 25 },
          },
          name: "value",
        },
      ],
    };

    const mapped = originalToGenerated(map, { line: 1, character: 8 });
    expect(mapped).toEqual({ line: 0, character: 20 });
  });
});
