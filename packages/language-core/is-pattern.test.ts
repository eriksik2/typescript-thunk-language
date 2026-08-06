/**
 * `expr is pattern` boolean tests + if/while bindings.
 */

import { describe, expect, test } from "bun:test";
import { lowerThunkSource, parseThunkSource } from "./src/index";
import { bodyStmts, withPrelude } from "./test-prelude";

describe("is pattern parse", () => {
  test("x is Err is IsExpression", () => {
    const ast = parseThunkSource(withPrelude(`const b = x is Err\n`));
    const init = (bodyStmts(ast)[0] as { initializer: { kind: string } })
      .initializer;
    expect(init.kind).toBe("IsExpression");
  });

  test("x is Err: infer e parses binding", () => {
    const ast = parseThunkSource(withPrelude(`const b = x is Err: infer e\n`));
    const init = (
      bodyStmts(ast)[0] as {
        initializer: {
          kind: string;
          pattern: { kind: string; binding?: { name: string } };
        };
      }
    ).initializer;
    expect(init.kind).toBe("IsExpression");
    expect(init.pattern.binding?.name).toBe("e");
  });

  test("ready && x is Err: infer e is And of Is", () => {
    const ast = parseThunkSource(withPrelude(`const b = ready && x is Err: infer e\n`));
    const init = (
      bodyStmts(ast)[0] as {
        initializer: {
          kind: string;
          left: { kind: string };
          right: { kind: string };
        };
      }
    ).initializer;
    expect(init.kind).toBe("AndExpression");
    expect(init.right.kind).toBe("IsExpression");
  });

  test(".is property is not pattern is", () => {
    const ast = parseThunkSource(withPrelude(`const b = obj.is\n`));
    const init = (bodyStmts(ast)[0] as { initializer: { kind: string } })
      .initializer;
    expect(init.kind).toBe("TsExpression");
  });
});

describe("is pattern lower", () => {
  test("boolean is without binding", () => {
    const lowered = lowerThunkSource(withPrelude(`import { Err } from "@thunk/runtime"
const x = Err("e")
const b = x is Err
`));
    expect(lowered.generatedText).toContain("__symbolIs(x, Err)");
  });

  test("if (x is Err: infer e) binds e inside thunk", () => {
    const lowered = lowerThunkSource(withPrelude(`import { Err, Ok, type Result } from "@thunk/runtime"
const show = (r: Result<number, string>) => thunk {
  if (r is Err: infer e) {
    return "err " + e
  }
  return "ok"
}
`));
    expect(lowered.generatedText).toContain("__symbolIs(r, Err)");
    expect(lowered.generatedText).toContain("__symbolPayload");
    expect(lowered.generatedText).toMatch(/const e =/);
  });

  test("if (ready && r is Ok: infer n) nests flow inside thunk", () => {
    const lowered = lowerThunkSource(withPrelude(`import { Ok, type Result } from "@thunk/runtime"
const show = (ready: boolean, r: Result<number, string>) => thunk {
  if (ready && r is Ok: infer n) {
    return n
  }
  return 0
}
`));
    expect(lowered.generatedText).toContain("if (ready)");
    expect(lowered.generatedText).toContain("__symbolIs(r, Ok)");
  });

  test("binding is in value position throws at lower", () => {
    expect(() =>
      lowerThunkSource(withPrelude(`import { Err } from "@thunk/runtime"
const e = Err("x")
const bad = e is Err: infer msg
`)),
    ).toThrow(/only allowed in `if` \/ `while`/);
  });
});
