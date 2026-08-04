/**
 * Compiler / lowerer internals — not part of the author-facing surface.
 * Import from `@thunk/runtime/internal` only in generated output.
 */

import type {
  EmptyProtocols,
  ExecuteResult,
  IdentityCarrier,
  MergeProtocols,
  ProtocolBag,
  ProvideRequires,
  SymbolOfValue,
  SymbolType,
  Thunk,
  ThunkSymbol,
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
  readonly sym: ThunkSymbol<T>;
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

/**
 * Runtime helper used by the lowerer for `symbol` declarations.
 * Returns a callable brand intro that carries `.key` for env maps.
 * Branding stamps the identity onto object values so `Symbol.of` / `provide` work.
 */
export function __makeSymbol<T>(
  name: string,
): ((value: T) => T) & ThunkSymbol<T> {
  const key = globalThis.Symbol(name);
  const identity = ((value: T) =>
    stampIdentity(value, identity)) as ((value: T) => T) & ThunkSymbol<T>;
  Object.defineProperty(identity, "key", {
    value: key,
    enumerable: true,
    configurable: false,
    writable: false,
  });
  return identity;
}

/** Well-known property + WeakMap so branded objects remember their identity. */
const IDENTITY_PROP = globalThis.Symbol.for("@thunk/runtime.symbolIdentity");
const identityByRef = new WeakMap<object, ThunkSymbol<any>>();

function stampIdentity<T>(value: T, identity: ThunkSymbol<any>): T {
  if (typeof value === "object" && value !== null) {
    identityByRef.set(value as object, identity);
    try {
      Object.defineProperty(value, IDENTITY_PROP, {
        value: identity,
        enumerable: false,
        configurable: true,
        writable: false,
      });
    } catch {
      // frozen / sealed — WeakMap is enough
    }
  }
  // Primitives stay naked so `Age` → `number` assignability holds;
  // `Symbol.of` / branded `provide` require object inhabitants.
  return value;
}

function readIdentity(value: unknown): ThunkSymbol<any> | undefined {
  if (typeof value === "object" && value !== null) {
    const fromMap = identityByRef.get(value);
    if (fromMap) return fromMap;
    const fromProp = (value as Record<symbol, unknown>)[IDENTITY_PROP];
    if (fromProp && typeof fromProp === "object") {
      return fromProp as ThunkSymbol<any>;
    }
  }
  return undefined;
}

/**
 * Recover the symbol identity from a branded inhabitant
 * (`Symbol.of(DatabaseLive)` → `Database`).
 */
export function symbolOf<V>(value: V): SymbolOfValue<V> {
  const id = readIdentity(value);
  if (!id) {
    throw new Error(
      "Symbol.of: value is not a branded symbol inhabitant (object values branded via Name(...) carry identity; use layerOf for primitives)",
    );
  }
  return id as SymbolOfValue<V>;
}

/** Namespace alias: `Symbol.of(value)`. */
export const Symbol = {
  of: symbolOf,
} as const;

/**
 * @deprecated Prefer `symbol` declarations (lowered via `__makeSymbol`).
 * Low-level escape hatch kept for migration.
 */
export function createTag<Service>(
  description?: string,
): ((value: Service) => Service) & ThunkSymbol<Service> {
  return __makeSymbol<Service>(description ?? "Tag");
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
    continuation: (value) => asNode(continuation(value as A)),
  });
}

/**
 * Read a service from the current environment.
 * Introduces `Requires(sym)` on the thunk type (symbol identity).
 */
export function use<S extends ThunkSymbol<any>>(
  sym: S,
): Thunk<SymbolType<S>, WithRequires<S>> {
  return asThunk({
    kind: "use",
    sym: sym as ThunkSymbol<SymbolType<S>>,
  });
}

/** Environment fragment providing one or more symbol identities. */
export type Layer<S extends ThunkSymbol<any> = ThunkSymbol<any>> = {
  readonly entries: ReadonlyMap<symbol, unknown>;
  readonly __tags?: S;
};

/** Build a layer from a single symbol implementation. */
export function layerOf<S extends ThunkSymbol<any>>(
  sym: S,
  implementation: SymbolType<S>,
): Layer<S> {
  return {
    entries: new Map([[sym.key, implementation]]),
  };
}

/** Merge layers (later entries win). */
export function mergeLayers<
  A extends ThunkSymbol<any>,
  B extends ThunkSymbol<any>,
>(a: Layer<A>, b: Layer<B>): Layer<A | B> {
  const entries = new Map(a.entries);
  for (const [k, v] of b.entries) entries.set(k, v);
  return { entries };
}

/**
 * Provide a layer for the duration of `thunk`.
 * Removes provided symbol identities from the `Requires` payload.
 *
 * Overloads:
 * - `provide(thunk, layerOf(Database, impl))`
 * - `provide(thunk, Database(impl))` — branded object; identity via `Symbol.of`
 */
export function provide<T, P extends ProtocolBag, S extends ThunkSymbol<any>>(
  thunk: Thunk<T, P>,
  layer: Layer<S>,
): Thunk<T, ProvideRequires<P, S>>;
export function provide<
  T,
  P extends ProtocolBag,
  V extends IdentityCarrier<any>,
>(
  thunk: Thunk<T, P>,
  branded: V,
): Thunk<T, ProvideRequires<P, SymbolOfValue<V>>>;
export function provide<T, P extends ProtocolBag>(
  thunk: Thunk<T, P>,
  layerOrBranded: Layer<any> | IdentityCarrier<any>,
): Thunk<T, any> {
  const layer = isLayer(layerOrBranded)
    ? layerOrBranded
    : layerOf(symbolOf(layerOrBranded), layerOrBranded as any);
  return asThunk({
    kind: "provide",
    inner: asNode(thunk),
    layer,
  });
}

function isLayer(value: unknown): value is Layer<any> {
  return (
    typeof value === "object" &&
    value !== null &&
    "entries" in value &&
    (value as Layer).entries instanceof Map
  );
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
      if (!env.has(thunk.sym.key)) {
        throw new Error(
          `No implementation in environment for symbol ${String(thunk.sym.key.description ?? "symbol")}`,
        );
      }
      return env.get(thunk.sym.key) as T;
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
  ThunkSymbol,
  SymbolType,
  SymbolOfValue,
  IdentityCarrier,
  WithRequires,
  ProvideRequires,
};
