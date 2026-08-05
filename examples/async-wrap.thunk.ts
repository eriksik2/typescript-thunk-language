import { wrap } from "@thunk/runtime";
import { succeed, defer, runEffect, machine, execute } from "@thunk/runtime/internal";
import type { ThunkReturnType } from "@thunk/types";

function promiseFn(): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(Math.random() > 0.5), 10)
  })
};
const program = defer(() => {
let __state = 0;
const __t0 = false ? wrap(() => promiseFn()) : undefined;
let res: ThunkReturnType<NonNullable<typeof __t0>>;
let tries: number;
return machine(function (__resume?: any) {
while (true) {
switch (__state) {
case 0:
tries = 0;
__state = 2;
continue;
case 1:
return succeed(undefined as void);
case 2:
if (true) {
__state = 3;
continue;
} else {
__state = 1;
continue;
}
case 3:
__state = 4;
return runEffect(wrap(() => promiseFn()));
case 4:
res = __resume as ThunkReturnType<NonNullable<typeof __t0>>;
if (res) {
__state = 6;
continue;
} else {
__state = 5;
continue;
}
case 5:
tries++;
if (tries > 20) {
__state = 7;
continue;
} else {
__state = 2;
continue;
}
case 6:
return succeed(tries);
case 7:
return succeed(tries);
default:
throw new Error("invalid thunk state");
}
}
});
});
const __r0 = execute(wrap(() => promiseFn()));
const programAsFn = async () => {
  let tries: number = 0;
  while (true) {
    const res = await __r0
    if (res) return tries
    tries++
    if (tries > 20) return tries
  }
};
const result = execute(program);
result.then((tries) => {
  console.log({ tries })
});
