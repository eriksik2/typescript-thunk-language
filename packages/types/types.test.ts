/**
 * Type-level tests for @thunk/types (assignability / inference).
 */
import { describe, expect, test } from "bun:test";
import type {
  CompileError,
  EmptyProtocols,
  ExecuteResult,
  GetRequires,
  MergeProtocols,
  Protocol,
  Requires,
  RequiresBind,
  Strip,
  Thunk,
  ThunkReturnType,
  WithRequires,
} from "./src/index";

/** Compile-time assert: `Actual` is assignable to `Expected`. */
type ExpectExtends<_Actual extends Expected, Expected> = true;

/** Compile-time assert: two types are mutually assignable. */
type ExpectEqual<A, B> = ExpectExtends<A, B> & ExpectExtends<B, A>;

describe("@thunk/types", () => {
  test("GetRequires: absent is never, present is payload", () => {
    type A = ExpectEqual<GetRequires<EmptyProtocols>, never>;
    type B = ExpectEqual<GetRequires<WithRequires<"Db">>, "Db">;
    type C = ExpectEqual<
      GetRequires<WithRequires<"Db" | "Log">>,
      "Db" | "Log"
    >;
    const _a: A = true;
    const _b: B = true;
    const _c: C = true;
    expect(_a && _b && _c).toBe(true);
  });

  test("RequiresBind unions payloads", () => {
    type M = ExpectEqual<RequiresBind<"A", "B">, "A" | "B">;
    type Id = ExpectEqual<RequiresBind<"A", never>, "A">;
    const _m: M = true;
    const _id: Id = true;
    expect(_m && _id).toBe(true);
  });

  test("MergeProtocols merges Requires and drops empty Requires", () => {
    type Pure = MergeProtocols<EmptyProtocols, EmptyProtocols>;
    type PureReq = ExpectEqual<GetRequires<Pure>, never>;

    type Left = MergeProtocols<WithRequires<"Db">, EmptyProtocols>;
    type LeftReq = ExpectEqual<GetRequires<Left>, "Db">;

    type Both = MergeProtocols<WithRequires<"Db">, WithRequires<"Log">>;
    type BothReq = ExpectEqual<GetRequires<Both>, "Db" | "Log">;

    const _p: PureReq = true;
    const _l: LeftReq = true;
    const _b: BothReq = true;
    expect(_p && _l && _b).toBe(true);
  });

  test("ExecuteResult: pure ok, requirements → CompileError", () => {
    type Ok = ExpectEqual<ExecuteResult<number, EmptyProtocols>, number>;
    type Bad = ExpectExtends<
      ExecuteResult<number, WithRequires<"Db">>,
      CompileError<"Unsatisfied requirements">
    >;
    const _ok: Ok = true;
    const _bad: Bad = true;
    expect(_ok && _bad).toBe(true);
  });

  test("Thunk helpers: ReturnType, Protocol, Strip", () => {
    type T = Thunk<string, WithRequires<"Db">>;
    type Y = ExpectEqual<ThunkReturnType<T>, string>;
    type P = ExpectEqual<Protocol<T>, WithRequires<"Db">>;
    type S = ExpectEqual<Strip<T>, Thunk<string>>;
    type SReq = ExpectEqual<GetRequires<Protocol<S>>, never>;
    const _y: Y = true;
    const _p: P = true;
    const _s: S = true;
    const _sr: SReq = true;
    expect(_y && _p && _s && _sr).toBe(true);
  });

  test("Requires symbol is usable as a bag key type", () => {
    type Bag = { readonly [Requires]: "X" };
    type G = ExpectEqual<GetRequires<Bag>, "X">;
    const _g: G = true;
    expect(_g).toBe(true);
  });
});
