import type { Continuation } from "./continuation";
import { Thunk, ThunkClass } from "./thunk";
import { value } from "./utils";
export const bind = <A, T>(input: A, b: Continuation<A, T>): Thunk<T> =>
  b.bind(input);
