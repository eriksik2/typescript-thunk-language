/**
 * Surface: try sugar + Error-union fallibility.
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

describe("surface: try errors", () => {
  const fileName = path.join(root, "examples/try-errors.thunk");
  const source = withPrelude(`import { Error, type Thunk } from "@thunk/runtime"

symbol DivideByZero extends Error {}
type DivResult = number | DivideByZero

const div = (a: number, b: number): Thunk<DivResult> => thunk {
  return b === 0 ? DivideByZero({ message: "divide by zero" }) : a / b
}

const safe = (a: number, b: number): Thunk<number> => thunk {
  const res = run div(a, b)
  if (res is DivideByZero) return 0
  return res as number
}

const propagate = (a: number, b: number): Thunk<DivResult> => thunk {
  const n = try div(a, b)
  return n + 1
}

const ok = run safe(10, 2)
`);

  test("lower emits try desugar helpers", () => {
    const lowered = lowerThunkSource(source, fileName);
    expect(lowered.generatedText).toContain("__ThunkError");
    expect(lowered.generatedText).toContain("__symbolIsAny");
    expect(lowered.generatedText).toContain("__excludeIsAny");
  });

  test("typechecks; try narrows success; hover propagate", () => {
    const p = createThunkProject(projectOpts(fileName, source));
    expect(p.getDiagnostics(fileName)).toEqual([]);
    const offset = source.indexOf("const propagate") + "const ".length;
    const hover = hoverAtOffset(p, fileName, source, offset);
    expect(hover?.displayString).toBeTruthy();
    expect(hover!.displayString).toMatch(/DivideByZero|DivResult/);
    expect(hover!.displayString).not.toMatch(/__brand_/);
  });
});
