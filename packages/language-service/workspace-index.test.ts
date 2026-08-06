import { describe, expect, test } from "bun:test";
import {
  extractThunkFileMeta,
  indexThunkWorkspace,
} from "./src/workspace-index";

describe("extractThunkFileMeta", () => {
  test("reads feature file", () => {
    const meta = extractThunkFileMeta(
      "Billing.feature.thunk",
      `feature Billing
tags Service DomainLogic
`,
    );
    expect(meta.valid).toBe(true);
    expect(meta.isFeatureFile).toBe(true);
    expect(meta.feature).toBe("Billing");
    expect(meta.tags).toEqual(["Service", "DomainLogic"]);
  });

  test("reads file of feature as qualified owner", () => {
    const meta = extractThunkFileMeta(
      "/proj/BankImportSystem/Parser/parse.thunk",
      `file parse of BankImportSystem.Parser
const x = 1
`,
    );
    expect(meta.feature).toBe("BankImportSystem.Parser");
    expect(meta.localName).toBe("parse");
    expect(meta.isFeatureFile).toBe(false);
  });

  test("missing prelude → invalid", () => {
    const meta = extractThunkFileMeta("b.thunk", `const x = 1\n`);
    expect(meta.valid).toBe(false);
    expect(meta.error).toMatch(/file/);
  });
});

describe("indexThunkWorkspace", () => {
  test("builds hierarchical feature tree and placement", () => {
    const index = indexThunkWorkspace([
      {
        path: "/proj/BankImportSystem/BankImportSystem.feature.thunk",
        text: `feature BankImportSystem
tags Finance
`,
      },
      {
        path: "/proj/BankImportSystem/charge.thunk",
        text: `file charge of BankImportSystem
const a = 1
`,
      },
      {
        path: "/proj/BankImportSystem/Parser/Parser.feature.thunk",
        text: `feature Parser of BankImportSystem
tags Parsing
`,
      },
      {
        path: "/proj/BankImportSystem/Parser/parse.thunk",
        text: `file parse of BankImportSystem.Parser
const b = 1
`,
      },
      {
        path: "/proj/BankImportSystem/Parser/bad-owner.thunk",
        text: `file bad of BankImportSystem
const c = 1
`,
      },
    ]);

    expect(index.featureTags).toEqual(["Finance", "Parsing"]);
    expect(index.featuresMatchingTags(["Parsing"])).toHaveLength(1);
    expect(index.featuresMatchingTags([])).toHaveLength(2);

    expect(index.registry.byQualified.get("BankImportSystem")).toBeTruthy();
    expect(
      index.registry.byQualified.get("BankImportSystem.Parser"),
    ).toBeTruthy();
    expect(index.featureTree).toHaveLength(1);
    expect(index.featureTree[0]!.children[0]!.feature.localName).toBe(
      "Parser",
    );

    expect(
      index.placementDiagnostics.some((d) =>
        d.fileName.includes("bad-owner.thunk"),
      ),
    ).toBe(true);
  });
});
