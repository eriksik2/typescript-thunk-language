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
