/**
 * Type-level encoding of Thunk + protocol bags for the TypeScript host checker.
 *
 * Surface syntax (postfix protocols) is pretty-printed by the language service.
 * This file is what lowered / virtual documents import.
 */

/** Empty protocol bag. */
export type EmptyProtocols = {};

/**
 * Brand carrier for protocol payloads.
 * Keys are protocol identities; values are payloads.
 */
export type ProtocolBag<P extends Record<PropertyKey, unknown> = EmptyProtocols> =
  P;

/**
 * Thunk return type + protocol bag.
 * Second type parameter defaults so pure thunks stay `Thunk<T>`.
 */
export type Thunk<
  T,
  P extends ProtocolBag = EmptyProtocols,
> = {
  readonly __thunk: unique symbol;
  readonly yield: T;
  readonly protocols: P;
};

export type ReturnType<T extends Thunk<any, any>> = T extends Thunk<
  infer R,
  any
>
  ? R
  : never;

export type Protocol<T extends Thunk<any, any>> = T extends Thunk<
  any,
  infer P
>
  ? P
  : never;

export type Strip<T extends Thunk<any, any>> = Thunk<ReturnType<T>>;

export type OmitProtocol<
  P extends ProtocolBag,
  K extends keyof P,
> = Omit<P, K>;

/** Marker used by Requires.execute when requirements remain. */
export type CompileError<Message extends string> = {
  readonly __compileError: Message;
};
