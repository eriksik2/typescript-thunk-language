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
 * Used as a key in `ProtocolBag` (not a runtime symbol value).
 */
export declare const Requires: unique symbol;
export type Requires = typeof Requires;

/**
 * Identity of the built-in `Async` protocol (flag).
 * Present when a thunk may wait on the event loop (`wrap` / Promise).
 * Changes `execute`’s result to `Promise<T>`; not discharged by `provide`.
 */
export declare const Async: unique symbol;
export type Async = typeof Async;

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

/**
 * Symbol identity typed by associated payload `T`
 * (`typeof Age` displays conceptually as `symbol T`).
 *
 * `__thunkSymbol` is a string phantom (not `unique symbol`) so lowered
 * const casts remain assignable across declaration sites.
 */
export type ThunkSymbol<T> = {
  readonly __thunkSymbol?: "ThunkSymbol";
  readonly __assoc: T;
  readonly key: symbol;
};

/**
 * Extract associated type `T` from a symbol identity (`typeof Name`)
 * or a branded inhabitant that carries `__assoc`.
 */
export type SymbolType<S> = S extends { readonly __assoc: infer T } ? T : never;

/**
 * Phantom intersected onto branded types so `SymbolType<Name>` works.
 * Type-level only — not present at runtime.
 */
export type BrandCarrier<T> = {
  readonly __assoc: T;
};

/**
 * Phantom linking a branded inhabitant back to its symbol identity
 * (`typeof Database`). Used by `Symbol.of` / `provide(thunk, branded)`.
 */
export type IdentityCarrier<S> = {
  readonly __symbolIdentity?: S;
};

/**
 * Recover symbol identity type from a branded inhabitant.
 */
export type SymbolOfValue<V> = V extends IdentityCarrier<infer S>
  ? [S] extends [undefined]
    ? never
    : S
  : never;

/**
 * Nominal brand over associated type `T`, keyed by a unique brand key.
 * Emitted by the lowerer for each `symbol` declaration.
 */
export type Branded<T, Brand extends PropertyKey, S = unknown> = T & {
  readonly [K in Brand]: Brand;
} & BrandCarrier<T> &
  IdentityCarrier<S>;

/** Bag containing only a `Requires` entry (keys are symbol identities). */
export type WithRequires<Tags> = ProtocolBag<{ readonly [Requires]: Tags }>;

/** Bag containing only the `Async` flag protocol. */
export type WithAsync = ProtocolBag<{ readonly [Async]: void }>;

/** Payload of `Requires` in `P`, or `never` when absent (identity). */
export type GetRequires<P extends ProtocolBag> = P extends {
  readonly [Requires]: infer R;
}
  ? R
  : never;

/**
 * `true` if `P` (or any constituent of a union `P`) carries `Async`.
 * Distributes so machine step unions keep Async when any path has it.
 */
export type HasAsync<P> = true extends (
  P extends any ? (Async extends keyof P ? true : false) : never
)
  ? true
  : false;

/**
 * `Requires.bind<A, B>` — sequential composition unions requirement payloads.
 */
export type RequiresBind<A, B> = A | B;

/**
 * Collapse bags with no keys to `EmptyProtocols` so TS does not display
 * `Omit<EmptyProtocols, typeof Requires>` after pure `bind` merges.
 */
type SimplifyEmpty<P> = keyof P extends never ? EmptyProtocols : P;

/**
 * Merge two protocol bags.
 * `Requires` payloads use `RequiresBind` (union); absent side is `never`.
 * Other keys (e.g. `Async`) are intersected via `Omit` + `&`.
 */
export type MergeProtocols<
  A extends ProtocolBag,
  B extends ProtocolBag,
> = [RequiresBind<GetRequires<A>, GetRequires<B>>] extends [never]
  ? SimplifyEmpty<Omit<A, Requires> & Omit<B, Requires>>
  : SimplifyEmpty<Omit<A, Requires> & Omit<B, Requires>> & {
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
 * Result of `execute`:
 * - requirements remain → `CompileError`
 * - `Async` present → `Promise<T>`
 * - otherwise → `T`
 */
export type ExecuteResult<T, P extends ProtocolBag> = [
  GetRequires<P>,
] extends [never]
  ? HasAsync<P> extends true
    ? Promise<T>
    : T
  : CompileError<"Unsatisfied requirements">;

/** @deprecated Prefer `ThunkReturnType` — name clashes with lib `ReturnType`. */
export type ReturnType<T extends Thunk<any, any>> = ThunkReturnType<T>;

/**
 * Remove provided requirement tags from a bag (`provide`).
 * `S` is the union of symbol identity types supplied by a Layer.
 */
export type ProvideRequires<
  P extends ProtocolBag,
  S,
> = [GetRequires<P>] extends [never]
  ? P
  : [Exclude<GetRequires<P>, S>] extends [never]
    ? SimplifyEmpty<Omit<P, Requires>>
    : SimplifyEmpty<Omit<P, Requires>> & {
        readonly [Requires]: Exclude<GetRequires<P>, S>;
      };

/**
 * @deprecated Prefer `ThunkSymbol`. Kept as a thin alias during migration.
 */
export type Tag<Service = unknown> = ThunkSymbol<Service>;

/** @deprecated Prefer `SymbolType`. */
export type InferTag<T> = SymbolType<T>;
