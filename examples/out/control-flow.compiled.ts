/**
 * Generated from examples/control-flow.thunk
 * Do not edit — re-run: bun scripts/compile.ts examples/control-flow.thunk
 */

import { succeed, defer, bind, execute } from "../../packages/runtime/src/index.ts";

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min
  if (n > max) return max
  return n
}
const seedValues: number[] = [3, -1, 8, 0, 5, 2, 9, 4];
const classify = defer(() => {
let positives = 0;
let negatives = 0;
let zeros = 0;
for (const value of seedValues) {
    if (value > 0) {
      positives += 1
    } else if (value < 0) {
      negatives += 1
    } else {
      zeros += 1
    }
  }
let label = "mixed";
switch (true) {
    case negatives === 0 && zeros === 0:
      label = "all-positive"
      break
    case positives === 0 && zeros === 0:
      label = "all-negative"
      break
    case positives === 0 && negatives === 0:
      label = "all-zero"
      break
    default:
      label = "mixed"
      break
  }
return succeed({
    positives,
    negatives,
    zeros,
    label,
  });
});
const accumulate = defer(() => {
let total = 0;
let i = 0;
while (i < seedValues.length) {
    const value = seedValues[i]!
    i += 1

    if (value <= 0) {
      continue
    }

    total += value

    if (total > 20) {
      break
    }
  }
let doubled = 0;
do {
    doubled = total * 2
  } while (false);
return succeed({
    total,
    doubled,
    stoppedEarly: total > 20 || i < seedValues.length,
  });
});
const guarded = defer(() => {
let recovered = false;
let message = "ok";
let answer = 0;
try {
    for (const value of seedValues) {
      if (value === 0) {
        throw new Error("zero encountered")
      }
      answer += value
    }
  } catch (err) {
    recovered = true
    message = err instanceof Error ? err.message : "unknown"
    answer = clamp(answer, 0, 100)
  } finally {
    if (!recovered) {
      message = "clean"
    }
  }
{
    // bare block scope
    const bonus = recovered ? 1 : 0
    answer += bonus
  }
return succeed({
    recovered,
    message,
    answer,
  });
});
const program = defer(() => bind(classify, stats => bind(accumulate, sums => bind(guarded, safety => {
let score = stats.positives * 2 + sums.total;
if (safety.recovered) {
    score -= 3
  } else {
    score += 1
  }
for (let n = 0; n < 3; n++) {
    score += n
  }
return succeed({
    stats,
    sums,
    safety,
    score,
  });
}))));
const result = execute(program);
console.log(JSON.stringify(result, null, 2));
