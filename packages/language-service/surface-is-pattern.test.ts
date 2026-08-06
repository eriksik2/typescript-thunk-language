/**
 * Surface: `if (val is Err: infer e)` bindings + typecheck.
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

describe("surface: is pattern", () => {
  const fileName = path.join(root, "examples/is-pattern.thunk");
  const source = withPrelude(`import { Ok, Err, type Result } from "@thunk/runtime"

const describe = (r: Result<number, string>) => thunk {
  if (r is Err: infer e) {
    return "err " + e
  }
  if (r is Ok: infer n && n > 0) {
    return "pos " + n
  }
  return "other"
}

const sample = run describe(Ok(3))
const flag = Err("x") is Err
`);

  test("lower emits __symbolIs + bindings", () => {
    const lowered = lowerThunkSource(source, fileName);
    expect(lowered.generatedText).toContain("__symbolIs(r, Err)");
    expect(lowered.generatedText).toContain("__symbolIs(r, Ok)");
    expect(lowered.generatedText).toMatch(/const e =/);
    expect(lowered.generatedText).toMatch(/const n =/);
  });

  test("typechecks; hover describe", () => {
    const p = createThunkProject(projectOpts(fileName, source));
    expect(p.getDiagnostics(fileName)).toEqual([]);
    const offset = source.indexOf("const describe") + "const ".length;
    const hover = hoverAtOffset(p, fileName, source, offset);
    expect(hover?.displayString).toBeTruthy();
    expect(hover!.displayString).not.toMatch(/__brand_/);
  });
});
