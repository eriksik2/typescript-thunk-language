/**
 * Compiler / lowerer internals — not part of the author-facing surface.
 * Import from `@thunk/runtime/internal` only in generated output.
 */

import type {
  BrandCarrier,
  EmptyProtocols,
  ExecuteResult,
  GetRequires,
  HasAsync,
  IdentityCarrier,
  MergeProtocols,
  Protocol,
  ProtocolBag,
  ProvideRequires,
  Requires,
  Async,
  SymbolHasValue,
  SymbolOfValue,
  SymbolType,
  Thunk,
  ThunkReturnType,
  ThunkSymbol,
  WithAsync,
  WithRequires,
} from "@thunk/types";

export type Environment = Map<symbol, unknown>;

type ThunkNode<T> =
  | SucceedNode<T>
  | DeferNode<T>
  | BindNode<unknown, T>
  | RunEffectNode<unknown>
  | MachineNode<T>
  | UseNode<T>
  | ProvideNode<T>
  | AwaitPromiseNode<T>;

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

/** Suspend a machine: run `source`, then resume the step with its value. */
interface RunEffectNode<A> {
  readonly kind: "runEffect";
  readonly source: ThunkNode<A>;
}

/**
 * Iterative state machine. `step` returns `succeed` (done) or `runEffect`
 * (suspend). Branches/loops are ordinary `switch` + `continue` inside step.
 */
