/**
 * Pipe `|` and expression-position `run` (ANF) tests.
 */

import { describe, expect, test } from "bun:test";
import {
  lowerThunkSource,
  normalizeAnf,
  parseThunkSource,
} from "./src/index";

describe("pipe parse", () => {
  test("x | f is PipeExpression", () => {
    const ast = parseThunkSource(`const y = x | f\n`);
    const init = (ast.statements[0] as { initializer: { kind: string } })
      .initializer;
    expect(init.kind).toBe("PipeExpression");
  });

  test("run tx | f is Run wrapping Pipe", () => {
    const ast = parseThunkSource(`const v = run tx | flatten(1)\n`);
    const init = (
      ast.statements[0] as {
        initializer: {
          kind: string;
          expression: { kind: string };
        };
      }
    ).initializer;
    expect(init.kind).toBe("RunExpression");
    expect(init.expression.kind).toBe("PipeExpression");
  });

  test("a | b | c is left-associative", () => {
    const ast = parseThunkSource(`const y = a | b | c\n`);
    const init = (
      ast.statements[0] as {
        initializer: {
          kind: string;
          left: { kind: string };
          right: { kind: string };
        };
      }
    ).initializer;
    expect(init.kind).toBe("PipeExpression");
    expect(init.left.kind).toBe("PipeExpression");
    expect(init.right.kind).toBe("TsExpression");
  });

  test("(run tx) | f embeds Run inside Ts left of Pipe", () => {
    const ast = parseThunkSource(`const y = (run tx) | f\n`);
    const init = (
      ast.statements[0] as {
        initializer: {
          kind: string;
          left: {
            kind: string;
            parts?: { kind: string; expression?: { kind: string } }[];
          };
        };
      }
    ).initializer;
    expect(init.kind).toBe("PipeExpression");
    expect(init.left.kind).toBe("TsExpression");
    const embed = init.left.parts?.find((p) => p.kind === "embedded");
    expect(embed?.expression?.kind).toBe("RunExpression");
  });
});

describe("pipe lower", () => {
  test("x | f → f(x)", () => {
    const lowered = lowerThunkSource(`const y = x | f\n`);
    expect(lowered.generatedText).toContain("f(x)");
    expect(lowered.generatedText).not.toContain("x | f");
  });

  test("x | f(a, b) → f(x, a, b)", () => {
    const lowered = lowerThunkSource(`const y = x | f(a, b)\n`);
    expect(lowered.generatedText).toContain("f(x, a, b)");
  });

  test("x | obj.m → obj.m(x)", () => {
    const lowered = lowerThunkSource(`const y = x | obj.m\n`);
    expect(lowered.generatedText).toContain("obj.m(x)");
  });

  test("run tx | flatten(1) → execute(flatten(tx, 1))", () => {
    const lowered = lowerThunkSource(`const v = run tx | flatten(1)\n`);
    expect(lowered.generatedText).toContain("execute(flatten(tx, 1))");
  });

  test("inside thunk: run tx | f → runEffect(f(tx))", () => {
    const lowered = lowerThunkSource(`const program = thunk {
  const v = run tx | f
  return v
}
`);
    expect(lowered.generatedText).toContain("runEffect(f(tx))");
  });
});

describe("ANF expression-position run", () => {
  test("lifts (run getUser).name", () => {
    const ast = parseThunkSource(`const program = thunk {
  return (run getUser).name
}
`);
    const thunk = (
      ast.statements[0] as {
        initializer: { kind: string; body: unknown[] };
      }
    ).initializer;
    expect(thunk.kind).toBe("ThunkExpression");
    const normalized = normalizeAnf(
      (thunk as { body: Parameters<typeof normalizeAnf>[0] }).body,
    );
    expect(normalized.length).toBeGreaterThan(1);
    expect(normalized[0]).toMatchObject({
      kind: "VariableStatement",
      declarationKind: "const",
    });
    expect(
      (normalized[0] as { initializer: { kind: string } }).initializer.kind,
    ).toBe("RunExpression");
  });

  test("lowers (run getUser).name via ANF + machine", () => {
    const lowered = lowerThunkSource(`const program = thunk {
  return (run getUser).name
}
`);
    expect(lowered.generatedText).toContain("runEffect(");
    expect(lowered.generatedText).toContain("__r0");
    expect(lowered.generatedText).toMatch(/__r0\)\.name|__r0\.name/);
  });

  test("foo(run a, run b) lifts two runs", () => {
    const lowered = lowerThunkSource(`const program = thunk {
  return foo(run a, run b)
}
`);
    expect(lowered.generatedText).toContain("__r0");
    expect(lowered.generatedText).toContain("__r1");
    expect(lowered.generatedText).toContain("foo(__r0, __r1)");
  });

  test("while (run next()) re-evaluates run each iteration", () => {
    const lowered = lowerThunkSource(`const program = thunk {
  while (run next()) {
    const x = 1
  }
  return 0
}
`);
    expect(lowered.generatedText).toContain("runEffect(");
    expect(lowered.generatedText).toContain("__r0");
    // Condition rewritten to `while (true)` with break-on-false after each run
    expect(lowered.generatedText).toMatch(/true/);
  });
});
