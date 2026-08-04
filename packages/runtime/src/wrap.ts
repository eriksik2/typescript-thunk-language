/**
 * Promise ↔ Thunk bridge (`wrap`).
 *
 * Introduces the `Async` protocol. Rejections become `UnhandledError` throws
 * (full typed failure channels / catch remain deferred).
 */

import type { Thunk, WithAsync } from "@thunk/types";
import { UnhandledError } from "./failure";
import { __awaitPromise } from "./internal";

function rejectAsUnhandled(reason: unknown): never {
  const message =
    reason instanceof globalThis.Error
      ? reason.message
      : String(reason);
  throw UnhandledError({ message });
}

/**
 * Lift a Promise (or lazy Promise factory) into a `Thunk<A> Async`.
 *
 * Prefer the factory form so construction stays inert until execute:
 * `wrap(() => fetch(...))`. Passing an already-started Promise is allowed
 * inside a running thunk body.
 *
 * ```ts
 * const program = thunk {
 *   const n = run wrap(() => Promise.resolve(1))
 *   return n + 1
 * }
 * const result = run program // Promise<number>
 * ```
 */
export function wrap<A>(
  promiseOrFactory: Promise<A> | (() => Promise<A>),
): Thunk<A, WithAsync> {
  const factory =
    typeof promiseOrFactory === "function"
      ? (promiseOrFactory as () => Promise<A>)
      : () => promiseOrFactory;
  return __awaitPromise(factory, rejectAsUnhandled);
}
