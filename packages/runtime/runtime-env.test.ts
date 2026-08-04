import { describe, expect, test } from "bun:test";
import { layerOf, provide, symbolOf, Symbol, use } from "./src/index";
import {
  __makeSymbol,
  bind,
  execute,
  succeed,
} from "./src/internal";
import type {
  ExecuteResult,
  GetRequires,
  Protocol,
  ProvideRequires,
  SymbolOfValue,
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

  test("Symbol.of recovers identity from branded object", () => {
    type Service = { name: string };
    const Database = __makeSymbol<Service>("Database");
    const live = Database({ name: "live" });
    expect(symbolOf(live)).toBe(Database);
    expect(Symbol.of(live)).toBe(Database);
  });

  test("provide(thunk, branded) installs under Symbol.of key", () => {
    type Service = { name: string };
    const Database = __makeSymbol<Service>("Database");
    type Database = Service & {
      readonly __assoc: Service;
      readonly __symbolIdentity?: typeof Database;
    };
    const live = Database({ name: "ada" }) as Database;
    const program = bind(use(Database), (db) => succeed(db.name));
    const runnable = provide(program, live);
    type Req = ExpectEqual<GetRequires<Protocol<typeof runnable>>, never>;
    const _r: Req = true;
    expect(execute(runnable)).toBe("ada");
    expect(_r).toBe(true);
  });

  test("Symbol.of throws on naked primitives", () => {
    const Age = __makeSymbol<number>("Age");
    const a = Age(30);
    expect(() => symbolOf(a as never)).toThrow(/Symbol\.of/);
  });
});
