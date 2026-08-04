/**
 * Built-in Result symbols: `Ok<A>` / `Err<E>`.
 *
 * ```
 * type Result<A, E> = Ok<A> | Err<E>
 * ```
 *
 * Match with exact leaf arms (see language-reference/core/match.md).
 */

import { __makeSymbol } from "./internal";

declare const __brand_Ok: unique symbol;
declare const __brand_Err: unique symbol;

export type Ok<A> = A & {
  readonly [__brand_Ok]: typeof __brand_Ok;
} & { readonly __assoc: A } & {
  readonly __symbolIdentity?: typeof Ok;
};

export const Ok: {
  <A>(value: A): Ok<A>;
  readonly key: symbol;
  readonly __assoc: any;
  readonly __thunkSymbol?: "ThunkSymbol";
} = __makeSymbol<any>("Ok") as unknown as {
  <A>(value: A): Ok<A>;
  readonly key: symbol;
  readonly __assoc: any;
  readonly __thunkSymbol?: "ThunkSymbol";
};

export type Err<E> = E & {
  readonly [__brand_Err]: typeof __brand_Err;
} & { readonly __assoc: E } & {
  readonly __symbolIdentity?: typeof Err;
};

export const Err: {
  <E>(value: E): Err<E>;
  readonly key: symbol;
  readonly __assoc: any;
  readonly __thunkSymbol?: "ThunkSymbol";
} = __makeSymbol<any>("Err") as unknown as {
  <E>(value: E): Err<E>;
  readonly key: symbol;
  readonly __assoc: any;
  readonly __thunkSymbol?: "ThunkSymbol";
};

export type Result<A, E> = Ok<A> | Err<E>;
