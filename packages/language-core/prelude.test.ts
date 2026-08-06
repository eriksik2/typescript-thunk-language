import { describe, expect, test } from "bun:test";
import { ParseError, lowerThunkSource, parseThunkSource } from "./src/index";
import { withPrelude } from "./test-prelude";

describe("file prelude", () => {
  test("parses feature file with tags", () => {
    const ast = parseThunkSource(
      `feature Billing
tags Service DomainLogic
`,
      "Billing.feature.thunk",
    );
    expect(ast.statements[0]?.kind).toBe("FeatureDeclaration");
    expect(
      (ast.statements[0] as { name: { name: string } }).name.name,
    ).toBe("Billing");
    expect(ast.statements[1]?.kind).toBe("TagsDeclaration");
  });

  test("parses file of feature", () => {
    const ast = parseThunkSource(`file charge of Billing
const x = 1
`);
    const decl = ast.statements[0] as {
      kind: string;
      name: { name: string };
      ofPath: { name: string }[];
    };
    expect(decl.kind).toBe("FileDeclaration");
    expect(decl.name.name).toBe("charge");
    expect(decl.ofPath.map((p) => p.name)).toEqual(["Billing"]);
  });

  test("parses feature of parent path", () => {
    const ast = parseThunkSource(
      `feature Parser of BankImportSystem\n`,
      "Parser.feature.thunk",
    );
    const feat = ast.statements[0] as {
      kind: string;
      name: { name: string };
      ofPath?: { name: string }[];
    };
    expect(feat.kind).toBe("FeatureDeclaration");
    expect(feat.name.name).toBe("Parser");
    expect(feat.ofPath?.map((p) => p.name)).toEqual(["BankImportSystem"]);
  });

  test("parses nested of path on file", () => {
    const ast = parseThunkSource(
      `file parseIntl of BankImportSystem.Parser\n`,
    );
    const decl = ast.statements[0] as {
      ofPath: { name: string }[];
      name: { name: string };
    };
    expect(decl.name.name).toBe("parseIntl");
    expect(decl.ofPath.map((p) => p.name)).toEqual([
      "BankImportSystem",
      "Parser",
    ]);
  });

  test("code file rejecting feature prelude", () => {
    expect(() =>
      parseThunkSource(`feature Examples\nconst x = 1\n`, "x.thunk"),
    ).toThrow(/file <Name> of/);
  });

  test("feature file rejecting file prelude", () => {
    expect(() =>
      parseThunkSource(
        `file x of Examples\n`,
        "Examples.feature.thunk",
      ),
    ).toThrow(/feature <Name>/);
  });

  test("file without of errors", () => {
    expect(() => parseThunkSource(`file charge\n`)).toThrow(/expected `of`/);
  });

  test("missing prelude is a parse error", () => {
    expect(() => parseThunkSource(`const x = 1\n`)).toThrow(ParseError);
  });

  test("lower erases file prelude", () => {
    const lowered = lowerThunkSource(
      withPrelude(`const program = thunk {
  return 1
}
`),
    );
    expect(lowered.generatedText).not.toMatch(/\bfile\b/);
    expect(lowered.generatedText).not.toMatch(/\bfeature\b/);
    expect(lowered.generatedText).toContain("program");
  });

  test("lower erases feature prelude", () => {
    const lowered = lowerThunkSource(
      `feature Billing
tags Service
`,
      "Billing.feature.thunk",
    );
    expect(lowered.generatedText).not.toMatch(/\bfeature\b/);
    expect(lowered.generatedText).not.toMatch(/\btags\b/);
  });
});
