import { describe, expect, test } from "bun:test";
import {
  lowerThunkSource,
  offsetToPosition,
  originalToGenerated,
  parseThunkSource,
  positionToOffset,
} from "./src/index";
import { bodyStmts, withPrelude } from "./test-prelude";

describe("parse", () => {
  test("parses thunk + run", () => {
    const ast = parseThunkSource(withPrelude(`const program = thunk {
  const value = run random
  return value * 2
}
`));
    expect(bodyStmts(ast)).toHaveLength(1);
    const init = (bodyStmts(ast)[0] as { initializer: { kind: string; body: unknown[] } })
      .initializer;
    expect(init.kind).toBe("ThunkExpression");
    expect(init.body).toHaveLength(2);
  });

  test("parses symbol alias and object forms", () => {
    const alias = parseThunkSource(withPrelude(`symbol Age = number\n`));
    expect(bodyStmts(alias)[0]?.kind).toBe("SymbolDeclaration");
    const aliasDecl = bodyStmts(alias)[0] as {
      name: { name: string };
      isAbstract: boolean;
      associatedType: { form: string; text: string };
    };
    expect(aliasDecl.name.name).toBe("Age");
    expect(aliasDecl.isAbstract).toBe(false);
    expect(aliasDecl.associatedType.form).toBe("alias");
    expect(aliasDecl.associatedType.text).toBe("number");

    const obj = parseThunkSource(withPrelude(`symbol Database {
  name: string
}
`));
    const objDecl = bodyStmts(obj)[0] as {
      associatedType: { form: string; text: string };
    };
    expect(objDecl.associatedType.form).toBe("object");
    expect(objDecl.associatedType.text).toContain("name: string");
  });

  test("parses abstract symbol and extends", () => {
    const src = parseThunkSource(withPrelude(`abstract symbol Failure {
  message: string
}
symbol Defect extends Failure
symbol Error extends Failure {
  code: number
}
`));
    expect(bodyStmts(src)).toHaveLength(3);
    const failure = bodyStmts(src)[0] as {
      kind: string;
      name: { name: string };
      isAbstract: boolean;
      extendsName?: { name: string };
      associatedType?: { text: string };
    };
    expect(failure.isAbstract).toBe(true);
    expect(failure.name.name).toBe("Failure");
    expect(failure.extendsName).toBeUndefined();
    expect(failure.associatedType?.text).toContain("message: string");

    const defect = bodyStmts(src)[1] as typeof failure;
    expect(defect.isAbstract).toBe(false);
    expect(defect.name.name).toBe("Defect");
    expect(defect.extendsName?.name).toBe("Failure");
    expect(defect.associatedType).toBeUndefined();

    const err = bodyStmts(src)[2] as typeof failure;
    expect(err.extendsName?.name).toBe("Failure");
    expect(err.associatedType?.text).toContain("code: number");
  });
});

