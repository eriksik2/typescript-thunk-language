/**
 * Match v1 + Option / error-union surface tests.
 */

import { describe, expect, test } from "bun:test";
import { withPrelude } from "../language-core/test-prelude";
import path from "node:path";
import { lowerThunkSource, parseThunkSource } from "@thunk/language-core";
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

const matchExample = withPrelude(`import { Error } from "@thunk/runtime"

symbol Some<T> = T
symbol None = {}
type Option<T> = Some<T> | None

symbol Circle {
  radius: number
}
symbol Rect {
  width: number
  height: number
}
type Shape = Circle | Rect

symbol NotFound extends Error {
  path: string
}
symbol Conflict extends Error {
  resource: string
}
type AppErr = NotFound | Conflict

const describeShape = (s: Shape): string =>
  match (s) {
    Circle { radius: infer r } => "circle r=" + r,
    Rect { width: infer w, height: infer h } => "rect " + w + "x" + h,
  }

const unwrapOption = (o: Option<number>): number =>
  match (o) {
    Some: infer n => n,
    None => 0,
  }

const showAppErr = (e: AppErr): string =>
  match (e) {
    NotFound { path: infer p, message: infer m } => "missing " + p + ": " + m,
    Conflict { resource: infer r, message: infer m } => "conflict " + r + ": " + m,
  }

const shapes = describeShape(Circle({ radius: 3 }))
const opt = unwrapOption(Some(42))
`);

describe("surface: match v1", () => {
  const fileName = path.join(root, "examples/match.thunk");

  test("parse match + generic symbols", () => {
    const ast = parseThunkSource(matchExample);
    const some = ast.statements.find(
      (s) =>
        s.kind === "SymbolDeclaration" &&
        (s as { name: { name: string } }).name.name === "Some",
    ) as { typeParams: string } | undefined;
    expect(some?.typeParams).toBe("T");
  });

  test("lower emits Symbol.is arms + exhaustive", () => {
    const lowered = lowerThunkSource(matchExample, fileName);
    expect(lowered.generatedText).toContain("__symbolIs");
    expect(lowered.generatedText).toContain("__symbolPayload");
    expect(lowered.generatedText).toContain("__exhaustive");
    expect(lowered.generatedText).toContain("Some");
    expect(lowered.generatedText).toMatch(/type Some<T>/);
  });

  test("typechecks; hover showAppErr / bindings", () => {
    const p = createThunkProject(projectOpts(fileName, matchExample));
    expect(p.getDiagnostics(fileName)).toEqual([]);

    const offset = matchExample.indexOf("const showAppErr") + "const ".length;
    const hover = hoverAtOffset(p, fileName, matchExample, offset);
    expect(hover?.displayString).toBeTruthy();
    expect(hover!.displayString).not.toMatch(/__brand_/);
    expect(hover!.displayString).not.toMatch(/Protocols\s*\(/);
  });

  test("non-exhaustive match is a type error", () => {
    const src = withPrelude(`import { Error } from "@thunk/runtime"
symbol NotFound extends Error { path: string }
symbol Conflict extends Error { resource: string }
type AppErr = NotFound | Conflict
const bad = (e: AppErr): string =>
  match (e) {
    NotFound: infer n => "missing " + n.path,
  }
`);
    const p = createThunkProject(projectOpts(fileName, src));
    const diags = p.getDiagnostics(fileName);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.join("\n")).toMatch(/never|exhaustive|not assignable/i);
  });
});
