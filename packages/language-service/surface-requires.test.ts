/**
 * Surface integration tests for requires.thunk (symbol + use / provide / hover).
 *
 * These assert editor-facing strings and mappings — the regressions we ship against.
 */

import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  lowerThunkSource,
  offsetToPosition,
  originalToGenerated,
  positionToOffset,
} from "@thunk/language-core";
import {
  createThunkProject,
  hoverAtOffset,
} from "./src/index";

const root = path.resolve(import.meta.dirname, "../..");
const fileName = path.join(root, "examples/requires.thunk");
const typesPath = path.join(root, "packages/types/src/index.ts");
const runtimePath = path.join(root, "packages/runtime/src/index.ts");
const internalPath = path.join(root, "packages/runtime/src/internal.ts");

const source = `import { use, provide } from "@thunk/runtime"

symbol Database {
  name: string
}

const DatabaseLive = Database({
  name: "live"
})

const fetchUser = thunk {
  const db = run use(Database)
  return db.name
}

const program: Thunk<string> = provide(
  fetchUser,
  DatabaseLive,
)

const result = run program
`;

function projectOpts() {
  return {
    files: { [fileName]: source },
    internalImportPath: "@thunk/runtime/internal",
    moduleMap: {
      "@thunk/types": typesPath,
      "@thunk/runtime": runtimePath,
      "@thunk/runtime/internal": internalPath,
    },
  } as const;
}

function project() {
  return createThunkProject(projectOpts());
}

function offsetOf(needle: string, occurrence = 0): number {
  let from = 0;
  for (let i = 0; i <= occurrence; i++) {
    const idx = source.indexOf(needle, from);
    if (idx === -1) throw new Error(`missing ${needle}`);
    if (i === occurrence) return idx;
    from = idx + needle.length;
  }
  throw new Error("unreachable");
}

