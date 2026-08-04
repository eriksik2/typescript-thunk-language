/**
 * Compiler / lowerer internals — not part of the author-facing surface.
 * Import from `@thunk/runtime/internal` only in generated output.
 */

import type {
  EmptyProtocols,
  ExecuteResult,
  GetRequires,
  IdentityCarrier,
  MergeProtocols,
  Protocol,
  ProtocolBag,
  ProvideRequires,
  Requires,
  SymbolOfValue,
  SymbolType,
  Thunk,
  ThunkReturnType,
  ThunkSymbol,
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
  /** Not callable — cannot brand values. Still usable with `Symbol.is`. */
  readonly abstract?: boolean;
  /** Parent identity for Liskov hierarchy (`Symbol.is` / `Symbol.extends`). */
  readonly parent?: ThunkSymbol<any>;
};

/** Runtime parent links for hierarchical symbols. */
const parentByIdentity = new WeakMap<ThunkSymbol<any>, ThunkSymbol<any>>();

/**
 * Runtime helper used by the lowerer for `symbol` declarations.
 * Returns a callable brand intro that carries `.key` for env maps.
 * Branding stamps the identity onto object values so `Symbol.of` / `provide` work.
 *
 * Abstract symbols return a non-callable identity (still has `.key` / parent link).
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
    parentByIdentity.set(identity, options.parent);
  }

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
      "Symbol.of: value is not a branded symbol inhabitant (object values branded via Name(...) carry identity; use layerOf for primitives)",
    );
  }
  return id as SymbolOfValue<V>;
}

/**
 * Hierarchical test: true when `value` was branded with `sym` or a descendant.
 * `Symbol.is(defect, Failure)` is true when `Defect extends Failure`.
 */
export function symbolIs(value: unknown, sym: ThunkSymbol<any>): boolean {
  const id = readIdentity(value);
  if (!id) return false;
  return isAncestorOrSelf(id, sym);
}

/**
 * True when `child` identity is `parent` or extends it (declaration hierarchy).
 */
export function symbolExtends(
  child: ThunkSymbol<any>,
  parent: ThunkSymbol<any>,
): boolean {
  return isAncestorOrSelf(child, parent);
}

/** Namespace alias: `Symbol.of` / `Symbol.is` / `Symbol.extends`. */
export const Symbol = {
  of: symbolOf,
  is: symbolIs,
  extends: symbolExtends,
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
 * Emit a structural `{ readonly [Requires]: … }` bag (same shape as
 * `MergeProtocols`) so hover pretty-printing recognizes `Requires(…)`.
 */
type CollapseProtocolUnion<P extends ProtocolBag> = [GetRequires<P>] extends [
  never,
]
  ? EmptyProtocols
  : { readonly [Requires]: GetRequires<P> };

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
  let current: ThunkNode<any> = thunk;
  for (;;) {
    switch (current.kind) {
      case "succeed":
        return current.value as T;
      case "defer":
        current = current.factory();
        continue;
      case "bind": {
        const value = executeNode(current.source, env);
        current = current.continuation(value);
        continue;
      }
      case "runEffect":
        throw new Error(
          "runEffect is only valid inside a machine step (suspend)",
        );
      case "machine": {
        let resume: unknown = undefined;
        for (;;) {
          let next: ThunkNode<any> = current.step(resume);
          while (next.kind === "defer") {
            next = next.factory();
          }
          if (next.kind === "succeed") {
            return next.value as T;
          }
          if (next.kind === "runEffect") {
            resume = executeNode(next.source, env);
            continue;
          }
          // Nested machine / bind / use / provide — run to completion.
          return executeNode(next, env) as T;
        }
      }
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
  ThunkReturnType,
  Protocol,
};

export type { Suspend };
