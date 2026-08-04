import { describe, expect, test } from "bun:test";
import {
  formatThunkDisplayString,
  formatThunkType,
  parseProtocolBag,
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
