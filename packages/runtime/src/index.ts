/**
 * Semantic primitives for Thunk + environment (`use` / `provide` / `Layer`).
 */

import type {
  EmptyProtocols,
  ExecuteResult,
  InferTag,
  MergeProtocols,
  ProtocolBag,
  ProvideRequires,
  Tag,
  Thunk,
  WithRequires,
} from "@thunk/types";

export type Environment = Map<symbol, unknown>;

type ThunkNode<T> =
  | SucceedNode<T>
  | DeferNode<T>
  | BindNode<unknown, T>
  | UseNode<T>
  | ProvideNode<T>;

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

interface UseNode<T> {
  readonly kind: "use";
  readonly tag: Tag<T>;
}

interface ProvideNode<T> {
  readonly kind: "provide";
  readonly inner: ThunkNode<T>;
  readonly layer: Layer<any>;
}

function asThunk<T, P extends ProtocolBag = EmptyProtocols>(
  node: ThunkNode<T>,
): Thunk<T, P> {
  return node as unknown as Thunk<T, P>;
}

function asNode<T>(thunk: Thunk<T, any>): ThunkNode<T> {
  return thunk as unknown as ThunkNode<T>;
}

/** Create a unique service tag. */
export function createTag<Service>(description?: string): Tag<Service> {
  return { key: Symbol(description ?? "Tag") };
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
 * Read a service from the current environment.
 * Introduces `Requires(tag)` on the thunk type.
 */
export function use<T extends Tag<any>>(
  tag: T,
): Thunk<InferTag<T>, WithRequires<T>> {
  return asThunk({ kind: "use", tag: tag as Tag<InferTag<T>> });
}

/** Environment fragment providing one or more tags. */
export type Layer<S extends Tag<any> = Tag<any>> = {
  readonly entries: ReadonlyMap<symbol, unknown>;
  readonly __tags?: S;
};

/** Build a layer from a single tag implementation. */
export function layerOf<T extends Tag<any>>(
  tag: T,
  implementation: InferTag<T>,
): Layer<T> {
  return {
    entries: new Map([[tag.key, implementation]]),
  };
}

/** Merge layers (later entries win). */
export function mergeLayers<A extends Tag<any>, B extends Tag<any>>(
  a: Layer<A>,
  b: Layer<B>,
): Layer<A | B> {
  const entries = new Map(a.entries);
  for (const [k, v] of b.entries) entries.set(k, v);
  return { entries };
}

/**
 * Provide a layer for the duration of `thunk`.
 * Removes provided tags from the `Requires` payload.
 */
export function provide<T, P extends ProtocolBag, S extends Tag<any>>(
  thunk: Thunk<T, P>,
  layer: Layer<S>,
): Thunk<T, ProvideRequires<P, S>> {
  return asThunk({
    kind: "provide",
    inner: asNode(thunk),
    layer,
  });
}

/**
 * Run a thunk to a value.
 * Type-level: fails with `CompileError` when `Requires` remain.
 */
export function execute<T, P extends ProtocolBag>(
  thunk: Thunk<T, P>,
  env: Environment = new Map(),
): ExecuteResult<T, P> {
  return executeNode(asNode(thunk), env) as ExecuteResult<T, P>;
}

function executeNode<T>(thunk: ThunkNode<T>, env: Environment): T {
  switch (thunk.kind) {
    case "succeed":
      return thunk.value;
    case "defer":
      return executeNode(thunk.factory(), env);
    case "bind": {
      const value = executeNode(thunk.source, env);
      return executeNode(thunk.continuation(value), env);
    }
    case "use": {
      if (!env.has(thunk.tag.key)) {
        throw new Error(
          `No implementation in environment for tag ${String(thunk.tag.key.description ?? "Tag")}`,
        );
      }
      return env.get(thunk.tag.key) as T;
    }
    case "provide": {
      const child: Environment = new Map(env);
      for (const [k, v] of thunk.layer.entries) {
        child.set(k, v);
      }
      return executeNode(thunk.inner, child);
    }
  }
}

export type {
  Thunk,
  EmptyProtocols,
  ProtocolBag,
  MergeProtocols,
  ExecuteResult,
  Tag,
  InferTag,
  WithRequires,
  ProvideRequires,
};
