/**
 * Surface regression tests for thunk typing polish:
 * - protocol bag assignability (Requires / Async must not hide into Thunk<T>)
 * - return-position `run` yield inference
 * - nested Thunk pretty-print
 * - hoisted `let` without annotation (no TS7034)
 * - postfix `++` must not swallow the next statement
 */

import { describe, expect, test } from "bun:test";
import { withPrelude } from "../language-core/test-prelude";
import path from "node:path";
import { lowerThunkSource } from "@thunk/language-core";
import { createThunkProject, hoverAtOffset } from "./src/index";

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

describe("surface: thunk type assignability", () => {
  test("Thunk Requires(Database) is not assignable to Thunk<string>", () => {
    const fileName = path.join(root, "examples/assign-requires.thunk");
    const source = withPrelude(`import { use } from "@thunk/runtime"

symbol Database = { name: string }

const fetchUser = thunk {
  const db = run use(Database)
  return db.name
}

const shouldError: Thunk<string> = fetchUser
`);
    const p = createThunkProject(projectOpts(fileName, source));
    const diags = p.getDiagnostics(fileName);
    expect(diags.some((d) => /not assignable/i.test(d))).toBe(true);
    expect(diags.some((d) => /__protocolInvariant|Requires/i.test(d))).toBe(
      true,
    );
  });

  test("Thunk Async is not assignable to plain Thunk<T>", () => {
    const fileName = path.join(root, "examples/assign-async.thunk");
    const source = withPrelude(`import { wrap } from "@thunk/runtime"

const asyncT = thunk {
  const x = run wrap(() => Promise.resolve(1))
  return x
}

const shouldError: Thunk<number> = asyncT
`);
    const p = createThunkProject(projectOpts(fileName, source));
    const diags = p.getDiagnostics(fileName);
    expect(diags.some((d) => /not assignable/i.test(d))).toBe(true);
  });

  test("Thunk Async assigns to annotated Thunk<T> Async", () => {
    const fileName = path.join(root, "examples/assign-async-ok.thunk");
    const source = withPrelude(`import { wrap } from "@thunk/runtime"

const asyncT = thunk {
  const x = run wrap(() => Promise.resolve(1))
  return x
}

const ok: Thunk<number> Async = asyncT
`);
    const p = createThunkProject(projectOpts(fileName, source));
    expect(p.getDiagnostics(fileName)).toEqual([]);
  });

  test("provide strips Requires so result assigns to Thunk<T>", () => {
    const fileName = path.join(root, "examples/assign-provide.thunk");
    const source = withPrelude(`import { use, provide } from "@thunk/runtime"

symbol Database { name: string }
const DatabaseLive = Database({ name: "live" })

const fetchUser = thunk {
  const db = run use(Database)
  return db.name
}

const program: Thunk<string> = provide(fetchUser, DatabaseLive)
`);
    const p = createThunkProject(projectOpts(fileName, source));
    expect(p.getDiagnostics(fileName)).toEqual([]);
  });
});

