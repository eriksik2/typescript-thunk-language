import { succeed, defer, runEffect, machine, execute, __ascribeThunkYield, __oracleRun } from "@thunk/runtime/internal";
import type { ThunkReturnType, InferLet } from "@thunk/types";

const delay = (ms: number) => defer(() => {
let t = 0;
while (t < ms) {
t = t + 1;
}
return succeed(ms);
});
const step = (n: number) => defer(() => succeed(n));
const classify = (n: number) => defer(() => {
if (n < 0) {
return succeed("neg");
}
 else if (n === 0) {
return succeed("zero");
}
 else {
return succeed("pos");
}
throw new globalThis.Error("unreachable");
});
const accumulate = (start: number, limit: number, cap: number) => __ascribeThunkYield(
async () => {
const warm = await __oracleRun(delay(3));
let total = warm * 0;
let seen = 0;
for (let i = start; i <= limit; i = i + 1) {
const kind = await __oracleRun(classify(i));
if (kind === "zero") {
continue;
}
if (kind === "neg") {
seen = seen + 1;
continue;
}
const v = await __oracleRun(step(i));
seen = seen + 1;
if (seen % 2 === 0) {
continue;
}
total = total + v;
if (total > cap) {
break;
}
}
if (total === 0) {
return {
      total: 0,
      status: "empty",
      warm: warm,
    };
}
let checksum = total;
let peels = 0;
while (checksum > 10) {
checksum = checksum - 7;
peels = peels + 1;
if (peels >= 5) {
break;
}
}
return {
    total: total,
    checksum: checksum,
    peels: peels,
    warm: warm,
    status: "ok",
  };
},
defer(() => {
let __state = 0;
const __t0 = false ? delay(3) : undefined;
let warm: ThunkReturnType<NonNullable<typeof __t0>>;
const __t1 = false ? classify(i) : undefined;
let kind: ThunkReturnType<NonNullable<typeof __t1>>;
const __t2 = false ? step(i) : undefined;
let v: ThunkReturnType<NonNullable<typeof __t2>>;
const __v0 = false ? (warm * 0) : undefined;
let total: InferLet<NonNullable<typeof __v0>>;
const __v1 = false ? (0) : undefined;
let seen: InferLet<NonNullable<typeof __v1>>;
const __v2 = false ? (start) : undefined;
let i: InferLet<NonNullable<typeof __v2>>;
const __v3 = false ? (total) : undefined;
let checksum: InferLet<NonNullable<typeof __v3>>;
const __v4 = false ? (0) : undefined;
let peels: InferLet<NonNullable<typeof __v4>>;
return machine(function (__resume?: any) {
while (true) {
switch (__state) {
case 0:
__state = 1;
return runEffect(delay(3));
case 1:
warm = __resume as ThunkReturnType<NonNullable<typeof __t0>>;
total = warm * 0;
seen = 0;
i = start;
__state = 3;
continue;
case 2:
if (total === 0) {
__state = 16;
continue;
} else {
__state = 15;
continue;
}
case 3:
if (i <= limit) {
__state = 4;
continue;
} else {
__state = 2;
continue;
}
case 4:
__state = 6;
return runEffect(classify(i));
case 5:
i = i + 1;
__state = 3;
continue;
case 6:
kind = __resume as ThunkReturnType<NonNullable<typeof __t1>>;
if (kind === "zero") {
__state = 8;
continue;
} else {
__state = 7;
continue;
}
case 7:
if (kind === "neg") {
__state = 10;
continue;
} else {
__state = 9;
continue;
}
case 8:
__state = 5;
continue;
case 9:
__state = 11;
return runEffect(step(i));
case 10:
seen = seen + 1;
__state = 5;
continue;
case 11:
v = __resume as ThunkReturnType<NonNullable<typeof __t2>>;
seen = seen + 1;
if (seen % 2 === 0) {
__state = 13;
continue;
} else {
__state = 12;
continue;
}
case 12:
total = total + v;
if (total > cap) {
__state = 14;
continue;
} else {
__state = 5;
continue;
}
case 13:
__state = 5;
continue;
case 14:
__state = 2;
continue;
case 15:
checksum = total;
peels = 0;
__state = 18;
continue;
case 16:
return succeed({
      total: 0,
      status: "empty",
      warm: warm,
    });
case 17:
return succeed({
    total: total,
    checksum: checksum,
    peels: peels,
    warm: warm,
    status: "ok",
  });
case 18:
if (checksum > 10) {
__state = 19;
continue;
} else {
__state = 17;
continue;
}
case 19:
checksum = checksum - 7;
peels = peels + 1;
if (peels >= 5) {
__state = 20;
continue;
} else {
__state = 18;
continue;
}
case 20:
__state = 17;
continue;
default:
throw new globalThis.Error("invalid thunk state");
}
}
});
})
);
const program = __ascribeThunkYield(
async () => {
const capped = await __oracleRun(accumulate(0, 12, 20));
const empty = await __oracleRun(accumulate(-5, 0, 100));
const small = await __oracleRun(accumulate(1, 4, 100));
return {
    capped: capped,
    empty: empty,
    small: small,
  };
},
defer(() => {
let __state = 0;
const __t0 = false ? accumulate(0, 12, 20) : undefined;
let capped: ThunkReturnType<NonNullable<typeof __t0>>;
const __t1 = false ? accumulate(-5, 0, 100) : undefined;
let empty: ThunkReturnType<NonNullable<typeof __t1>>;
const __t2 = false ? accumulate(1, 4, 100) : undefined;
let small: ThunkReturnType<NonNullable<typeof __t2>>;
return machine(function (__resume?: any) {
while (true) {
switch (__state) {
case 0:
__state = 1;
return runEffect(accumulate(0, 12, 20));
case 1:
capped = __resume as ThunkReturnType<NonNullable<typeof __t0>>;
__state = 2;
return runEffect(accumulate(-5, 0, 100));
case 2:
empty = __resume as ThunkReturnType<NonNullable<typeof __t1>>;
__state = 3;
return runEffect(accumulate(1, 4, 100));
case 3:
small = __resume as ThunkReturnType<NonNullable<typeof __t2>>;
return succeed({
    capped: capped,
    empty: empty,
    small: small,
  });
default:
throw new globalThis.Error("invalid thunk state");
}
}
});
})
);
const result = execute(program);
console.log(JSON.stringify(result, null, 2));
