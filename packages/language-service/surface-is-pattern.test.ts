/**
 * Surface: `if (val is …)` / `is any` bindings + typecheck.
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
  const source = withPrelude(`import { Error } from "@thunk/runtime"

symbol NotFound extends Error {
  path: string
}
symbol Conflict extends Error {
  resource: string
}
type AppErr = NotFound | Conflict

const describe = (r: number | AppErr) => thunk {
  if (r is any Error: infer e) {
    return "err " + e.message
  }
  if (r > 0) {
    return "pos " + r
  }
  return "other"
}

const sample = run describe(3)
const flag = NotFound({ message: "x", path: "/" }) is any Error
`);

  test("lower emits __symbolIsAny + bindings", () => {
    const lowered = lowerThunkSource(source, fileName);
    expect(lowered.generatedText).toContain("__symbolIsAny(r, Error)");
    expect(lowered.generatedText).toMatch(/const e =/);
  });

  test("typechecks; hover describe; else narrows away Error", () => {
    const p = createThunkProject(projectOpts(fileName, source));
    expect(p.getDiagnostics(fileName)).toEqual([]);
    const offset = source.indexOf("const describe") + "const ".length;
    const hover = hoverAtOffset(p, fileName, source, offset);
    expect(hover?.displayString).toBeTruthy();
    expect(hover!.displayString).not.toMatch(/__brand_/);
  });

  test("exact is Error is false for NotFound leaf", () => {
    const src = withPrelude(`import { Error } from "@thunk/runtime"
symbol NotFound extends Error { path: string }
const n = NotFound({ message: "x", path: "/" })
const exact = n is Error
const pedigree = n is any Error
`);
    const p = createThunkProject(projectOpts(fileName, src));
    expect(p.getDiagnostics(fileName)).toEqual([]);
    const lowered = lowerThunkSource(src, fileName);
    expect(lowered.generatedText).toContain("__symbolIs(n, Error)");
    expect(lowered.generatedText).toContain("__symbolIsAny(n, Error)");
  });
});
