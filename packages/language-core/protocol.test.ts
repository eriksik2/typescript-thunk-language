import { describe, expect, test } from "bun:test";
import { parseThunkSource, lowerThunkSource } from "./src/index";
import { encodeThunkTypeAnnotation } from "./src/protocol-encode";

describe("postfix protocols", () => {
  test("parses Requires + Once on variable annotation", () => {
    const ast = parseThunkSource(`const op: Thunk<User>
  Requires(Database | Logger)
  Once
= thunk {
  return 1 as unknown as User
}
`);
    const stmt = ast.statements[0] as {
      kind: string;
      typeAnnotation?: {
        baseText: string;
        protocols: { name: string; payload?: string }[];
      };
    };
    expect(stmt.kind).toBe("VariableStatement");
    expect(stmt.typeAnnotation?.baseText).toBe("Thunk<User>");
    expect(stmt.typeAnnotation?.protocols.map((p) => p.name)).toEqual([
      "Requires",
      "Once",
    ]);
    expect(stmt.typeAnnotation?.protocols[0]?.payload).toBe(
      "Database | Logger",
    );
  });

  test("lowers postfix to ProtocolBag encoding", () => {
    const lowered = lowerThunkSource(`const op: Thunk<number>
  Requires(Database)
= thunk {
  return 1
}
`);
    expect(lowered.generatedText).toContain(
      'import type { Thunk, Requires } from "@thunk/types"',
    );
    expect(lowered.generatedText).toContain(
      'import { succeed, defer, bind, execute } from "@thunk/runtime/internal"',
    );
    expect(lowered.generatedText).not.toContain("layerOf");
    expect(lowered.generatedText).toContain(
      "readonly [Requires]: typeof Database",
    );
    expect(lowered.generatedText).toContain("Thunk<number,");
  });

  test("encode merges repeated Requires", () => {
    const { typeText } = encodeThunkTypeAnnotation("Thunk<T>", [
      {
        name: "Requires",
        payload: "A",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
      },
      {
        name: "Requires",
        payload: "B",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
      },
    ]);
    expect(typeText).toContain("typeof A | typeof B");
  });
});

describe("protocol declarations", () => {
  test("parses and lowers protocol Requires", () => {
    const source = `protocol Requires<Tags extends Tag<any>> {
  bind<A, B>: A | B;
  execute<A>: A extends never ? never : CompileError<\`Unsatisfied\`>;
}
`;
    const ast = parseThunkSource(source);
    expect(ast.statements[0]?.kind).toBe("ProtocolDeclaration");
    const lowered = lowerThunkSource(source);
    expect(lowered.generatedText).toContain("type Requires_bind");
    expect(lowered.generatedText).toContain("type Requires_execute");
    expect(lowered.generatedText).toContain('__protocol: "Requires"');
  });
});
