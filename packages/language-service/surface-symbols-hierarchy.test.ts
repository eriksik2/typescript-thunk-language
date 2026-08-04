/**
 * Surface tests: hierarchical / abstract symbols + Failure builtins.
 */

import { describe, expect, test } from "bun:test";
import path from "node:path";
import { lowerThunkSource } from "@thunk/language-core";
import {
  createThunkProject,
  hoverAtOffset,
} from "./src/index";

const root = path.resolve(import.meta.dirname, "../..");
const typesPath = path.join(root, "packages/types/src/index.ts");
const runtimePath = path.join(root, "packages/runtime/src/index.ts");
const internalPath = path.join(root, "packages/runtime/src/internal.ts");

function projectOpts(fileName: string, source: string) {
  return {
    files: { [fileName]: source },
    internalImportPath: "@thunk/runtime/internal",
    moduleMap: {
      "@thunk/types": typesPath,
      "@thunk/runtime": runtimePath,
      "@thunk/runtime/internal": internalPath,
    },
  } as const;
}

describe("surface: hierarchical symbols", () => {
  const fileName = path.join(root, "examples/symbols-hierarchy.thunk");
  const source = `abstract symbol Animal {
  name: string
}

symbol Dog extends Animal {
  breed: string
}

const dog: Animal = Dog({ name: "Rex", breed: "lab" })
`;

  test("lowers abstract + extends", () => {
    const lowered = lowerThunkSource(source, fileName);
    expect(lowered.generatedText).toContain("abstract: true");
    expect(lowered.generatedText).toContain("parent: Animal");
    expect(lowered.generatedText).toContain("type Dog = Animal &");
  });

  test("hover Dog → surface symbol, no brand noise", () => {
    const p = createThunkProject(projectOpts(fileName, source));
    const nameOffset = source.indexOf("symbol Dog") + "symbol ".length;
    const hover = hoverAtOffset(p, fileName, source, nameOffset);
    expect(hover?.displayString).toBeTruthy();
    const d = hover!.displayString;
    expect(d).toMatch(/symbol/);
    expect(d).not.toMatch(/__brand_/);
    expect(d).not.toMatch(/__assoc/);
    expect(d).not.toMatch(/__makeSymbol/);
  });

  test("Dog assigns to Animal (no diagnostics)", () => {
    const p = createThunkProject(projectOpts(fileName, source));
    expect(p.getDiagnostics(fileName)).toEqual([]);
  });
});

describe("surface: Failure hierarchy", () => {
  const fileName = path.join(root, "examples/failures.thunk");
  const source = `import {
  Failure,
  Defect,
  Symbol,
} from "@thunk/runtime"

const d: Failure = Defect({ message: "boom" })
const ok = Symbol.is(d, Failure)
`;

  test("Failure assignability + Symbol.is typecheck", () => {
    const p = createThunkProject(projectOpts(fileName, source));
    expect(p.getDiagnostics(fileName)).toEqual([]);
  });
});
