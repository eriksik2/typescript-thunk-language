/**
 * Surface: opaque brands + Symbol.unwrap.
 */

import { describe, expect, test } from "bun:test";
import { withPrelude } from "../language-core/test-prelude";
import path from "node:path";
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

describe("surface: opaque brands", () => {
  const fileName = path.join(root, "examples/symbols.thunk");

  test("Cat(5) is not assignable to number; unwrap is", () => {
    const bad = withPrelude(`import { Symbol } from "@thunk/runtime"
symbol Cat = number
const x: number = Cat(5)
`);
    const pBad = createThunkProject(projectOpts(fileName, bad));
    const diags = pBad.getDiagnostics(fileName);
    expect(diags.some((d) => /not assignable/i.test(d))).toBe(true);

    const good = withPrelude(`import { Symbol } from "@thunk/runtime"
symbol Cat = number
const x: number = Symbol.unwrap(Cat(5))
`);
    const pGood = createThunkProject(projectOpts(fileName, good));
    expect(pGood.getDiagnostics(fileName)).toEqual([]);
  });

  test("hover Age has no brand encoding noise", () => {
    const source = withPrelude(`import { Symbol } from "@thunk/runtime"
symbol Age = number
const a: Age = Age(30)
const n: number = Symbol.unwrap(a)
`);
    const p = createThunkProject(projectOpts(fileName, source));
    expect(p.getDiagnostics(fileName)).toEqual([]);
    const offset = source.indexOf("const a") + "const ".length;
    const hover = hoverAtOffset(p, fileName, source, offset);
    expect(hover?.displayString).toBeTruthy();
    expect(hover!.displayString).not.toMatch(/__brand_/);
    expect(hover!.displayString).not.toMatch(/__assoc/);
  });
});
