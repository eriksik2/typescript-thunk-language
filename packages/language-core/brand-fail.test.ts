/**
 * Opaque brands + Symbol.unwrap + Fail annotation.
 */

import { describe, expect, test } from "bun:test";
import { lowerThunkSource, parseThunkSource } from "./src/index";
import { bodyStmts, withPrelude } from "./test-prelude";
import { encodeThunkTypeAnnotation } from "./src/protocol-encode";

describe("opaque brands", () => {
  test("Age brand type is opaque (not number & brand)", () => {
    const lowered = lowerThunkSource(
      withPrelude(`symbol Age = number\nconst a: Age = Age(30)\n`),
    );
    expect(lowered.generatedText).toMatch(
      /type Age = \{ readonly \[__brand_Age\]/,
    );
    expect(lowered.generatedText).not.toMatch(/type Age = number &/);
  });
});

describe("Fail annotation", () => {
  test("parses Fail before Requires", () => {
    const ast = parseThunkSource(
      withPrelude(`const op: Thunk<User> Fail(NotFound) Requires(Database) = thunk {
  return 1 as unknown as User
}
`),
    );
    const stmt = bodyStmts(ast)[0] as {
      typeAnnotation?: {
        baseText: string;
        failPayload?: string;
        protocols: { name: string }[];
      };
    };
    expect(stmt.typeAnnotation?.baseText).toBe("Thunk<User>");
    expect(stmt.typeAnnotation?.failPayload).toBe("NotFound");
    expect(stmt.typeAnnotation?.protocols.map((p) => p.name)).toEqual([
      "Requires",
    ]);
  });

  test("encodes Fail into yield union", () => {
    const { typeText } = encodeThunkTypeAnnotation(
      "Thunk<number>",
      [],
      "DivideByZero",
    );
    expect(typeText).toBe("Thunk<number | (DivideByZero)>");
  });

  test("encodes Fail + Requires", () => {
    const { typeText } = encodeThunkTypeAnnotation(
      "Thunk<User>",
      [{ name: "Requires", payload: "Database", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }],
      "NotFound | Conflict",
    );
    expect(typeText).toContain("User | (NotFound | Conflict)");
    expect(typeText).toContain("[Requires]");
  });
});

describe("type union vs pipe", () => {
  test("arrow return Thunk<number | E> is not PipeExpression", () => {
    const ast = parseThunkSource(
      withPrelude(`const f = (x: number): Thunk<number | E> => thunk { return x }\n`),
    );
    const stmt = bodyStmts(ast)[0] as {
      initializer: { kind: string };
    };
    expect(stmt.initializer.kind).not.toBe("PipeExpression");
  });

  test("comparison i < n does not break for-header parsing", () => {
    const lowered = lowerThunkSource(
      withPrelude(`const program = thunk {
  let total = 0
  for (let i = 0; i < 3; i = i + 1) {
    total = total + i
  }
  return total
}
`),
    );
    expect(lowered.generatedText).toContain("i < 3");
    expect(lowered.generatedText).toContain("for (let i = 0;");
  });
});
