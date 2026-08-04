/**
 * Result Ok/Err runtime + match helpers.
 */

import { describe, expect, test } from "bun:test";
import { Err, Ok, type Result } from "./src/result";
import {
  __exhaustive,
  __symbolPayload,
  symbolIs,
} from "./src/internal";

describe("Result Ok / Err", () => {
  test("Ok/Err brand and Symbol.is", () => {
    const r: Result<number, string> = Ok(42);
    expect(symbolIs(r, Ok)).toBe(true);
    expect(symbolIs(r, Err)).toBe(false);
    expect(__symbolPayload(r)).toBe(42);
  });

  test("match-shaped exhaustiveness at runtime", () => {
    const show = (r: Result<number, string>): string => {
      if (symbolIs(r, Ok)) {
        const n = __symbolPayload(r);
        return "ok " + n;
      } else if (symbolIs(r, Err)) {
        const e = __symbolPayload(r);
        return "err " + e;
      } else {
        return __exhaustive(r);
      }
    };
    expect(show(Ok(1))).toBe("ok 1");
    expect(show(Err("x"))).toBe("err x");
  });
});
