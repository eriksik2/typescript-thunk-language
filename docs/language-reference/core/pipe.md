# Pipe (`|`)

## What it is

`|` is **first-argument call sugar**, left-associative. It is an ordinary expression transform — not thunk-specific and not Effect’s `pipe(x, f, g)`.

| Source | Lowers to |
|---|---|
| `x \| f` | `f(x)` |
| `x \| f(a, b)` | `f(x, a, b)` |
| `x \| obj.m` | `obj.m(x)` |
| `a \| b \| c` | `c(b(a))` |

In expression position, `|` is always this pipe (not bitwise OR). Type-level `|` (unions) is unchanged.

## Syntax

```ts
value | transform
value | transform(extra, args)
value | obj.method
a | b | c
```

## Precedence with `run`

`|` binds **tighter than** [`run`](./run.md):

```ts
run tx | flatten(1)   // run (tx | flatten(1))  →  run flatten(tx, 1)
(run tx) | f          // different: pipe after the run completes
```

So `run tx | f` is **not** the same as `(run tx) | f`.

## Semantics

- No auto-flatten and no thunk magic in the operator — it only rearranges the call.
- Expression-position `run` (e.g. `(run getUser()).name`, `foo(run a)`) is normalized to statement `const __rN = run …` (**ANF**) before state-machine lowering. See [`run`](./run.md).
- `while (run …)` rewrites so the `run` happens **each iteration** (`while (true) { const __rN = run …; if (!__rN) break; … }`). `for` conditions with nested `run` are still lifted once before the loop (prefer `while` or statement `run` in the body).

## Examples

```ts
const doubled = 21 | ((n: number) => n * 2)

const program = thunk {
  const v = run tx | flatten(1)
  return (run getUser).name
}
```

See [`examples/pipe.thunk`](../../../examples/pipe.thunk).

## Related

- [run](./run.md) — sequencing; pipe precedence; ANF
- [Thunk blocks](./thunk-blocks.md)
- [Control flow](./control-flow.md)
