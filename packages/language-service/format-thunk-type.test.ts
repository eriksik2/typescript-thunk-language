import { describe, expect, test } from "bun:test";
import {
  findThunkTypeSpan,
  formatHoverDisplayString,
  formatSymbolDisplayString,
  formatThunkDisplayString,
  formatThunkType,
  parseProtocolBag,
  prettyRequiresPayload,
  splitTopLevelArgs,
} from "./src/volar/format-thunk-type";

describe("formatThunkType", () => {
  test("empty bag → Thunk<T> only", () => {
    expect(formatThunkType("number", "EmptyProtocols")).toBe("Thunk<number>");
    expect(formatThunkType("number", "{}")).toBe("Thunk<number>");
    expect(formatThunkType("number", "{ }")).toBe("Thunk<number>");
  });

  test("Requires payload → postfix line", () => {
    expect(
      formatThunkType("User", '{ readonly [Requires]: Database | Logger }'),
    ).toBe("Thunk<User>\n  Requires(Database | Logger)");
  });

  test("typeof Requires payload → bare symbol names", () => {
    expect(
      formatThunkType(
        "string",
        "{ readonly [Requires]: typeof Database }",
      ),
    ).toBe("Thunk<string>\n  Requires(Database)");
    expect(
      formatThunkType(
        "User",
        "{ readonly [Requires]: typeof Database | typeof Logger }",
      ),
    ).toBe("Thunk<User>\n  Requires(Database | Logger)");
  });

  test("expanded symbol identity Requires → bare name", () => {
    const bag =
      "{ readonly [Requires]: ((value: { name: string; }) => Database) & { readonly key: symbol; readonly __assoc: { name: string; }; } }";
    expect(formatThunkType("string", bag)).toBe(
      "Thunk<string>\n  Requires(Database)",
    );
  });

  test("void payload → flag protocol (Once)", () => {
    expect(formatThunkType("T", "{ Once: void }")).toBe("Thunk<T>\n  Once");
  });

  test("Requires + Once together", () => {
    expect(
      formatThunkType(
        "User",
        "{ readonly [Requires]: Database | Logger, Once: void }",
      ),
    ).toBe("Thunk<User>\n  Requires(Database | Logger)\n  Once");
  });
});

describe("findThunkTypeSpan", () => {
  test("does not truncate on => inside Requires bag", () => {
    const display =
      "const fetchUser: Thunk<string, { readonly [Requires]: ((value: { name: string; }) => Database) & { readonly key: symbol; readonly __assoc: { name: string; }; } }>";
    const span = findThunkTypeSpan(display);
    expect(span).toBeDefined();
    expect(display.slice(span!.start, span!.end)).toContain("=> Database");
    expect(display.slice(span!.start, span!.end).endsWith(">")).toBe(true);
    expect(span!.end).toBe(display.length);
  });
});

describe("prettyRequiresPayload", () => {
  test("collapses expanded identity", () => {
    expect(
      prettyRequiresPayload(
        "((value: { name: string; }) => Database) & { readonly key: symbol; readonly __assoc: { name: string; }; }",
      ),
    ).toBe("Database");
  });
});

describe("formatThunkDisplayString", () => {
  test("rewrites const binding hover", () => {
    expect(
      formatThunkDisplayString("const random: Thunk<number, EmptyProtocols>"),
    ).toBe("const random: Thunk<number>");
  });

  test("leaves non-Thunk displays alone", () => {
    expect(formatThunkDisplayString("(parameter) value: number")).toBe(
      "(parameter) value: number",
    );
  });

  test("Omit<EmptyProtocols, typeof Requires> is treated as empty", () => {
    expect(
      formatThunkDisplayString(
        "const program: Thunk<number, Omit<EmptyProtocols, typeof Requires>>",
      ),
    ).toBe("const program: Thunk<number>");
  });

  test("rewrites inside markdown fence body", () => {
    const input = "```typescript\nconst x: Thunk<number, EmptyProtocols>\n```";
    expect(formatThunkDisplayString(input)).toBe(
      "```typescript\nconst x: Thunk<number>\n```",
    );
  });

  test("expanded Requires identity → Requires(Database)", () => {
    const input =
      "const fetchUser: Thunk<string, { readonly [Requires]: ((value: { name: string; }) => Database) & { readonly key: symbol; readonly __assoc: { name: string; }; } }>";
    expect(formatThunkDisplayString(input)).toBe(
      "const fetchUser: Thunk<string>\n  Requires(Database)",
    );
  });
});

describe("formatSymbolDisplayString", () => {
  test("const identity encoding → symbol T", () => {
    const raw =
      "const Database: ((value: { name: string; }) => Database) & { readonly key: symbol; readonly __assoc: { name: string; }; }";
    expect(formatSymbolDisplayString(raw)).toBe(
      "const Database: symbol { name: string }",
    );
  });

  test("type brand encoding → associated type", () => {
    const raw =
      "type Database = { name: string; } & { readonly [__brand_Database]: typeof __brand_Database; } & { readonly __assoc: { name: string; }; }";
    expect(formatSymbolDisplayString(raw)).toBe(
      "type Database = symbol { name: string }",
    );
  });

  test("formatHoverDisplayString composes symbol + thunk", () => {
    const raw =
      "const Database: ((value: { name: string; }) => Database) & { readonly key: symbol; readonly __assoc: { name: string; }; }";
    expect(formatHoverDisplayString(raw)).toBe(
      "const Database: symbol { name: string }",
    );
  });
});

describe("splitTopLevelArgs / parseProtocolBag", () => {
  test("splits nested angles", () => {
    expect(splitTopLevelArgs("Foo<A, B>, EmptyProtocols")).toEqual([
      "Foo<A, B>",
      "EmptyProtocols",
    ]);
  });

  test("parse empty", () => {
    expect(parseProtocolBag("EmptyProtocols")).toEqual([]);
  });
});
