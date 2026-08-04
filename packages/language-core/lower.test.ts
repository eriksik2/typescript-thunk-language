import { describe, expect, test } from "bun:test";
import { parseThunkSource, lowerThunkSource } from "./src/index";

describe("parse", () => {
  test("parses thunk + run", () => {
    const ast = parseThunkSource(`const program = thunk {
  const value = run random
  return value * 2
}
`);
    expect(ast.statements).toHaveLength(1);
    const init = (ast.statements[0] as { initializer: { kind: string; body: unknown[] } })
      .initializer;
    expect(init.kind).toBe("ThunkExpression");
    expect(init.body).toHaveLength(2);
  });
});

describe("lower", () => {
  test("lowers run to bind", () => {
    const lowered = lowerThunkSource(`const program = thunk {
  const value = run random
  return value * 2
}
`);
    expect(lowered.generatedText).toContain("bind(");
    expect(lowered.generatedText).toContain("succeed(");
    expect(lowered.generatedText).toContain("defer(");
    expect(lowered.sourceMap.mappings.length).toBeGreaterThan(0);
  });

  test("preserves control flow inside thunk bodies", () => {
    const lowered = lowerThunkSource(`const program = thunk {
  let total = 0
  for (const value of values) {
    if (value > 0) {
      total += value
    }
  }
  switch (total) {
    case 0:
      total = -1
      break
    default:
      break
  }
  return total
}
`);
    expect(lowered.generatedText).toContain("for (const value of values)");
    expect(lowered.generatedText).toContain("switch (total)");
    expect(lowered.generatedText).toContain("succeed(total)");
  });
});