describe("surface: requires.thunk", () => {
  test("lower emits internal helpers + preserves user import", () => {
    const lowered = lowerThunkSource(source, fileName);
    expect(lowered.generatedText).toContain(
      'import { use, provide } from "@thunk/runtime"',
    );
    expect(lowered.generatedText).toContain(
      'from "@thunk/runtime/internal"',
    );
    expect(lowered.generatedText).toContain("__makeSymbol");
    expect(lowered.generatedText).not.toMatch(
      /import \{[^}]*\buse\b[^}]*\} from "@thunk\/runtime\/internal"/,
    );
  });

  test("Database identifier maps to generated Database (not mid-cast)", () => {
    const lowered = lowerThunkSource(source, fileName);
    const nameOffset = offsetOf("symbol Database") + "symbol ".length;
    for (let i = 0; i < "Database".length; i++) {
      const pos = offsetToPosition(source, nameOffset + i);
      const gen = originalToGenerated(lowered.sourceMap, pos);
      expect(gen).toBeDefined();
      const genOff = positionToOffset(lowered.generatedText, gen!);
      let start = genOff;
      while (
        start > 0 &&
        /[A-Za-z_]/.test(lowered.generatedText[start - 1]!)
      ) {
        start--;
      }
      let end = genOff;
      while (
        end < lowered.generatedText.length &&
        /[A-Za-z_]/.test(lowered.generatedText[end]!)
      ) {
        end++;
      }
      expect(lowered.generatedText.slice(start, end)).toBe("Database");
    }
  });

  test("use without import → cannot find name", () => {
    const noImport = `symbol Database {
  name: string
}
const fetchUser = thunk {
  const db = run use(Database)
  return db.name
}
`;
    const p = createThunkProject({
      files: { [fileName]: noImport },
      moduleMap: {
        "@thunk/types": typesPath,
        "@thunk/runtime": runtimePath,
        "@thunk/runtime/internal": internalPath,
      },
    });
    const diags = p.getDiagnostics(fileName).join("\n");
    expect(diags).toMatch(/Cannot find name 'use'/);
  });

  test("hover Database → surface symbol, no encoding noise", () => {
    const p = project();
    const nameOffset = offsetOf("symbol Database") + "symbol ".length;
    const hover = hoverAtOffset(p, fileName, source, nameOffset);
    expect(hover?.displayString).toBeTruthy();
    const d = hover!.displayString;
    expect(d).toMatch(/symbol/);
    expect(d).toMatch(/name:\s*string/);
    expect(d).not.toMatch(/__brand_/);
    expect(d).not.toMatch(/__assoc/);
    expect(d).not.toMatch(/__makeSymbol/);
  });

  test("hover fetchUser → Thunk<string> Requires(Database)", () => {
    const p = project();
    const offset = offsetOf("const fetchUser") + "const ".length;
    const hover = hoverAtOffset(p, fileName, source, offset);
    expect(hover?.displayString).toBeTruthy();
    const d = hover!.displayString;
    expect(d).toContain("Thunk<string>");
    expect(d).toMatch(/Requires\(Database\)/);
    expect(d).not.toMatch(/Protocols\s*\(/);
    expect(d).not.toMatch(/=>/);
    expect(d).not.toMatch(/__assoc/);
    expect(d).not.toMatch(/__brand_/);
  });

  test("hover program → pure Thunk<string> (Thunk auto-available)", () => {
    const p = project();
    const offset = offsetOf("const program") + "const ".length;
    const hover = hoverAtOffset(p, fileName, source, offset);
    expect(hover?.displayString).toBeTruthy();
    const d = hover!.displayString;
    expect(d).toContain("Thunk<string>");
    expect(d).not.toMatch(/Requires\(/);
    expect(d).not.toMatch(/Protocols\s*\(/);
    expect(d).not.toMatch(/EmptyProtocols/);
  });

  test("hover db from use(Database) → service shape", () => {
    const p = project();
    const offset = offsetOf("const db") + "const ".length;
    const hover = hoverAtOffset(p, fileName, source, offset);
    expect(hover?.displayString).toBeTruthy();
    const d = hover!.displayString;
    expect(d).toMatch(/name/);
    expect(d).not.toMatch(/__assoc/);
    expect(d).not.toMatch(/\(value:/);
  });

  test("nested thunk in object literal typechecks and lowers", () => {
    const nested = `import { use, provide } from "@thunk/runtime"

interface User {
  id: string
  name: string
}

symbol Database {
  name: string
  getUser: (id: string) => Thunk<User>
}

const DatabaseLive = Database({
  name: "live",
  getUser: (id: string) => thunk {
    return { id, name: "Ada" }
  }
})

const program: Thunk<string> = provide(
  thunk {
    const db = run use(Database)
    return db.name
  },
  DatabaseLive,
)
`;
    const p = createThunkProject({
      files: { [fileName]: nested },
      moduleMap: {
        "@thunk/types": typesPath,
        "@thunk/runtime": runtimePath,
        "@thunk/runtime/internal": internalPath,
      },
    });
    expect(p.getDiagnostics(fileName)).toEqual([]);

    const lowered = lowerThunkSource(nested, fileName);
    expect(lowered.generatedText).toContain("defer(() => succeed({ id, name: \"Ada\" }))");
    expect(lowered.generatedText).not.toContain("=> thunk {");

    const offset = nested.indexOf("const DatabaseLive") + "const ".length;
    const hover = hoverAtOffset(p, fileName, nested, offset);
    expect(hover?.displayString).toBeTruthy();
    expect(hover!.displayString).toMatch(/Database/);
    expect(hover!.displayString).not.toMatch(/__brand_/);
  });

  test("run db.getUser(...) typechecks like await (full operand)", () => {
    const src = `import { use, provide } from "@thunk/runtime"

interface User {
  id: string
  name: string
}

symbol Database {
  name: string
  getUser: (id: string) => Thunk<User>
}

const DatabaseLive = Database({
  name: "live",
  getUser: (id: string) => thunk {
    return { id, name: "Ada" }
  }
})

const fetchUser = thunk {
  const db = run use(Database)
  const user = run db.getUser("1234")
  return user.name
}

const program: Thunk<string> = provide(fetchUser, DatabaseLive)
`;
    const p = createThunkProject({
      files: { [fileName]: src },
      moduleMap: {
        "@thunk/types": typesPath,
        "@thunk/runtime": runtimePath,
        "@thunk/runtime/internal": internalPath,
      },
    });
    expect(p.getDiagnostics(fileName)).toEqual([]);

    const lowered = lowerThunkSource(src, fileName);
    expect(lowered.generatedText).toContain('runEffect(db.getUser("1234"))');
    expect(lowered.generatedText).toContain(
      "user = __resume as ThunkReturnType",
    );
    expect(lowered.generatedText).not.toContain("bind(");

    const offset = src.indexOf("const user") + "const ".length;
    const hover = hoverAtOffset(p, fileName, src, offset);
    expect(hover?.displayString).toBeTruthy();
    expect(hover!.displayString).toMatch(/\bUser\b/);
    expect(hover!.displayString).not.toMatch(/Thunk</);
    expect(hover!.displayString).not.toMatch(/__brand_/);
  });
});
