import {
  Continuation,
  ContinuationClass,
  type ContinuationFn,
  type ContinuationLike,
} from "./continuation";
type ThunkFn<T> = ContinuationFn<void, T>;

export interface Thunk<T> extends Continuation<void, T> {
  yield: T;
  andThen: <U>(b: ContinuationLike<T, U>) => Thunk<U>;
  pipe: <U>(
    b: ContinuationLike<ThunkLike<T>, U> | ContinuationLike<Thunk<T>, U>,
  ) => Thunk<U>;
  flatMap: <U>(
    b:
      | ContinuationLike<T, U | Thunk<U>>
      | Thunk<ContinuationLike<T, U | Thunk<U>>>,
  ) => Thunk<U>;
}
export class ThunkClass<T>
  extends ContinuationClass<void, T>
  implements Thunk<T>
{
  constructor(private readonly _thunk: ThunkFn<T>) {
    super(_thunk);
  }

  get yield() {
    return this._thunk();
  }

  readonly andThen = <U>(b: ContinuationLike<T, U>): Thunk<U> => {
    const bc = Continuation(b);
    return new ThunkClass<U>(() => {
      const result = this.yield;
      return bc.bind(result).yield;
    });
  };
  readonly flatMap = <U>(
    b:
      | ContinuationLike<T, U | Thunk<U>>
      | Thunk<ContinuationLike<T, U | Thunk<U>>>,
  ): Thunk<U> => {
    let inp:
      | ContinuationLike<T, U | Thunk<U>>
      | Thunk<ContinuationLike<T, U | Thunk<U>>> = b;
    while (inp instanceof ThunkClass) {
      inp = (inp as Thunk<ContinuationLike<T, U | Thunk<U>>>).yield;
    }
    const inp1 = inp as ContinuationLike<T, U | Thunk<U>>;
    const bc = Continuation(inp1);
    return new ThunkClass<U>(() => {
      const result = this.yield;
      let res: U | Thunk<U> = bc.bind(result).yield;
      while (res instanceof ThunkClass) {
        res = res.yield;
      }
      return res as U;
    });
  };

  readonly pipe = <U>(
    b: ContinuationLike<ThunkLike<T>, U> | ContinuationLike<Thunk<T>, U>,
  ): Thunk<U> => {
    return Continuation(b).bind(this);
  };
}

export type ThunkLike<T> = ThunkFn<T> | Thunk<T>;
export function Thunk<T>(thunk: ThunkLike<T>): Thunk<T> {
  if (thunk instanceof ThunkClass) {
    return thunk;
  }
  return new ThunkClass(thunk as ThunkFn<T>);
}
