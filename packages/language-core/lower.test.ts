import { describe, expect, test } from "bun:test";
import {
  lowerThunkSource,
  offsetToPosition,
  originalToGenerated,
  parseThunkSource,
  positionToOffset,
} from "./src/index";

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

  test("parses symbol alias and object forms", () => {
    const alias = parseThunkSource(`symbol Age = number\n`);
    expect(alias.statements[0]?.kind).toBe("SymbolDeclaration");
    const aliasDecl = alias.statements[0] as {
      name: { name: string };
      associatedType: { form: string; text: string };
    };
    expect(aliasDecl.name.name).toBe("Age");
    expect(aliasDecl.associatedType.form).toBe("alias");
    expect(aliasDecl.associatedType.text).toBe("number");

    const obj = parseThunkSource(`symbol Database {
  name: string
}
`);
    const objDecl = obj.statements[0] as {
      associatedType: { form: string; text: string };
    };
    expect(objDecl.associatedType.form).toBe("object");
    expect(objDecl.associatedType.text).toContain("name: string");
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

  test("lowers symbol declaration to brand + __makeSymbol", () => {
    const lowered = lowerThunkSource(`symbol Age = number
const a: Age = Age(30)
`);
    expect(lowered.generatedText).toContain("__makeSymbol");
    expect(lowered.generatedText).toContain("declare const __brand_Age");
    expect(lowered.generatedText).toContain("type Age = number &");
    expect(lowered.generatedText).toContain("__symbolIdentity?: typeof Age");
    expect(lowered.generatedText).toContain('__makeSymbol<number>("Age")');
    expect(lowered.generatedText).not.toContain("createTag");
  });

  test("lowers requires.thunk-style symbol + use", () => {
    const lowered = lowerThunkSource(`symbol Database {
  name: string
}

const fetchUser = thunk {
  const db = run use(Database)
  return db.name
}
`);
    expect(lowered.generatedText).toContain("__makeSymbol");
    expect(lowered.generatedText).toContain("use(Database)");
    expect(lowered.generatedText).toContain("type Database =");
  });

  test("parses and lowers import declarations", () => {
    const source = `import { use, provide, layerOf } from "@thunk/runtime"
const x = use
`;
    const ast = parseThunkSource(source);
    expect(ast.statements[0]?.kind).toBe("ImportDeclaration");
    const imp = ast.statements[0] as {
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
    const lowered = lowerThunkSource(`const program: Thunk<number> = thunk {
  return 1
}
`);
    expect(lowered.generatedText).toContain(
      'import type { Thunk } from "@thunk/types"',
    );
    expect(lowered.generatedText).toContain("@thunk/runtime/internal");
  });

  test("parses and lowers nested thunk inside object literal", () => {
    const source = `const DatabaseLive = Database({
  name: "live",
  getUser: (id: string) => thunk {
    return { id, name: "Ada" }
  }
})
`;
    const ast = parseThunkSource(source);
    const stmt = ast.statements[0] as {
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
    const source = `const fetchUser = thunk {
  const db = run use(Database)
  const user = run db.getUser("1234")
  return db.name + " " + user.name
}
`;
    const ast = parseThunkSource(source);
    const body = (
      ast.statements[0] as {
        initializer: { body: { initializer?: { kind: string; expression?: { kind: string; text?: string } } }[] };
      }
    ).initializer.body;
    const userStmt = body[1]!;
    expect(userStmt.initializer?.kind).toBe("RunExpression");
    expect(userStmt.initializer?.expression?.kind).toBe("TsExpression");
    expect(userStmt.initializer?.expression?.text).toBe('db.getUser("1234")');

    const lowered = lowerThunkSource(source);
    expect(lowered.generatedText).toContain(
      'bind(db.getUser("1234"), user => succeed(db.name + " " + user.name))',
    );
    expect(lowered.generatedText).not.toContain("bind(db, user");
    expect(lowered.generatedText).not.toMatch(/\{\s*\.getUser/);
  });

  test("return run lowers to bind then succeed", () => {
    const lowered = lowerThunkSource(`const program = thunk {
  return run provide(fetchUser, db)
}
`);
    expect(lowered.generatedText).toContain(
      "bind(provide(fetchUser, db), __v => succeed(__v))",
    );
    expect(lowered.generatedText).not.toContain("succeed(execute(");
  });

  test("symbol name mappings land on generated Database identifier", () => {
    const source = `symbol Database {
  name: string
}
`;
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
