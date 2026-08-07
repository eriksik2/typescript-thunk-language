/**
 * `try` sugar: run + early-return on `is any Error`.
 */

import { describe, expect, test } from "bun:test";
import { lowerThunkSource, parseThunkSource } from "./src/index";
import { bodyStmts, withPrelude } from "./test-prelude";

describe("try parse / lower", () => {
  test("parses TryExpression", () => {
    const ast = parseThunkSource(
      withPrelude(`const t = thunk { const n = try div\n return n\n }\n`),
    );
    const init = (
      bodyStmts(ast)[0] as {
        initializer: {
          kind: string;
          body: { kind: string; initializer?: { kind: string } }[];
        };
      }
    ).initializer;
    expect(init.kind).toBe("ThunkExpression");
    const first = init.body[0] as { initializer?: { kind: string } };
    expect(first.initializer?.kind).toBe("TryExpression");
  });

  test("lowers try to run + is any Error early return", () => {
    const lowered = lowerThunkSource(withPrelude(`import { Error, type Thunk } from "@thunk/runtime"
symbol DivideByZero extends Error {}
type DivResult = number | DivideByZero
const div: Thunk<DivResult> = thunk { return 1 }
const t = thunk {
  const n = try div
  return n + 1
}
`));
    expect(lowered.generatedText).toContain("__ThunkError");
    expect(lowered.generatedText).toContain("__symbolIsAny");
    expect(lowered.generatedText).toContain("runEffect");
  });

  test("top-level try throws", () => {
    expect(() =>
      lowerThunkSource(withPrelude(`const x = try div\n`)),
    ).toThrow(/only allowed inside/);
  });
});
