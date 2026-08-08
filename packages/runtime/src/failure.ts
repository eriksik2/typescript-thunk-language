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
 * Hierarchy is identity pedigree — not value subtyping:
 * `Symbol.isAny(defect, Failure)` is true; `const f: Failure = defect` is not.
 * Brands are opaque — use `Symbol.unwrap` for the `{ message }` payload.
 *
 * Import from `@thunk/runtime`. The `Error` export shadows global `Error` when
 * imported by name — use `globalThis.Error` for the platform constructor.
 */

import type { ParentCarrier, ThunkSymbol } from "@thunk/types";
import { __makeSymbol } from "./internal";

export type FailurePayload = {
  message: string;
};

declare const __brand_Failure: unique symbol;
declare const __brand_Defect: unique symbol;
declare const __brand_UnhandledError: unique symbol;
declare const __brand_Error: unique symbol;

/** Abstract root of the failure hierarchy (opaque brand). */
export type Failure = {
  readonly [__brand_Failure]: typeof __brand_Failure;
} & { readonly __assoc: FailurePayload };

/**
 * Abstract Failure identity — not callable.
 * Still participates in `Symbol.isAny` / `Symbol.extends` / `Symbol.to`.
 */
export const Failure: {
  readonly key: symbol;
  readonly __assoc: FailurePayload;
  readonly __thunkSymbol?: "ThunkSymbol";
  readonly __abstract: true;
} = __makeSymbol<FailurePayload>("Failure", {
  abstract: true,
}) as unknown as {
  readonly key: symbol;
  readonly __assoc: FailurePayload;
  readonly __thunkSymbol?: "ThunkSymbol";
  readonly __abstract: true;
};

const failureParent = Failure as unknown as ThunkSymbol<FailurePayload>;

/** Defect — faulty / corrupted program (e.g. unexpected naked throws). */
export type Defect = {
  readonly [__brand_Defect]: typeof __brand_Defect;
} & { readonly __assoc: FailurePayload } & {
  readonly __symbolIdentity?: typeof Defect;
};

export const Defect: ((value: FailurePayload) => Defect) &
  ThunkSymbol<FailurePayload> &
  ParentCarrier<typeof Failure> = __makeSymbol<FailurePayload>("Defect", {
  parent: failureParent,
}) as unknown as ((value: FailurePayload) => Defect) &
  ThunkSymbol<FailurePayload> &
  ParentCarrier<typeof Failure>;

/**
 * UnhandledError — external/async failure not yet handled
 * (e.g. `wrap` rejection).
 */
export type UnhandledError = {
  readonly [__brand_UnhandledError]: typeof __brand_UnhandledError;
} & { readonly __assoc: FailurePayload } & {
  readonly __symbolIdentity?: typeof UnhandledError;
};

export const UnhandledError: ((value: FailurePayload) => UnhandledError) &
  ThunkSymbol<FailurePayload> &
  ParentCarrier<typeof Failure> = __makeSymbol<FailurePayload>(
  "UnhandledError",
  {
    parent: failureParent,
  },
) as unknown as ((value: FailurePayload) => UnhandledError) &
  ThunkSymbol<FailurePayload> &
  ParentCarrier<typeof Failure>;

/**
 * Error — ordinary tagged application failure.
 * Shadows `globalThis.Error` when imported by name.
 */
export type Error = {
  readonly [__brand_Error]: typeof __brand_Error;
} & { readonly __assoc: FailurePayload } & {
  readonly __symbolIdentity?: typeof Error;
};

const ErrorSymbol: ((value: FailurePayload) => Error) &
  ThunkSymbol<FailurePayload> &
  ParentCarrier<typeof Failure> = __makeSymbol<FailurePayload>("Error", {
  parent: failureParent,
}) as unknown as ((value: FailurePayload) => Error) &
  ThunkSymbol<FailurePayload> &
  ParentCarrier<typeof Failure>;

export { ErrorSymbol as Error };
