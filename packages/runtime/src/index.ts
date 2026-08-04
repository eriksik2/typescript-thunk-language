/**
 * Semantic primitives for Thunk.
 *
 * Runtime representation: tagged nodes (recursive executor).
 * Public types: `Thunk<T, P>` from `@thunk/types` (phantom protocols).
 */

import type {
  EmptyProtocols,
  ExecuteResult,
  MergeProtocols,
  ProtocolBag,
  Thunk,
} from "@thunk/types";

type ThunkNode<T> =
  | SucceedNode<T>
  | DeferNode<T>
  | BindNode<unknown, T>;

interface SucceedNode<T> {
  readonly kind: "succeed";
  readonly value: T;
}

interface DeferNode<T> {
  readonly kind: "defer";
  readonly factory: () => ThunkNode<T>;
}

interface BindNode<A, B> {
  readonly kind: "bind";
  readonly source: ThunkNode<A>;
  readonly continuation: (value: A) => ThunkNode<B>;
}

function asThunk<T, P extends ProtocolBag = EmptyProtocols>(
  node: ThunkNode<T>,
): Thunk<T, P> {
  return node as unknown as Thunk<T, P>;
}

function asNode<T>(thunk: Thunk<T, any>): ThunkNode<T> {
  return thunk as unknown as ThunkNode<T>;
}

/** Completed thunk — empty protocol bag. */
export function succeed<T>(value: T): Thunk<T, EmptyProtocols> {
  return asThunk({ kind: "succeed", value });
}

/** Defer construction until execute — preserves protocols from the factory. */
export function defer<T, P extends ProtocolBag = EmptyProtocols>(
  factory: () => Thunk<T, P>,
): Thunk<T, P> {
  return asThunk({
    kind: "defer",
    factory: () => asNode(factory()),
  });
}

/**
 * Sequence thunks; merge protocol bags (`Requires` via union).
 */
export function bind<
  A,
  PA extends ProtocolBag,
  B,
  PB extends ProtocolBag,
>(
  source: Thunk<A, PA>,
  continuation: (value: A) => Thunk<B, PB>,
): Thunk<B, MergeProtocols<PA, PB>> {
  return asThunk({
    kind: "bind",
    source: asNode(source),
    continuation: (value) => asNode(continuation(value)),
  });
}

/**
 * Run a thunk to a value.
 * Type-level: fails with `CompileError` when `Requires` remain.
 */
export function execute<T, P extends ProtocolBag>(
  thunk: Thunk<T, P>,
): ExecuteResult<T, P> {
  return executeNode(asNode(thunk)) as ExecuteResult<T, P>;
}

function executeNode<T>(thunk: ThunkNode<T>): T {
  switch (thunk.kind) {
    case "succeed":
      return thunk.value;
    case "defer":
      return executeNode(thunk.factory());
    case "bind": {
      const value = executeNode(thunk.source);
      return executeNode(thunk.continuation(value));
    }
  }
}

export type { Thunk, EmptyProtocols, ProtocolBag, MergeProtocols, ExecuteResult };
