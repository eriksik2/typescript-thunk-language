/**
 * Type-level tests for @thunk/types (assignability / inference).
 */
import { describe, expect, test } from "bun:test";
import type {
  BrandCarrier,
  Branded,
  CompileError,
  EmptyProtocols,
  ExecuteResult,
  GetRequires,
  HasAsync,
  IdentityCarrier,
  InferLet,
  MergeProtocols,
  Protocol,
  Requires,
  RequiresBind,
  Strip,
  SymbolOfValue,
  SymbolType,
  Thunk,
  ThunkReturnType,
  ThunkSymbol,
  WithAsync,
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
    type PureIsEmpty = ExpectEqual<Pure, EmptyProtocols>;

    type Left = MergeProtocols<WithRequires<"Db">, EmptyProtocols>;
    type LeftReq = ExpectEqual<GetRequires<Left>, "Db">;

    type Both = MergeProtocols<WithRequires<"Db">, WithRequires<"Log">>;
    type BothReq = ExpectEqual<GetRequires<Both>, "Db" | "Log">;

    const _p: PureReq = true;
    const _pe: PureIsEmpty = true;
    const _l: LeftReq = true;
    const _b: BothReq = true;
    expect(_p && _pe && _l && _b).toBe(true);
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

  test("ExecuteResult: Async → Promise<T>", () => {
    type AsyncOk = ExpectEqual<
      ExecuteResult<number, WithAsync>,
      Promise<number>
    >;
    type Merged = MergeProtocols<WithAsync, WithRequires<"Db">>;
    type StillErr = ExpectExtends<
      ExecuteResult<number, Merged>,
      CompileError<"Unsatisfied requirements">
    >;
    type Has = ExpectEqual<HasAsync<WithAsync>, true>;
    type HasUnion = ExpectEqual<HasAsync<EmptyProtocols | WithAsync>, true>;
    const _a: AsyncOk = true;
    const _e: StillErr = true;
    const _h: Has = true;
    const _u: HasUnion = true;
    expect(_a && _e && _h && _u).toBe(true);
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

  test("Thunk protocol bags are not absorbed by EmptyProtocols", () => {
    type Req = Thunk<string, WithRequires<"Db">>;
    type Pure = Thunk<string, EmptyProtocols>;
    type AsyncT = Thunk<number, WithAsync>;

    type ReqToPure = Req extends Pure ? true : false;
    type AsyncToPure = AsyncT extends Pure ? true : false;
    type PureToPure = Pure extends Pure ? true : false;

    type ReqHidden = ExpectEqual<ReqToPure, false>;
    type AsyncHidden = ExpectEqual<AsyncToPure, false>;
    type PureOk = ExpectEqual<PureToPure, true>;

    const _r: ReqHidden = true;
    const _a: AsyncHidden = true;
    const _p: PureOk = true;
    expect(_r && _a && _p).toBe(true);
  });

  test("InferLet widens primitive literals", () => {
    type N = ExpectEqual<InferLet<0>, number>;
    type S = ExpectEqual<InferLet<"hi">, string>;
    type B = ExpectEqual<InferLet<true>, boolean>;
    type Obj = ExpectEqual<InferLet<{ a: 1 }>, { a: 1 }>;
    const _n: N = true;
    const _s: S = true;
    const _b: B = true;
    const _o: Obj = true;
    expect(_n && _s && _b && _o).toBe(true);
  });

  test("Requires symbol is usable as a bag key type", () => {
    type Bag = { readonly [Requires]: "X" };
    type G = ExpectEqual<GetRequires<Bag>, "X">;
    const _g: G = true;
    expect(_g).toBe(true);
  });

  test("SymbolType extracts assoc from identity and branded", () => {
    type Id = ThunkSymbol<{ name: string }>;
    type FromId = ExpectEqual<SymbolType<Id>, { name: string }>;

    declare const __brand_Age: unique symbol;
    type Age = Branded<number, typeof __brand_Age>;
    type FromBrand = ExpectEqual<SymbolType<Age>, number>;

    const _i: FromId = true;
    const _b: FromBrand = true;
    expect(_i && _b).toBe(true);
  });

  test("branded Age does not assign to number; unwrap recovers payload", () => {
    declare const __brand_Age: unique symbol;
    type Age = Branded<number, typeof __brand_Age>;

    // Age is opaque — not assignable to number
    type AgeToNumber = Age extends number ? true : false;
    type NotAssign = ExpectEqual<AgeToNumber, false>;
    // number is not assignable to Age
    type NumberToAge = number extends Age ? true : false;
    type NotReverse = ExpectEqual<NumberToAge, false>;

    type Payload = ExpectEqual<SymbolType<Age>, number>;

    const _a: NotAssign = true;
    const _r: NotReverse = true;
    const _p: Payload = true;
    expect(_a && _r && _p).toBe(true);
  });

  test("Requires bag keys are symbol identities", () => {
    type Db = ThunkSymbol<{ query: () => string }>;
    type Bag = WithRequires<Db>;
    type Req = ExpectEqual<GetRequires<Bag>, Db>;
    type Carrier = ExpectExtends<Db, BrandCarrier<{ query: () => string }>>;
    const _r: Req = true;
    const _c: Carrier = true;
    expect(_r && _c).toBe(true);
  });

  test("SymbolOfValue extracts identity from IdentityCarrier", () => {
    type Db = ThunkSymbol<{ name: string }>;
    type Live = { name: string } & IdentityCarrier<Db>;
    type Id = ExpectEqual<SymbolOfValue<Live>, Db>;
    const _i: Id = true;
    expect(_i).toBe(true);
  });
});