describe("surface: return run wrap yield + Async", () => {
  test("return run wrap(() => promiseFn()) → Thunk<boolean> Async", () => {
    const fileName = path.join(root, "examples/return-run-wrap.thunk");
    const source = withPrelude(`import { wrap } from "@thunk/runtime"

function promiseFn(): Promise<boolean> {
  return Promise.resolve(true)
}

const program2 = thunk {
  return run wrap(() => promiseFn())
}
`);
    const p = createThunkProject(projectOpts(fileName, source));
    expect(p.getDiagnostics(fileName)).toEqual([]);

    const lowered = lowerThunkSource(source, fileName);
    expect(lowered.generatedText).toMatch(
      /succeed\(__resume as ThunkReturnType/,
    );

    const offset = source.indexOf("program2");
    const hover = hoverAtOffset(p, fileName, source, offset);
    expect(hover?.displayString).toBeTruthy();
    const d = hover!.displayString;
    expect(d).toMatch(/Thunk<\s*boolean/);
    expect(d).toMatch(/\bAsync\b/);
    expect(d).not.toMatch(/Thunk<\s*any/);
    expect(d).not.toMatch(/Async\s*\(\s*void/);
    expect(d).not.toMatch(/Requires/);
    expect(d).not.toMatch(/__brand_/);
  });

  test("return wrap without run → Thunk<Thunk<boolean> Async>", () => {
    const fileName = path.join(root, "examples/return-wrap-nested.thunk");
    const source = withPrelude(`import { wrap } from "@thunk/runtime"

function promiseFn(): Promise<boolean> {
  return Promise.resolve(true)
}

const program2 = thunk {
  return wrap(() => promiseFn())
}
`);
    const p = createThunkProject(projectOpts(fileName, source));
    expect(p.getDiagnostics(fileName)).toEqual([]);

    const offset = source.indexOf("program2");
    const hover = hoverAtOffset(p, fileName, source, offset);
    expect(hover?.displayString).toBeTruthy();
    const d = hover!.displayString;
    expect(d).toMatch(/Thunk<\s*Thunk<\s*boolean\s*>\s*Async\s*>/);
    expect(d).not.toMatch(/readonly\s*\[Async\]/);
    expect(d).not.toMatch(/EmptyProtocols/);
  });
});

describe("surface: hoisted let inference + postfix ++", () => {
  test("unannotated let tries = 0 inside machine does not TS7034", () => {
    const fileName = path.join(root, "examples/hoisted-let.thunk");
    const source = withPrelude(`const randomThunk = thunk { return 1 }

const program = thunk {
  let tries = 0
  while (true) {
    const x = run randomThunk
    if (x > 0) return tries
    tries++
    if (tries > 20) return tries
  }
}
`);
    const lowered = lowerThunkSource(source, fileName);
    expect(lowered.generatedText).toMatch(/InferLet/);
    expect(lowered.generatedText).toMatch(/tries\+\+/);
    // Postfix ++ must not swallow the following if
    expect(lowered.generatedText).not.toMatch(
      /tries\+\+[\s\S]*if \(tries > 20\) return tries/,
    );
    expect(lowered.generatedText).toMatch(/if \(tries > 20\)/);

    const p = createThunkProject(projectOpts(fileName, source));
    const diags = p.getDiagnostics(fileName);
    expect(diags.filter((d) => /implicitly has/i.test(d))).toEqual([]);
    expect(diags).toEqual([]);

    const offset = source.indexOf("program");
    const hover = hoverAtOffset(p, fileName, source, offset);
    expect(hover?.displayString).toMatch(/Thunk</);
    expect(hover!.displayString).not.toMatch(/Requires\s*\(\s*unknown/);
  });

  test("examples/async-wrap.thunk typechecks without Requires(unknown)", () => {
    const fileName = path.join(root, "examples/async-wrap.thunk");
    const source = withPrelude(`import { wrap } from "@thunk/runtime"

function promiseFn(): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(Math.random() > 0.5), 10)
  })
}

const program = thunk {
  let tries: number = 0
  while (true) {
    const res = run wrap(() => promiseFn())
    if (res) return tries
    tries++
    if (tries > 20) return tries
  }
}

const result = run program
result.then((tries) => {
  console.log({ tries })
})
`);
    const p = createThunkProject(projectOpts(fileName, source));
    expect(p.getDiagnostics(fileName)).toEqual([]);

    const offset = source.indexOf("program");
    const hover = hoverAtOffset(p, fileName, source, offset);
    expect(hover?.displayString).toBeTruthy();
    const d = hover!.displayString;
    expect(d).toMatch(/Thunk</);
    expect(d).toMatch(/\bAsync\b/);
    expect(d).not.toMatch(/Requires\s*\(/);
    expect(d).not.toMatch(/unknown/);
    expect(d).not.toMatch(/Async\s*\(\s*void/);
  });
});