describe("lower", () => {
  test("lowers run to state machine (runEffect + machine)", () => {
    const lowered = lowerThunkSource(withPrelude(`const program = thunk {
  const value = run random
  return value * 2
}
`));
    expect(lowered.generatedText).toContain("__ascribeThunkYield");
    expect(lowered.generatedText).toContain("await __oracleRun");
    expect(lowered.generatedText).toContain("runEffect(");
    expect(lowered.generatedText).toContain("machine(");
    expect(lowered.generatedText).toContain("succeed(");
    expect(lowered.generatedText).toContain("defer(");
    expect(lowered.generatedText).toContain("let __state = 0");
    expect(lowered.generatedText).not.toContain("bind(");
    expect(lowered.sourceMap.mappings.length).toBeGreaterThan(0);
  });

  test("lowers symbol declaration to opaque brand + __makeSymbol", () => {
    const lowered = lowerThunkSource(withPrelude(`symbol Age = number
const a: Age = Age(30)
`));
    expect(lowered.generatedText).toContain("__makeSymbol");
    expect(lowered.generatedText).toContain("declare const __brand_Age");
    expect(lowered.generatedText).toMatch(
      /type Age = \{ readonly \[__brand_Age\]/,
    );
    expect(lowered.generatedText).not.toMatch(/type Age = number &/);
    expect(lowered.generatedText).toContain("__symbolIdentity?: typeof Age");
    expect(lowered.generatedText).toContain('__makeSymbol<number>("Age")');
    expect(lowered.generatedText).not.toContain("createTag");
  });

  test("lowers abstract symbol + extends with parent brand intersection", () => {
    const lowered = lowerThunkSource(withPrelude(`abstract symbol Failure {
  message: string
}
symbol Defect extends Failure
`));
    expect(lowered.generatedText).toContain("abstract: true");
    expect(lowered.generatedText).toContain("parent: Failure");
    expect(lowered.generatedText).toContain("__abstract: true");
    expect(lowered.generatedText).toContain("__parent?: typeof Failure");
    expect(lowered.generatedText).toMatch(
      /type Defect = \{ readonly \[__brand_Defect\]/,
    );
    expect(lowered.generatedText).toContain("__assoc:");
    expect(lowered.generatedText).not.toMatch(/type Defect = Failure &/);
    expect(lowered.generatedText).toContain("__brand_Defect");
    expect(lowered.generatedText).toMatch(
      /__makeSymbol<\{\s*message:\s*string\s*\}>\("Defect"/,
    );
  });

  test("lowers requires.thunk-style symbol + use", () => {
    const lowered = lowerThunkSource(withPrelude(`symbol Database {
  name: string
}

const fetchUser = thunk {
  const db = run use(Database)
  return db.name
}
`));
    expect(lowered.generatedText).toContain("__makeSymbol");
    expect(lowered.generatedText).toContain("use(Database)");
    expect(lowered.generatedText).toContain("type Database =");
  });

  test("parses and lowers import declarations", () => {
    const source = withPrelude(`import { use, provide, layerOf } from "@thunk/runtime"
const x = use
`);
    const ast = parseThunkSource(source);
    expect(bodyStmts(ast)[0]?.kind).toBe("ImportDeclaration");
    const imp = bodyStmts(ast)[0] as {
      module: string;
      specifiers: { local: string }[];
    };
    expect(imp.module).toBe("@thunk/runtime");
    expect(imp.specifiers.map((s) => s.local)).toEqual([
      "use",
      "provide",
      "layerOf",
    ]);
    const lowered = lowerThunkSource(source);
    expect(lowered.generatedText).toContain(
      'import { use, provide, layerOf } from "@thunk/runtime"',
    );
    expect(lowered.generatedText).toContain("@thunk/runtime/internal");
    expect(lowered.generatedText).not.toContain(
      'use, provide, layerOf } from "@thunk/runtime/internal"',
    );
  });

  test("auto-injects Thunk type without author import", () => {
    const lowered = lowerThunkSource(withPrelude(`const program: Thunk<number> = thunk {
  return 1
}
`));
    expect(lowered.generatedText).toContain(
      'import type { Thunk } from "@thunk/types"',
    );
    expect(lowered.generatedText).toContain("@thunk/runtime/internal");
  });

  test("parses and lowers nested thunk inside object literal", () => {
    const source = withPrelude(`const DatabaseLive = Database({
  name: "live",
  getUser: (id: string) => thunk {
    return { id, name: "Ada" }
  }
})
`);
    const ast = parseThunkSource(source);
    const stmt = bodyStmts(ast)[0] as {
      initializer: {
        kind: string;
        parts: { kind: string; expression?: { kind: string } }[];
      };
    };
    expect(stmt.initializer.kind).toBe("TsExpression");
    expect(stmt.initializer.parts.some((p) => p.kind === "embedded")).toBe(
      true,
    );
    const embedded = stmt.initializer.parts.find((p) => p.kind === "embedded");
    expect(embedded?.expression?.kind).toBe("ThunkExpression");

    const lowered = lowerThunkSource(source);
    expect(lowered.generatedText).toContain(
      'getUser: (id: string) => defer(() => succeed({ id, name: "Ada" }))',
    );
    expect(lowered.generatedText).not.toContain("=> thunk {");
  });

  test("run operand is a full expression (member call like await)", () => {
    const source = withPrelude(`const fetchUser = thunk {
  const db = run use(Database)
  const user = run db.getUser("1234")
  return db.name + " " + user.name
}
`);
    const ast = parseThunkSource(source);
    const body = (
      bodyStmts(ast)[0] as {
        initializer: { body: { initializer?: { kind: string; expression?: { kind: string; text?: string } } }[] };
      }
    ).initializer.body;
    const userStmt = body[1]!;
    expect(userStmt.initializer?.kind).toBe("RunExpression");
    expect(userStmt.initializer?.expression?.kind).toBe("TsExpression");
    expect(userStmt.initializer?.expression?.text).toBe('db.getUser("1234")');

    const lowered = lowerThunkSource(source);
    expect(lowered.generatedText).toContain('runEffect(db.getUser("1234"))');
    expect(lowered.generatedText).toContain("user = __resume as ThunkReturnType");
    expect(lowered.generatedText).toContain(
      'succeed(db.name + " " + user.name)',
    );
    expect(lowered.generatedText).not.toContain("bind(");
    expect(lowered.generatedText).not.toContain("runEffect(db)");
    expect(lowered.generatedText).not.toMatch(/\{\s*\.getUser/);
  });

  test("return run lowers to runEffect then succeed(__resume)", () => {
    const lowered = lowerThunkSource(withPrelude(`const program = thunk {
  return run provide(fetchUser, db)
}
`));
    expect(lowered.generatedText).toContain(
      "return runEffect(provide(fetchUser, db))",
    );
    expect(lowered.generatedText).toMatch(
      /return succeed\(__resume as ThunkReturnType<NonNullable<typeof __t\d+>>\);/,
    );
    expect(lowered.generatedText).not.toContain("succeed(execute(");
    expect(lowered.generatedText).not.toContain("bind(");
  });

  test("if / for / break / continue lower to state transitions", () => {
    const lowered = lowerThunkSource(withPrelude(`const program = thunk {
  let total = 0
  for (let i = 0; i < 3; i = i + 1) {
    const v = run step(i)
    if (v === 0) {
      continue
    }
    total = total + v
    if (total > 10) {
      break
    }
  }
  return total
}
`));
    expect(lowered.generatedText).toContain("machine(");
    expect(lowered.generatedText).toContain("runEffect(step(i))");
    expect(lowered.generatedText).toContain("continue;");
    expect(lowered.generatedText).toMatch(/if \(v === 0\)/);
    expect(lowered.generatedText).toMatch(/if \(total > 10\)/);
    expect(lowered.generatedText).not.toContain("bind(");
    // Unannotated ordinary locals get InferLet witnesses (not bare `let total;`)
    expect(lowered.generatedText).toMatch(/InferLet/);
    expect(lowered.generatedText).toMatch(/import type \{[^}]*\bInferLet\b/);
  });

  test("postfix ++ does not swallow the next if/return statements", () => {
    const source = withPrelude(`const program = thunk {
  let tries = 0
  while (true) {
    const x = run step()
    tries++
    if (tries > 20) return tries
  }
}
`);
    const ast = parseThunkSource(source);
    const thunk = (bodyStmts(ast)[0] as { initializer: { body: unknown[] } })
      .initializer;
    const whileStmt = thunk.body[1] as {
      kind: string;
      body: { statements: { kind: string; expression?: { text?: string } }[] };
    };
    expect(whileStmt.kind).toBe("WhileStatement");
    const stmts = whileStmt.body.statements;
    expect(stmts.some((s) => s.kind === "ExpressionStatement")).toBe(true);
    expect(stmts.some((s) => s.kind === "IfStatement")).toBe(true);
    const expr = stmts.find((s) => s.kind === "ExpressionStatement");
    expect(expr?.expression?.text).toBe("tries++");

    const lowered = lowerThunkSource(source);
    expect(lowered.generatedText).toContain("__ascribeThunkYield");
    expect(lowered.generatedText).toContain("await __oracleRun");
    expect(lowered.generatedText).toContain("tries++;");
    expect(lowered.generatedText).toMatch(/if \(tries > 20\)/);
    // Oracle keeps surface-shaped early return; machine uses succeed.
    expect(lowered.generatedText).toMatch(
      /tries\+\+;\s*\nif \(tries > 20\) return tries/,
    );
    expect(lowered.generatedText).toContain("return succeed(tries)");
    const machine = lowered.generatedText.slice(
      lowered.generatedText.indexOf("return machine("),
    );
    expect(machine).toContain("return succeed(tries)");
    expect(machine).not.toMatch(/\breturn tries\b/);
  });

  test("return run lower casts resume yield (not bare __resume)", () => {
    const lowered = lowerThunkSource(withPrelude(`const program = thunk {
  return run wrap(() => Promise.resolve(true))
}
`));
    expect(lowered.generatedText).toMatch(
      /return succeed\(__resume as ThunkReturnType<NonNullable<typeof __t\d+>>\);/,
    );
    expect(lowered.generatedText).not.toMatch(
      /return succeed\(__resume\);/,
    );
  });

  test("symbol name mappings land on generated Database identifier", () => {
    const source = withPrelude(`symbol Database {
  name: string
}
`);
    const lowered = lowerThunkSource(source, "sym.thunk");
    const nameOffset = source.indexOf("Database");
    for (let i = 0; i < "Database".length; i++) {
      const gen = originalToGenerated(
        lowered.sourceMap,
        offsetToPosition(source, nameOffset + i),
      );
      expect(gen).toBeDefined();
      const off = positionToOffset(lowered.generatedText, gen!);
      let start = off;
      while (
        start > 0 &&
        /[A-Za-z_]/.test(lowered.generatedText[start - 1]!)
      ) {
        start--;
      }
      let end = off;
      while (
        end < lowered.generatedText.length &&
        /[A-Za-z_]/.test(lowered.generatedText[end]!)
      ) {
        end++;
      }
      expect(lowered.generatedText.slice(start, end)).toBe("Database");
    }
  });
});
