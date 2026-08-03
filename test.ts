import { Thunk, Continuation, value, zip } from "./src";

const random = Thunk(() => Math.random());

const isAbove = Continuation((th: number) =>
  Continuation((val: number) => (val > th ? val : null)),
);
const log = Continuation((fnc: Thunk<number | null>) => {
  const result = fnc.yield;
  console.log("result: ", result);
  return result;
});

const randomAbove = log.bind(random.flatMap(isAbove.bind(0.99)));
const ra = random.flatMap(isAbove.bind(0.99));
const ia99 = isAbove.bind(0.99);

const UntilNumber = Continuation((fnc: Thunk<number | null>) => {
  while (true) {
    const result = fnc.yield;
    if (result !== null) {
      return result;
    }
  }
});

const timed = Continuation((func: Thunk<number>) => {
  const start = Date.now();
  const result = func.yield;
  const end = Date.now();
  const duration = end - start;
  return [result, duration] as const;
});

const program = Thunk(() => {
  const [result1, duration1] = randomAbove.pipe(UntilNumber).pipe(timed).yield;
  console.log("duration1: ", duration1, "result1: ", result1);

  const [result, duration] = timed.bind(UntilNumber.bind(randomAbove)).yield;
  console.log("duration: ", duration, "result: ", result);
  return result;
});
console.log("program: ", program);
program.yield;
