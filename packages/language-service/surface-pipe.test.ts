/**
 * Surface: pipe `|` + expression-position `run` (ANF).
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

describe("surface: pipe + ANF run", () => {
  const fileName = path.join(root, "examples/pipe.thunk");
  const source = withPrelude(`const double = (n: number) => n * 2
const add = (n: number, m: number) => n + m

const tx = thunk {
  return 10
}

const flatten = (inner: typeof tx, _depth: number) => inner

const getUser = thunk {
  return { name: "ada" as const }
}

const program = thunk {
  const v = run tx | flatten(1)
  const name = (run getUser).name
  const n = 21 | double | add(1)
  return { v, name, n }
}
`);

  test("lower: pipe + ANF emit fragments", () => {
    const lowered = lowerThunkSource(source, fileName);
    expect(lowered.generatedText).toContain("runEffect(flatten(tx, 1))");
    expect(lowered.generatedText).toContain("__r0");
    expect(lowered.generatedText).toContain("add(double(21), 1)");
    expect(lowered.generatedText).not.toContain("21 | double");
  });

  test("typechecks; hover program shows Thunk", () => {
    const p = createThunkProject(projectOpts(fileName, source));
    expect(p.getDiagnostics(fileName)).toEqual([]);

    const offset = source.indexOf("const program") + "const ".length;
    const hover = hoverAtOffset(p, fileName, source, offset);
    expect(hover?.displayString).toBeTruthy();
    const d = hover!.displayString;
    expect(d).toMatch(/Thunk</);
    expect(d).not.toMatch(/__brand_/);
    expect(d).not.toMatch(/Protocols\s*\(/);
  });
});
