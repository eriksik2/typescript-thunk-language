/**
 * Surface integration tests for requires.thunk (symbol + use / provide / hover).
 *
 * These assert editor-facing strings and mappings — the regressions we ship against.
 */

import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  lowerThunkSource,
  offsetToPosition,
  originalToGenerated,
  positionToOffset,
} from "@thunk/language-core";
import {
  createThunkProject,
  hoverAtOffset,
} from "./src/index";

const root = path.resolve(import.meta.dirname, "../..");
const fileName = path.join(root, "examples/requires.thunk");
const typesPath = path.join(root, "packages/types/src/index.ts");
const runtimePath = path.join(root, "packages/runtime/src/index.ts");

const source = `symbol Database {
  name: string
}

const fetchUser = thunk {
  const db = run use(Database)
  return db.name
}

const program: Thunk<string> = provide(
  fetchUser,
  layerOf(Database, { name: "ada" }),
)

const result = run program
`;

function project() {
  return createThunkProject({
    files: { [fileName]: source },
    runtimeImportPath: runtimePath,
    moduleMap: {
      "@thunk/types": typesPath,
      "@thunk/runtime": runtimePath,
    },
  });
}

function offsetOf(needle: string, occurrence = 0): number {
  let from = 0;
  for (let i = 0; i <= occurrence; i++) {
    const idx = source.indexOf(needle, from);
    if (idx === -1) throw new Error(`missing ${needle}`);
    if (i === occurrence) return idx;
    from = idx + needle.length;
  }
  throw new Error("unreachable");
}

describe("surface: requires.thunk", () => {
  test("Database identifier maps to generated Database (not mid-cast)", () => {
    const lowered = lowerThunkSource(source, fileName, {
      runtimeImportPath: runtimePath,
    });
    const nameOffset = offsetOf("symbol Database") + "symbol ".length;
    for (let i = 0; i < "Database".length; i++) {
      const pos = offsetToPosition(source, nameOffset + i);
      const gen = originalToGenerated(lowered.sourceMap, pos);
      expect(gen).toBeDefined();
      const genOff = positionToOffset(lowered.generatedText, gen!);
      // Must land inside an identifier token "Database"
      const slice = lowered.generatedText.slice(genOff, genOff + "Database".length);
      // Either at start of Database or inside it — surrounding word must be Database
      let start = genOff;
      while (
        start > 0 &&
        /[A-Za-z_]/.test(lowered.generatedText[start - 1]!)
      ) {
        start--;
      }
      let end = genOff;
      while (
        end < lowered.generatedText.length &&
        /[A-Za-z_]/.test(lowered.generatedText[end]!)
      ) {
        end++;
      }
      expect(lowered.generatedText.slice(start, end)).toBe("Database");
      void slice;
    }
  });

  test("hover Database → surface symbol, no encoding noise", () => {
    const p = project();
    const nameOffset = offsetOf("symbol Database") + "symbol ".length;
    const hover = hoverAtOffset(p, fileName, source, nameOffset);
    expect(hover?.displayString).toBeTruthy();
    const d = hover!.displayString;
    expect(d).toMatch(/symbol/);
    expect(d).toMatch(/name:\s*string/);
    expect(d).not.toMatch(/__brand_/);
    expect(d).not.toMatch(/__assoc/);
    expect(d).not.toMatch(/__makeSymbol/);
  });

  test("hover fetchUser → Thunk<string> Requires(Database)", () => {
    const p = project();
    const offset = offsetOf("const fetchUser") + "const ".length;
    const hover = hoverAtOffset(p, fileName, source, offset);
    expect(hover?.displayString).toBeTruthy();
    const d = hover!.displayString;
    expect(d).toContain("Thunk<string>");
    expect(d).toMatch(/Requires\(Database\)/);
    expect(d).not.toMatch(/Protocols\s*\(/);
    expect(d).not.toMatch(/=>/);
    expect(d).not.toMatch(/__assoc/);
    expect(d).not.toMatch(/__brand_/);
  });

  test("hover program → pure Thunk<string>", () => {
    const p = project();
    const offset = offsetOf("const program") + "const ".length;
    const hover = hoverAtOffset(p, fileName, source, offset);
    expect(hover?.displayString).toBeTruthy();
    const d = hover!.displayString;
    expect(d).toContain("Thunk<string>");
    expect(d).not.toMatch(/Requires\(/);
    expect(d).not.toMatch(/Protocols\s*\(/);
    expect(d).not.toMatch(/EmptyProtocols/);
  });

  test("hover db from use(Database) → service shape", () => {
    const p = project();
    const offset = offsetOf("const db") + "const ".length;
    const hover = hoverAtOffset(p, fileName, source, offset);
    expect(hover?.displayString).toBeTruthy();
    const d = hover!.displayString;
    expect(d).toMatch(/name/);
    expect(d).not.toMatch(/__assoc/);
    expect(d).not.toMatch(/\(value:/);
  });
});
