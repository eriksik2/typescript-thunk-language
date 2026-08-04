/**
 * Runtime API type + behavior tests.
 */
import { describe, expect, test } from "bun:test";
import { bind, defer, execute, succeed } from "./src/index";
import type {
  CompileError,
  ExecuteResult,
  GetRequires,
  Protocol,
  Thunk,
  WithRequires,
} from "@thunk/types";

type ExpectExtends<_Actual extends Expected, Expected> = true;
type ExpectEqual<A, B> = ExpectExtends<A, B> & ExpectExtends<B, A>;

describe("@thunk/runtime", () => {
  test("succeed / execute pure value", () => {
    const t = succeed(42);
    expect(execute(t)).toBe(42);
  });

  test("defer delays factory until execute", () => {
    let ran = false;
    const t = defer(() => {
      ran = true;
      return succeed(7);
    });
    expect(ran).toBe(false);
    expect(execute(t)).toBe(7);
    expect(ran).toBe(true);
  });

  test("bind sequences", () => {
    const t = bind(succeed(2), (n) => succeed(n * 3));
    expect(execute(t)).toBe(6);
  });

  test("succeed returns Thunk with empty Requires", () => {
    const t = succeed(1);
    type P = ExpectEqual<GetRequires<Protocol<typeof t>>, never>;
    const _p: P = true;
    expect(_p).toBe(true);
  });

  test("bind merges Requires in the type", () => {
    type Db = "Database";
    type Log = "Logger";
    // Simulate thunks that already carry requirements (cast — use/provide later).
    const withDb = succeed(0) as unknown as Thunk<number, WithRequires<Db>>;
    const cont = (_n: number) =>
      succeed("ok") as unknown as Thunk<string, WithRequires<Log>>;
    const merged = bind(withDb, cont);
    type Req = ExpectEqual<GetRequires<Protocol<typeof merged>>, Db | Log>;
    const _m: Req = true;
    expect(_m).toBe(true);
  });

  test("execute of pure thunk is the yield type", () => {
    const t = succeed(3.14);
    type R = ExpectEqual<ExecuteResult<number, Protocol<typeof t>>, number>;
    const _r: R = true;
    expect(execute(t)).toBe(3.14);
    expect(_r).toBe(true);
  });

  test("execute of required thunk is CompileError at the type level", () => {
    type Required = Thunk<number, WithRequires<"Db">>;
    type R = ExecuteResult<number, Protocol<Required>>;
    type IsErr = ExpectExtends<R, CompileError<"Unsatisfied requirements">>;
    const _e: IsErr = true;
    expect(_e).toBe(true);
  });
});
