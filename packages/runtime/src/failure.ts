/**
 * Built-in Failure hierarchy (symbols).
 *
 * ```
 * Failure (abstract)
 *   ├── Defect
 *   ├── UnhandledError
 *   └── Error
 * ```
 *
 * - `Failure` — abstract root; `Symbol.is(x, Failure)` works; cannot brand.
 * - `Defect` — corrupted / should-never-happen (e.g. naked throws in thunks).
 * - `UnhandledError` — external failure not yet handled (e.g. future `wrap`).
 * - `Error` — ordinary tagged application error (handleable later).
 *
 * Import from `@thunk/runtime`. The `Error` export shadows global `Error` when
 * imported by name — use `globalThis.Error` for the platform constructor.
 */

import type { ThunkSymbol } from "@thunk/types";
import { __makeSymbol } from "./internal";

export type FailurePayload = {
  message: string;
};

declare const __brand_Failure: unique symbol;
declare const __brand_Defect: unique symbol;
declare const __brand_UnhandledError: unique symbol;
declare const __brand_Error: unique symbol;

/** Abstract root of the failure hierarchy. */
export type Failure = FailurePayload & {
  readonly [__brand_Failure]: typeof __brand_Failure;
} & { readonly __assoc: FailurePayload };

/**
 * Abstract Failure identity — not callable.
 * Still participates in `Symbol.is` / `Symbol.extends`.
 */
export const Failure: {
  readonly key: symbol;
  readonly __assoc: FailurePayload;
  readonly __abstract: true;
} = __makeSymbol<FailurePayload>("Failure", {
  abstract: true,
}) as unknown as {
  readonly key: symbol;
  readonly __assoc: FailurePayload;
  readonly __abstract: true;
};

const failureParent = Failure as unknown as ThunkSymbol<FailurePayload>;

/** Defect — faulty / corrupted program (e.g. unexpected naked throws). */
export type Defect = Failure & {
  readonly [__brand_Defect]: typeof __brand_Defect;
} & { readonly __symbolIdentity?: typeof Defect };

export const Defect: ((value: FailurePayload) => Defect) &
  ThunkSymbol<FailurePayload> = __makeSymbol<FailurePayload>("Defect", {
  parent: failureParent,
}) as unknown as ((value: FailurePayload) => Defect) &
  ThunkSymbol<FailurePayload>;

/**
 * UnhandledError — external/async failure not yet handled
 * (e.g. Promise rejection via future `wrap`).
 */
export type UnhandledError = Failure & {
  readonly [__brand_UnhandledError]: typeof __brand_UnhandledError;
} & { readonly __symbolIdentity?: typeof UnhandledError };

export const UnhandledError: ((value: FailurePayload) => UnhandledError) &
  ThunkSymbol<FailurePayload> = __makeSymbol<FailurePayload>(
  "UnhandledError",
  { parent: failureParent },
) as unknown as ((value: FailurePayload) => UnhandledError) &
  ThunkSymbol<FailurePayload>;

/**
 * Error — ordinary tagged application error.
 * Internal name avoids clashing with the platform `Error` constructor in this file.
 */
export type Error = Failure & {
  readonly [__brand_Error]: typeof __brand_Error;
} & { readonly __symbolIdentity?: typeof ErrorSymbol };

const ErrorSymbol: ((value: FailurePayload) => Error) &
  ThunkSymbol<FailurePayload> = __makeSymbol<FailurePayload>("Error", {
  parent: failureParent,
}) as unknown as ((value: FailurePayload) => Error) &
  ThunkSymbol<FailurePayload>;

export { ErrorSymbol as Error };