interface MachineNode<T> {
  readonly kind: "machine";
  readonly step: (resume: unknown) => ThunkNode<T>;
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

/** Promise bridge — introduced by `wrap`. */
interface AwaitPromiseNode<T> {
  readonly kind: "awaitPromise";
  readonly factory: () => Promise<T>;
  /** Throws (typically `UnhandledError`) — typed as `never`. */
  readonly onReject: (reason: unknown) => never;
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
 * Options for `__makeSymbol` (hierarchical / abstract symbols).
 */
export type MakeSymbolOptions = {
  /** Not callable — cannot brand values. Still usable with `Symbol.isAny`. */
  readonly abstract?: boolean;
  /** Parent identity for hierarchy (`Symbol.isAny` / `Symbol.extends` / `Symbol.to`). */
  readonly parent?: { readonly key: symbol };
};

/** Runtime parent links for hierarchical symbols. */
const parentByIdentity = new WeakMap<ThunkSymbol<any>, ThunkSymbol<any>>();

/**
 * Runtime helper used by the lowerer for `symbol` declarations.
 * Returns a callable brand intro that carries `.key` for env maps.
 * Branding stamps the identity onto object values so `Symbol.of` / `provide` work.
 *
 * Abstract symbols return a non-callable identity (still has `.key` / parent link).
 * Hierarchy typing (`__parent`) is applied by the lowerer cast / author casts.
 */
export function __makeSymbol<T>(
  name: string,
  options?: MakeSymbolOptions,
): ((value: T) => T) & ThunkSymbol<T> {
  const key = globalThis.Symbol(name);

  let identity: ((value: T) => T) & ThunkSymbol<T>;

  if (options?.abstract) {
    const abstractIdentity = ((..._args: unknown[]) => {
      throw new Error(
        `Cannot brand with abstract symbol ${name}`,
      );
    }) as ((value: T) => T) & ThunkSymbol<T>;
    identity = abstractIdentity;
    Object.defineProperty(identity, "__abstract", {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  } else {
    identity = ((value: T) =>
      stampIdentity(value, identity)) as ((value: T) => T) & ThunkSymbol<T>;
  }

  Object.defineProperty(identity, "key", {
    value: key,
    enumerable: true,
    configurable: false,
    writable: false,
  });

  if (options?.parent) {
    parentByIdentity.set(
      identity,
      options.parent as ThunkSymbol<any>,
    );
    Object.defineProperty(identity, "__parent", {
      value: options.parent,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }

  return identity;
}

/** Well-known property + WeakMap so branded objects remember their identity. */
const IDENTITY_PROP = globalThis.Symbol.for("@thunk/runtime.symbolIdentity");
/** Payload slot for boxed primitives (and null/undefined). */
const PAYLOAD_PROP = globalThis.Symbol.for("@thunk/runtime.symbolPayload");
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
    return value;
  }

  if (typeof value === "function") {
    identityByRef.set(value as object, identity);
    try {
      Object.defineProperty(value, IDENTITY_PROP, {
        value: identity,
        enumerable: false,
        configurable: true,
        writable: false,
      });
    } catch {
      // ignore
    }
    return value;
  }

  // Primitives / null / undefined: box so Symbol.is / match retain identity.
  // Type stays `T & Brand`; runtime is a stamped wrapper (Object(primitive)
  // for number/string/boolean so valueOf coercion still works).
  const box =
    value === null || value === undefined
      ? ({ [PAYLOAD_PROP]: value } as object)
      : Object(value);
  identityByRef.set(box, identity);
  try {
    Object.defineProperty(box, IDENTITY_PROP, {
      value: identity,
      enumerable: false,
      configurable: true,
      writable: false,
    });
    Object.defineProperty(box, PAYLOAD_PROP, {
      value,
      enumerable: false,
      configurable: true,
      writable: false,
    });
  } catch {
    // ignore
  }
  return box as T;
}

/**
 * Associated payload for match / `is` bindings and `Symbol.unwrap`.
 * Object brands: the value itself (fields still present). Boxed primitives:
 * the original payload. Return type is `SymbolType<T>` so opaque brands
 * typecheck without `as unknown` at call sites.
 */
export function __symbolPayload<T>(value: T): SymbolType<T> {
  if (typeof value === "object" && value !== null) {
    const payload = (value as Record<symbol, unknown>)[PAYLOAD_PROP];
    if (payload !== undefined || PAYLOAD_PROP in (value as object)) {
      return payload as SymbolType<T>;
    }
  }
  return value as SymbolType<T>;
}

/** Exhaustiveness witness for `match` — remainder must be `never`. */
export function __exhaustive(_value: never): never {
  throw new Error("non-exhaustive match");
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
  if (typeof value === "function") {
    const fromMap = identityByRef.get(value);
    if (fromMap) return fromMap;
  }
  return undefined;
}

function isAncestorOrSelf(
  leaf: ThunkSymbol<any>,
  target: ThunkSymbol<any>,
): boolean {
  let cur: ThunkSymbol<any> | undefined = leaf;
  while (cur) {
    if (cur === target) return true;
    cur = parentByIdentity.get(cur);
  }
  return false;
}

/**
 * Recover the symbol identity from a branded inhabitant
 * (`Symbol.of(DatabaseLive)` → `Database`).
 * Returns the **most specific** (leaf) identity.
 */
export function symbolOf<V>(value: V): SymbolOfValue<V> {
  const id = readIdentity(value);
  if (!id) {
    throw new Error(
      "Symbol.of: value is not a branded symbol inhabitant (brand with Name(...))",
    );
  }
  return id as SymbolOfValue<V>;
}

/**
 * Exact identity test: true only when `Symbol.of(value) === sym`.
 * Type predicate narrows to the leaf branded with `sym` (for `match` exhaustiveness).
 */
export function symbolIs<V, S extends ThunkSymbol<any>>(
  value: V,
  sym: S,
): value is Extract<V, { readonly __symbolIdentity?: S }> {
  const id = readIdentity(value);
  return id === sym;
}

/**
 * Hierarchy / pedigree test: true when the leaf identity is `sym` or extends it.
 * Type predicate narrows like TS `typeof` (else excludes matching arms).
 */
export function symbolIsAny<V, S extends ThunkSymbol<any>>(
  value: V,
  sym: S,
): value is SymbolHasValue<V, S> {
  const id = readIdentity(value);
  if (!id) return false;
  return isAncestorOrSelf(id, sym);
}

/**
 * Assert a value is outside `sym`'s pedigree (after an `is any` early-return).
 * Needed because state-machine lowering splits branches across `switch` cases,
 * where TypeScript cannot keep control-flow narrowing.
 */
export function __excludeIsAny<V, S extends ThunkSymbol<any>>(
  value: V,
  _sym: S,
): Exclude<V, SymbolHasValue<V, S>> {
  return value as Exclude<V, SymbolHasValue<V, S>>;
}

/** @deprecated Use `symbolIsAny`. */
export const symbolHas = symbolIsAny;

/**
 * True when `child` identity is `parent` or extends it (declaration hierarchy).
 */
export function symbolExtends(
  child: ThunkSymbol<any>,
  parent: ThunkSymbol<any>,
): boolean {
  return isAncestorOrSelf(child, parent);
}

/**
 * Checked upcast along the symbol hierarchy.
 * Runtime: requires `Symbol.isAny(value, sym)`; otherwise calls `onFail` (typically `Defect`).
 * Does not re-stamp — `Symbol.of` stays the leaf identity.
 */
export function symbolTo<V, S extends ThunkSymbol<any>>(
  value: V,
  sym: S,
  onFail: (message: string) => never,
): SymbolType<S> & BrandCarrier<SymbolType<S>> {
  if (!symbolIsAny(value, sym)) {
    const name =
      typeof sym.key.description === "string" ? sym.key.description : "symbol";
    onFail(`Symbol.to: value is not in the hierarchy of ${name}`);
  }
  return value as SymbolType<S> & BrandCarrier<SymbolType<S>>;
}

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
 * Kept for hand-written runtime use; the lowerer emits `machine` / `runEffect`.
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
 * Suspend a state-machine step: not a `Thunk`, so return-type inference does
 * not collapse into `Thunk<T, EmptyProtocols>` (empty bags are `{}` and would
 * otherwise absorb `Requires` via assignability).
 */
export type Suspend<A, P extends ProtocolBag = EmptyProtocols> = {
  readonly __suspendBrand: unique symbol;
  readonly __resumeType: A;
  readonly __protocols: P;
};

type StepResult = Thunk<any, any> | Suspend<any, any>;

type YieldOfStep<R> = R extends Suspend<any, any>
  ? never
  : R extends Thunk<infer T, any>
    ? T
    : never;

type ProtocolsOfStep<R> =
  | (R extends Suspend<any, infer P> ? P : never)
  | (R extends Thunk<any, infer P> ? P : never);

/**
 * Collapse a union of protocol bags (from machine step return paths).
 * Keep `Requires` (union) and `Async` if any path carries it.
 */
type CollapseProtocolUnion<P extends ProtocolBag> = SimplifyEmptyBag<
  ([GetRequires<P>] extends [never]
    ? EmptyProtocols
    : { readonly [Requires]: GetRequires<P> }) &
    (HasAsync<P> extends true ? { readonly [Async]: void } : EmptyProtocols)
>;

type SimplifyEmptyBag<P> = keyof P extends never ? EmptyProtocols : P;

/**
 * Suspend the current state machine: execute `source`, then resume `step`
 * with its yield value.
 */
export function runEffect<A, PA extends ProtocolBag>(
  source: Thunk<A, PA>,
): Suspend<A, PA> {
  return {
    kind: "runEffect",
    source: asNode(source),
  } as unknown as Suspend<A, PA>;
}

/**
 * Iterative state-machine thunk. `step(resume)` returns `succeed` or
 * `runEffect`. Protocol bags from all return paths are collapsed.
 */
export function machine<R extends StepResult>(
  step: (resume?: any) => R,
): Thunk<YieldOfStep<R>, CollapseProtocolUnion<ProtocolsOfStep<R>>> {
  return asThunk({
    kind: "machine",
    step: (resume) => asNode(step(resume) as unknown as Thunk<any, any>),
  });
}

/**
 * Internal: Promise → thunk node with `Async`. Used by author-facing `wrap`.
 */
export function __awaitPromise<T>(
  factory: () => Promise<T>,
  onReject: (reason: unknown) => never,
): Thunk<T, WithAsync> {
  return asThunk({
    kind: "awaitPromise",
    factory,
    onReject,
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
 * Run a thunk to completion.
 * Type-level: `CompileError` when `Requires` remain; `Promise<T>` when `Async`.
 * Runtime: returns `T` synchronously when no Promise suspension occurs;
 * returns a `Promise` once an `awaitPromise` / thenable path is taken.
 */
export function execute<T, P extends ProtocolBag>(
  thunk: Thunk<T, P>,
  env: Environment = new Map(),
): ExecuteResult<T, P> {
  return executeNode(asNode(thunk), env) as ExecuteResult<T, P>;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

function executeNode<T>(
  thunk: ThunkNode<T>,
  env: Environment,
): T | Promise<T> {
  let current: ThunkNode<any> = thunk;
  for (;;) {
    switch (current.kind) {
      case "succeed":
        return current.value as T;
      case "defer":
        current = current.factory();
        continue;
      case "awaitPromise": {
        const { factory, onReject } = current;
        let promise: Promise<any>;
        try {
          promise = factory();
        } catch (err) {
          onReject(err);
        }
        return promise.then(
          (value) => value as T,
          (reason) => onReject(reason),
        );
      }
      case "bind": {
        const value = executeNode(current.source, env);
        if (isThenable(value)) {
          const cont = current.continuation;
          return Promise.resolve(value).then((v) =>
            executeNode(cont(v), env),
          ) as Promise<T>;
        }
        current = current.continuation(value);
        continue;
      }
      case "runEffect":
        throw new Error(
          "runEffect is only valid inside a machine step (suspend)",
        );
      case "machine":
        return runMachine(current, env);
      case "use": {
        if (!env.has(current.sym.key)) {
          throw new Error(
            `No implementation in environment for symbol ${String(current.sym.key.description ?? "symbol")}`,
          );
        }
        return env.get(current.sym.key) as T;
      }
      case "provide": {
        const child: Environment = new Map(env);
        for (const [k, v] of current.layer.entries) {
          child.set(k, v);
        }
        env = child;
        current = current.inner;
        continue;
      }
    }
  }
}

function runMachine<T>(
  machineNode: MachineNode<T>,
  env: Environment,
  resume: unknown = undefined,
): T | Promise<T> {
  let currentResume = resume;
  for (;;) {
    let next: ThunkNode<any> = machineNode.step(currentResume);
    while (next.kind === "defer") {
      next = next.factory();
    }
    if (next.kind === "succeed") {
      return next.value as T;
    }
    if (next.kind === "runEffect") {
      const value = executeNode(next.source, env);
      if (isThenable(value)) {
        return Promise.resolve(value).then((v) =>
          runMachine(machineNode, env, v),
        );
      }
      currentResume = value;
      continue;
    }
    // Nested machine / bind / use / provide / awaitPromise — run to completion.
    return executeNode(next, env) as T | Promise<T>;
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
  WithAsync,
  ProvideRequires,
  ThunkReturnType,
  Protocol,
  HasAsync,
  Async,
};

export type { Suspend };
