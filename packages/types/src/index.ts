/**
 * Type-level encoding of Thunk + protocol bags for the TypeScript host checker.
 *
 * Surface postfix syntax (`Thunk<T> Requires(A)`) is pretty-printed by the
 * language service from this encoding. Runtime nodes are cast to `Thunk` at
 * the API boundary — this package stays runtime-free.
 */

/** Empty protocol bag (pure thunks). */
export type EmptyProtocols = {};

/**
 * Brand carrier for protocol payloads.
 * Keys are protocol identities; values are payloads.
 */
export type ProtocolBag<P extends Record<PropertyKey, unknown> = EmptyProtocols> =
  P;

/**
 * Identity of the built-in `Requires` protocol.
 * Used as a key in `ProtocolBag` (not a runtime Tag).
 */
export declare const Requires: unique symbol;
export type Requires = typeof Requires;

/**
 * Thunk yield type + protocol bag.
 * Second parameter defaults so pure thunks display as `Thunk<T>`.
 *
 * Opaque brand: runtime values are tagged nodes cast to this type.
 */
export type Thunk<T, P extends ProtocolBag = EmptyProtocols> = {
  readonly __thunkBrand: unique symbol;
  readonly __yield: T;
  readonly __protocols: P;
};

/** Bag containing only a `Requires` entry. */
export type WithRequires<Tags> = ProtocolBag<{ readonly [Requires]: Tags }>;

/** Payload of `Requires` in `P`, or `never` when absent (identity). */
export type GetRequires<P extends ProtocolBag> = P extends {
  readonly [Requires]: infer R;
}
  ? R
  : never;

/**
 * `Requires.bind<A, B>` — sequential composition unions requirement payloads.
 */
export type RequiresBind<A, B> = A | B;

/**
 * Merge two protocol bags.
 * `Requires` payloads use `RequiresBind` (union); absent side is `never`.
 * Other keys are intersected via `Omit` + `&` (v0: no other protocols yet).
 */
export type MergeProtocols<
  A extends ProtocolBag,
  B extends ProtocolBag,
> = [RequiresBind<GetRequires<A>, GetRequires<B>>] extends [never]
  ? Omit<A, Requires> & Omit<B, Requires>
  : Omit<A, Requires> &
      Omit<B, Requires> & {
        readonly [Requires]: RequiresBind<GetRequires<A>, GetRequires<B>>;
      };

/** Extract yield type from a thunk. */
export type ThunkReturnType<T extends Thunk<any, any>> = T extends Thunk<
  infer R,
  any
>
  ? R
  : never;

/** Extract protocol bag from a thunk. */
export type Protocol<T extends Thunk<any, any>> = T extends Thunk<any, infer P>
  ? P
  : never;

/** Drop all protocols; keep yield type. */
export type Strip<T extends Thunk<any, any>> = Thunk<ThunkReturnType<T>>;

/** Remove one protocol entry from a bag. */
export type OmitProtocol<
  P extends ProtocolBag,
  K extends keyof P,
> = Omit<P, K>;

/** Marker used when `execute` is invalid (requirements remain). */
export type CompileError<Message extends string> = {
  readonly __compileError: Message;
};

/**
 * Result of `execute`: yield type if no requirements remain, else `CompileError`.
 */
export type ExecuteResult<T, P extends ProtocolBag> = [
  GetRequires<P>,
] extends [never]
  ? T
  : CompileError<"Unsatisfied requirements">;

/** @deprecated Prefer `ThunkReturnType` — name clashes with lib `ReturnType`. */
export type ReturnType<T extends Thunk<any, any>> = ThunkReturnType<T>;
