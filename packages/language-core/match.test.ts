/**
 * Match + generic symbol parse/lower tests.
 */

import { describe, expect, test } from "bun:test";
import { lowerThunkSource, parseThunkSource } from "./src/index";
import { bodyStmts, withPrelude } from "./test-prelude";

describe("generic symbols", () => {
  test("parses symbol Ok<A> = A", () => {
    const ast = parseThunkSource(withPrelude(`symbol Ok<A> = A\n`));
    const decl = bodyStmts(ast)[0] as {
      kind: string;
      name: { name: string };
      typeParams: string;
      associatedType?: { text: string };
    };
    expect(decl.kind).toBe("SymbolDeclaration");
    expect(decl.name.name).toBe("Ok");
    expect(decl.typeParams).toBe("A");
    expect(decl.associatedType?.text).toBe("A");
  });

  test("lowers generic symbol", () => {
    const lowered = lowerThunkSource(withPrelude(`symbol Ok<A> = A\nconst x = Ok(1)\n`));
    expect(lowered.generatedText).toMatch(/type Ok<A>/);
    expect(lowered.generatedText).toContain("__makeSymbol<any>");
  });
});

describe("match parse / lower", () => {
  test("parses MatchExpression arms", () => {
    const ast = parseThunkSource(withPrelude(`const y = match (x) {
  Ok: infer a => a,
  Err: infer e => e,
}
`));
    const init = (
      bodyStmts(ast)[0] as {
        initializer: {
          kind: string;
          arms: { pattern: { kind: string } }[];
        };
      }
    ).initializer;
    expect(init.kind).toBe("MatchExpression");
    expect(init.arms).toHaveLength(2);
    expect(init.arms[0]!.pattern.kind).toBe("MatchSymbolPattern");
  });

  test("parses object field patterns", () => {
    const ast = parseThunkSource(withPrelude(`const y = match (s) {
  Circle { radius: infer r } => r,
}
`));
    const init = (
      bodyStmts(ast)[0] as {
        initializer: {
          kind: string;
          arms: {
            pattern: {
              kind: string;
              fields?: { field: { name: string } }[];
            };
          }[];
        };
      }
    ).initializer;
    expect(init.arms[0]!.pattern.kind).toBe("MatchObjectPattern");
    expect(init.arms[0]!.pattern.fields?.[0]?.field.name).toBe("radius");
  });

  test("lowers to __symbolIs + __exhaustive", () => {
    const lowered = lowerThunkSource(withPrelude(`import { Ok, Err, type Result } from "@thunk/runtime"
const show = (r: Result<number, string>): string =>
  match (r) {
    Ok: infer n => "ok " + n,
    Err: infer e => "err " + e,
  }
`));
    expect(lowered.generatedText).toContain("__symbolIs(__match, Ok)");
    expect(lowered.generatedText).toContain("else if (__symbolIs(__match, Err)");
    expect(lowered.generatedText).toContain("__exhaustive(__match)");
    expect(lowered.generatedText).toContain("__symbolPayload");
  });
});
