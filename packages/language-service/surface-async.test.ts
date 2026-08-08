/**
 * Surface: wrap + Async protocol hover / typecheck.
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

describe("surface: async wrap", () => {
  const fileName = path.join(root, "examples/async-wrap.thunk");
  const source = withPrelude(`import { wrap } from "@thunk/runtime"

const program = thunk {
  const n = run wrap(() => Promise.resolve(1))
  return n + 1
}

const result: Promise<number> = run program
`);

  test("lower emits machine + preserves wrap import", () => {
    const lowered = lowerThunkSource(source, fileName);
    expect(lowered.generatedText).toContain(
      'import { wrap } from "@thunk/runtime"',
    );
    expect(lowered.generatedText).toContain("runEffect(");
    expect(lowered.generatedText).toContain("execute(");
  });

  test("typechecks; hover program shows Async", () => {
    const p = createThunkProject(projectOpts(fileName, source));
    expect(p.getDiagnostics(fileName)).toEqual([]);

    const offset = source.indexOf("const program") + "const ".length;
    const hover = hoverAtOffset(p, fileName, source, offset);
    expect(hover?.displayString).toBeTruthy();
    const d = hover!.displayString;
    expect(d).toMatch(/Thunk<\s*number/);
    expect(d).toMatch(/\bAsync\b/);
    expect(d).not.toMatch(/\|\s*void/);
    expect(d).not.toMatch(/__brand_/);
    expect(d).not.toMatch(/Protocols\s*\(/);
  });

  test("postfix Async annotation encodes [Async]", () => {
    const src = withPrelude(`import { wrap } from "@thunk/runtime"
const t: Thunk<number> Async = wrap(() => Promise.resolve(1))
`);
    const lowered = lowerThunkSource(src, fileName);
    expect(lowered.generatedText).toContain("[Async]");
    expect(lowered.generatedText).toMatch(/import type \{[^}]*\bAsync\b/);
  });
});
