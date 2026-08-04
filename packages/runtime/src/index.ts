/**
 * Semantic primitives for Thunk.
 * Representation is tagged nodes; executor is recursive (fine for the prototype).
 */

export type RuntimeThunk<T> =
  | SucceedNode<T>
  | DeferNode<T>
  | BindNode<unknown, T>;

export interface SucceedNode<T> {
  readonly kind: "succeed";
  readonly value: T;
}

export interface DeferNode<T> {
  readonly kind: "defer";
  readonly factory: () => RuntimeThunk<T>;
}

export interface BindNode<A, B> {
  readonly kind: "bind";
  readonly source: RuntimeThunk<A>;
  readonly continuation: (value: A) => RuntimeThunk<B>;
}

export function succeed<T>(value: T): RuntimeThunk<T> {
  return { kind: "succeed", value };
}

export function defer<T>(factory: () => RuntimeThunk<T>): RuntimeThunk<T> {
  return { kind: "defer", factory };
}

export function bind<A, B>(
  source: RuntimeThunk<A>,
  continuation: (value: A) => RuntimeThunk<B>,
): RuntimeThunk<B> {
  return { kind: "bind", source, continuation };
}

export function execute<T>(thunk: RuntimeThunk<T>): T {
  switch (thunk.kind) {
    case "succeed":
      return thunk.value;
    case "defer":
      return execute(thunk.factory());
    case "bind": {
      const value = execute(thunk.source);
      return execute(thunk.continuation(value));
    }
  }
}
