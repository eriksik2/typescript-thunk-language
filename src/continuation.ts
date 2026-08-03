import { ThunkClass, type Thunk } from "./thunk";

export type ContinuationFn<A, T> = A extends void ? () => T : (input: A) => T;

export interface Continuation<A, T> {
  bind: (input: A) => Thunk<T>;
}

export class ContinuationClass<A, T> implements Continuation<A, T> {
  constructor(private readonly _call: ContinuationFn<A, T>) {}
  readonly bind = (input: A) => new ThunkClass<T>(() => this._call(input));
}

export type ContinuationLike<A, T> = ContinuationFn<A, T> | Continuation<A, T>;
export function Continuation<A, T>(
  call: ContinuationLike<A, T>,
): Continuation<A, T> {
  if (call instanceof ContinuationClass) {
    return call;
  }
  return new ContinuationClass(call as ContinuationFn<A, T>);
}
