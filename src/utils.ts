import { Thunk, ThunkClass } from "./thunk";
export const value = <T>(value: T): Thunk<T> => new ThunkClass<T>(() => value);
export const zip = <T, U>(a: Thunk<T>, b: Thunk<U>): Thunk<[T, U]> =>
  new ThunkClass<[T, U]>(() => {
    const resultA = a.yield;
    const resultB = b.yield;
    return [resultA, resultB];
  });
