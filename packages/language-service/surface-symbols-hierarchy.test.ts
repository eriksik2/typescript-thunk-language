/**
 * Surface tests: hierarchical / abstract symbols + Failure builtins.
 * No value LSP — use Symbol.isAny / Symbol.to.
 */

import { describe, expect, test } from "bun:test";
import { withPrelude } from "../language-core/test-prelude";
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
  const source = withPrelude(`import { Symbol } from "@thunk/runtime"

abstract symbol Animal {
  name: string
}

symbol Dog extends Animal {
  breed: string
}

const dog = Dog({ name: "Rex", breed: "lab" })
const asAnimal = Symbol.to(dog, Animal)
`);

  test("lowers extends without parent type intersection", () => {
    const lowered = lowerThunkSource(source, fileName);
    expect(lowered.generatedText).toContain("abstract: true");
    expect(lowered.generatedText).toContain("parent: Animal");
    expect(lowered.generatedText).toContain("__parent?: typeof Animal");
    expect(lowered.generatedText).not.toMatch(/type Dog = Animal &/);
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

  test("Dog does not assign to Animal; Symbol.to typechecks", () => {
    const p = createThunkProject(projectOpts(fileName, source));
    expect(p.getDiagnostics(fileName)).toEqual([]);

    const bad = withPrelude(`import { Symbol } from "@thunk/runtime"

abstract symbol Animal {
  name: string
}
symbol Dog extends Animal {
  breed: string
}
const dog = Dog({ name: "Rex", breed: "lab" })
const bad: Animal = dog
`);
    const badFile = path.join(root, "examples/symbols-hierarchy-bad.thunk");
    const badProject = createThunkProject(projectOpts(badFile, bad));
    const diags = badProject.getDiagnostics(badFile);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.join("\n")).toMatch(/Animal|not assignable/i);
  });
});

describe("surface: Failure hierarchy", () => {
  const fileName = path.join(root, "examples/failures.thunk");
  const source = withPrelude(`import {
  Failure,
  Defect,
  Symbol,
} from "@thunk/runtime"

const d = Defect({ message: "boom" })
const ok = Symbol.isAny(d, Failure)
const asFailure = Symbol.to(d, Failure)
`);

  test("Symbol.isAny / Symbol.to typecheck (no Failure assignability)", () => {
    const p = createThunkProject(projectOpts(fileName, source));
    expect(p.getDiagnostics(fileName)).toEqual([]);
  });
});
