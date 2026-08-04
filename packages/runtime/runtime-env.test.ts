import { describe, expect, test } from "bun:test";
import {
  __makeSymbol,
  bind,
  execute,
  layerOf,
  provide,
  succeed,
  use,
} from "./src/index";
import type {
  ExecuteResult,
  GetRequires,
  Protocol,
  ProvideRequires,
  SymbolType,
  WithRequires,
} from "@thunk/types";

type ExpectExtends<_Actual extends Expected, Expected> = true;
type ExpectEqual<A, B> = ExpectExtends<A, B> & ExpectExtends<B, A>;

describe("use / provide / Layer", () => {
  test("use + provide + execute at runtime", () => {
    const Database = __makeSymbol<{ query: () => string }>("Database");
    const program = bind(use(Database), (db) => succeed(db.query()));
    const live = layerOf(Database, { query: () => "ok" });
    const runnable = provide(program, live);
    expect(execute(runnable)).toBe("ok");
  });

  test("use introduces Requires in the type", () => {
    const Database = __makeSymbol<number>("Database");
    const t = use(Database);
    type Req = ExpectEqual<GetRequires<Protocol<typeof t>>, typeof Database>;
    type Yield = ExpectEqual<SymbolType<typeof Database>, number>;
    const _r: Req = true;
    const _y: Yield = true;
    expect(_r && _y).toBe(true);
  });

  test("provide removes Requires from the type", () => {
    const Database = __makeSymbol<number>("Database");
    const t = use(Database);
    const live = layerOf(Database, 42);
    const provided = provide(t, live);
    type Req = ExpectEqual<GetRequires<Protocol<typeof provided>>, never>;
    type Exec = ExpectEqual<
      ExecuteResult<number, Protocol<typeof provided>>,
      number
    >;
    const _r: Req = true;
    const _e: Exec = true;
    expect(execute(provided)).toBe(42);
    expect(_r && _e).toBe(true);
  });

  test("bind merges two use requirements", () => {
    const A = __makeSymbol<"a">("A");
    const B = __makeSymbol<"b">("B");
    const t = bind(use(A), (a) => bind(use(B), (b) => succeed(`${a}${b}`)));
    type Req = ExpectEqual<
      GetRequires<Protocol<typeof t>>,
      typeof A | typeof B
    >;
    const _r: Req = true;
    const layered = provide(provide(t, layerOf(A, "a")), layerOf(B, "b"));
    expect(execute(layered)).toBe("ab");
    expect(_r).toBe(true);
  });

  test("ProvideRequires type helper", () => {
    type P = WithRequires<"Db" | "Log">;
    type Out = ProvideRequires<P, "Db">;
    type Req = ExpectEqual<GetRequires<Out>, "Log">;
    const _r: Req = true;
    expect(_r).toBe(true);
  });

  test("__makeSymbol is callable for branding", () => {
    const Age = __makeSymbol<number>("Age");
    const a = Age(30);
    expect(a).toBe(30);
    expect(typeof Age.key).toBe("symbol");
  });
});
