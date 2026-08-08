import { describe, expect, test } from "bun:test";
import {
  bind,
  execute,
  machine,
  runEffect,
  succeed,
  __awaitPromise,
} from "./src/internal";
import { wrap } from "./src/wrap";
import { UnhandledError, Symbol } from "./src/index";
import type {
  Async,
  ExecuteResult,
  HasAsync,
  Protocol,
  WithAsync,
} from "@thunk/types";

type ExpectExtends<_Actual extends Expected, Expected> = true;
type ExpectEqual<A, B> = ExpectExtends<A, B> & ExpectExtends<B, A>;

describe("wrap / Async", () => {
  test("wrap introduces Async and execute returns Promise", async () => {
    const t = wrap(() => Promise.resolve(42));
    type P = ExpectEqual<HasAsync<Protocol<typeof t>>, true>;
    type R = ExpectEqual<
      ExecuteResult<number, Protocol<typeof t>>,
      Promise<number>
    >;
    const _p: P = true;
    const _r: R = true;
    const result = execute(t);
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBe(42);
    expect(_p && _r).toBe(true);
  });

  test("wrap accepts an already-started Promise", async () => {
    const t = wrap(Promise.resolve("hi"));
    expect(await execute(t)).toBe("hi");
  });

  test("rejection becomes UnhandledError", async () => {
    const t = wrap(() => Promise.reject(new globalThis.Error("boom")));
    try {
      await execute(t);
      throw new Error("expected reject");
    } catch (err) {
      expect(Symbol.is(err, UnhandledError)).toBe(true);
      expect(Symbol.unwrap(err as UnhandledError).message).toBe("boom");
    }
  });

  test("machine + run wrap keeps Async on the type", async () => {
    let state = 0;
    const t = machine((resume?: any) => {
      while (true) {
        switch (state) {
          case 0:
            state = 1;
            return runEffect(wrap(() => Promise.resolve(3)));
          case 1:
            return succeed((resume as number) * 2);
          default:
            throw new Error("bad state");
        }
      }
    });
    type A = ExpectEqual<HasAsync<Protocol<typeof t>>, true>;
    type R = ExpectEqual<
      ExecuteResult<number, Protocol<typeof t>>,
      Promise<number>
    >;
    const _a: A = true;
    const _r: R = true;
    expect(await execute(t)).toBe(6);
    expect(_a && _r).toBe(true);
  });

  test("bind merges Async with pure", async () => {
    const t = bind(wrap(() => Promise.resolve(1)), (n) => succeed(n + 1));
    type A = ExpectEqual<HasAsync<Protocol<typeof t>>, true>;
    const _a: A = true;
    expect(await execute(t)).toBe(2);
    expect(_a).toBe(true);
  });

  test("sync execute still returns plain T", () => {
    const t = succeed(7);
    type R = ExpectEqual<ExecuteResult<number, Protocol<typeof t>>, number>;
    const _r: R = true;
    expect(execute(t)).toBe(7);
    expect(_r).toBe(true);
  });

  test("__awaitPromise is the internal node constructor", async () => {
    const t = __awaitPromise(
      () => Promise.resolve(1),
      () => {
        throw UnhandledError({ message: "x" });
      },
    );
    type Bag = Protocol<typeof t>;
    type Has = ExpectExtends<Bag, WithAsync>;
    const _h: Has = true;
    expect(await execute(t)).toBe(1);
    expect(_h).toBe(true);
  });
});
