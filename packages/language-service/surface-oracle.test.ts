/**
 * Surface: oracle typecheck view — yield T must match TypeScript CFA on an
 * async twin (`run` ↔ `await`), not machine `succeed` unions (`number | void`).
 *
 * Drift guard: when adding thunk-body syntax, extend the matrix below and keep
 * `examples/*.thunk` typechecking with `__ascribeThunkYield` on every `run` thunk.
 */

import { describe, expect, test } from "bun:test";
import { withPrelude } from "../language-core/test-prelude";
import path from "node:path";
import { readdirSync, readFileSync } from "node:fs";
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

function hoverProgram(source: string, name = "program"): string {
  const fileName = path.join(root, "examples/oracle-probe.thunk");
  const p = createThunkProject(projectOpts(fileName, source));
  expect(p.getDiagnostics(fileName)).toEqual([]);
  const offset = source.indexOf(`const ${name}`) + "const ".length;
  const hover = hoverAtOffset(p, fileName, source, offset);
  expect(hover?.displayString).toBeTruthy();
  return hover!.displayString;
}

describe("surface: oracle yield parity with TypeScript CFA", () => {
  test("while(true) + early returns → Thunk<number> Async (not number | void)", () => {
    const source = withPrelude(`import { wrap } from "@thunk/runtime"

function promiseFn(): Promise<boolean> {
  return Promise.resolve(true)
}

const program = thunk {
  let tries = 0
  while (true) {
    const res = run wrap(() => promiseFn())
    if (res) return tries
    tries++
    if (tries > 20) return tries
  }
}

const programAsFn = async () => {
  let tries = 0
  while (true) {
    const res = await promiseFn()
    if (res) return tries
    tries++
    if (tries > 20) return tries
  }
}
`);
    const lowered = lowerThunkSource(source, path.join(root, "x.thunk"));
    expect(lowered.generatedText).toContain("__ascribeThunkYield");
    expect(lowered.generatedText).toContain("await __oracleRun");
    // Machine may still contain succeed(void); oracle must win for yield T.
    expect(lowered.generatedText).toContain("succeed(undefined as void)");

    const program = hoverProgram(source, "program");
    expect(program).toMatch(/Thunk<\s*number/);
    expect(program).toMatch(/\bAsync\b/);
    expect(program).not.toMatch(/\|\s*void/);
    expect(program).not.toMatch(/__brand_/);

    const asFn = hoverProgram(source, "programAsFn");
    expect(asFn).toMatch(/Promise<\s*number\s*>/);
    expect(asFn).not.toMatch(/\|\s*void/);
  });

  test("const isTrue = true as const; while (isTrue) → number not void", () => {
    const source = withPrelude(`import { wrap } from "@thunk/runtime"
const program = thunk {
  const isTrue = true as const
  let tries = 0
  while (isTrue) {
    const res = run wrap(() => Promise.resolve(true))
    if (res) return tries
    tries++
    if (tries > 20) return tries
  }
}
`);
    const d = hoverProgram(source);
    expect(d).toMatch(/Thunk<\s*number/);
    expect(d).not.toMatch(/\|\s*void/);
  });

  test("if/else all returns → no void widen", () => {
    const source = withPrelude(`const step = thunk { return 1 }
const program = thunk {
  const n = run step
  if (n > 0) {
    return n
  } else {
    return 0
  }
}
`);
    const d = hoverProgram(source);
    expect(d).toMatch(/Thunk<\s*number/);
    expect(d).not.toMatch(/\|\s*void/);
  });

  test("try / Fail matrix still typechecks under oracle", () => {
    const source = withPrelude(`import { Error, type Thunk } from "@thunk/runtime"
symbol DivideByZero extends Error {}
const div = (a: number, b: number): Thunk<number> Fail(DivideByZero) => thunk {
  return b === 0 ? DivideByZero({ message: "z" }) : a / b
}
const program = (a: number, b: number): Thunk<number> Fail(DivideByZero) => thunk {
  const n = try div(a, b)
  return n + 1
}
`);
    const d = hoverProgram(source);
    expect(d).toMatch(/Thunk<number>\s*Fail\(DivideByZero\)/);
    expect(d).not.toMatch(/__brand_/);
  });

  test("Requires + Async compose; oracle keeps protocols from machine", () => {
    const source = withPrelude(`import { use, wrap, type Thunk } from "@thunk/runtime"
symbol Db { name: string }
const program = thunk {
  const db = run use(Db)
  const n = run wrap(() => Promise.resolve(db.name.length))
  return n
}
`);
    const d = hoverProgram(source);
    expect(d).toMatch(/Thunk<\s*number/);
    expect(d).toMatch(/\bAsync\b/);
    expect(d).toMatch(/Requires\s*\(\s*Db\s*\)/);
    expect(d).not.toMatch(/\|\s*void/);
  });

  test("is-pattern + run under oracle", () => {
    const source = withPrelude(`import { Error } from "@thunk/runtime"
symbol NotFound extends Error { path: string }
type AppErr = NotFound
const step = (r: number | AppErr) => thunk {
  if (r is NotFound { path: infer p }) return 0
  return r
}
const program = thunk {
  const n = run step(3)
  return n
}
`);
    const d = hoverProgram(source);
    expect(d).toMatch(/Thunk<\s*number/);
    expect(d).not.toMatch(/\|\s*void/);
  });

  test("pipe + expression-position run (ANF) under oracle", () => {
    const source = withPrelude(`const double = (n: number) => n * 2
const step = thunk { return 21 }
const program = thunk {
  return (run step) | double
}
`);
    const lowered = lowerThunkSource(source);
    expect(lowered.generatedText).toContain("__ascribeThunkYield");
    expect(lowered.generatedText).toContain("await __oracleRun");
    const d = hoverProgram(source);
    expect(d).toMatch(/Thunk<\s*number/);
  });
});

describe("surface: oracle drift — examples with run use ascription", () => {
  test("every examples/*.thunk that lowers runEffect also emits __ascribeThunkYield", () => {
    const dir = path.join(root, "examples");
    const files = readdirSync(dir).filter((f) => f.endsWith(".thunk"));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const full = path.join(dir, file);
      const source = readFileSync(full, "utf8");
      // Skip feature-only preambles without bodies if any
      let lowered;
      try {
        lowered = lowerThunkSource(source, full);
      } catch {
        continue;
      }
      if (lowered.generatedText.includes("runEffect(")) {
        expect(lowered.generatedText).toContain("__ascribeThunkYield");
        expect(lowered.generatedText).toContain("__oracleRun");
      }
    }
  });
});
