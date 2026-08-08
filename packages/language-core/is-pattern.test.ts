/**
 * `expr is pattern` / `expr is any pattern` boolean tests + if/while bindings.
 */

import { describe, expect, test } from "bun:test";
import { lowerThunkSource, parseThunkSource } from "./src/index";
import { bodyStmts, withPrelude } from "./test-prelude";

describe("is pattern parse", () => {
  test("x is NotFound is IsExpression", () => {
    const ast = parseThunkSource(withPrelude(`const b = x is NotFound\n`));
    const init = (bodyStmts(ast)[0] as { initializer: { kind: string } })
      .initializer;
    expect(init.kind).toBe("IsExpression");
  });

  test("x is any Error parses pedigree", () => {
    const ast = parseThunkSource(withPrelude(`const b = x is any Error\n`));
    const init = (
      bodyStmts(ast)[0] as {
        initializer: { kind: string; pedigree: boolean };
      }
    ).initializer;
    expect(init.kind).toBe("IsExpression");
    expect(init.pedigree).toBe(true);
  });

  test("x is NotFound: infer e parses binding", () => {
    const ast = parseThunkSource(
      withPrelude(`const b = x is NotFound: infer e\n`),
    );
    const init = (
      bodyStmts(ast)[0] as {
        initializer: {
          kind: string;
          pedigree: boolean;
          pattern: { kind: string; binding?: { name: string } };
        };
      }
    ).initializer;
    expect(init.kind).toBe("IsExpression");
    expect(init.pedigree).toBe(false);
    expect(init.pattern.binding?.name).toBe("e");
  });

  test("x is any Error: infer e parses pedigree binding", () => {
    const ast = parseThunkSource(
      withPrelude(`const b = x is any Error: infer e\n`),
    );
    const init = (
      bodyStmts(ast)[0] as {
        initializer: {
          kind: string;
          pedigree: boolean;
          pattern: { binding?: { name: string } };
        };
      }
    ).initializer;
    expect(init.pedigree).toBe(true);
    expect(init.pattern.binding?.name).toBe("e");
  });

  test("ready && x is NotFound: infer e is And of Is", () => {
    const ast = parseThunkSource(
      withPrelude(`const b = ready && x is NotFound: infer e\n`),
    );
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
    const lowered = lowerThunkSource(withPrelude(`import { Error } from "@thunk/runtime"
symbol NotFound extends Error { path: string }
const x = NotFound({ message: "e", path: "/" })
const b = x is NotFound
`));
    expect(lowered.generatedText).toContain("__symbolIs(x, NotFound)");
  });

  test("boolean is any without binding", () => {
    const lowered = lowerThunkSource(withPrelude(`import { Error } from "@thunk/runtime"
symbol NotFound extends Error { path: string }
const x = NotFound({ message: "e", path: "/" })
const b = x is any Error
`));
    expect(lowered.generatedText).toContain("__symbolIsAny(x, Error)");
  });

  test("if (x is NotFound: infer e) binds e inside thunk", () => {
    const lowered = lowerThunkSource(withPrelude(`import { Error } from "@thunk/runtime"
symbol NotFound extends Error { path: string }
const show = (r: number | NotFound) => thunk {
  if (r is NotFound: infer e) {
    return "err " + e.message
  }
  return "ok"
}
`));
    expect(lowered.generatedText).toContain("__symbolIs(r, NotFound)");
    expect(lowered.generatedText).toContain("__symbolPayload");
    expect(lowered.generatedText).toMatch(/const e =/);
  });

  test("if (r is any Error: infer e) uses pedigree helpers", () => {
    const lowered = lowerThunkSource(withPrelude(`import { Error } from "@thunk/runtime"
symbol NotFound extends Error { path: string }
const show = (r: number | NotFound) => thunk {
  if (r is any Error: infer e) {
    return "err " + e.message
  }
  return "ok " + r
}
`));
    expect(lowered.generatedText).toContain("__symbolIsAny(r, Error)");
    expect(lowered.generatedText).toContain("__symbolPayload");
  });

  test("if (ready && r is NotFound: infer n) nests flow inside thunk", () => {
    const lowered = lowerThunkSource(withPrelude(`import { Error } from "@thunk/runtime"
symbol NotFound extends Error { path: string }
const show = (ready: boolean, r: number | NotFound) => thunk {
  if (ready && r is NotFound: infer n) {
    return n.path
  }
  return "other"
}
`));
    expect(lowered.generatedText).toContain("if (ready)");
    expect(lowered.generatedText).toContain("__symbolIs(r, NotFound)");
  });

  test("binding is in value position throws at lower", () => {
    expect(() =>
      lowerThunkSource(withPrelude(`import { Error } from "@thunk/runtime"
symbol NotFound extends Error { path: string }
const e = NotFound({ message: "x", path: "/" })
const bad = e is NotFound: infer msg
`)),
    ).toThrow(/only allowed in `if` \/ `while`/);
  });
});
