# Branding

## What it is

Calling the symbol value brands an associated-type inhabitant:

```ts
symbol Age = number
const a: Age = Age(30)
const n: number = a   // ok
// const bad: Age = 30 // error
```

```ts
symbol Database { name: string }
const DatabaseLive = Database({ name: "live" })
```

## Identity retention

Branding **stamps** the symbol identity onto the value so [`Symbol.of`](./symbol-of.md) / [`match`](../core/match.md) / [`provide`](../environment/provide.md) work:

- **Objects / functions** — stamped in place.
- **Primitives** — boxed (e.g. `Object(30)` plus a payload slot) so identity is retained while the type stays `T & Brand`. Match bindings unwrap via `__symbolPayload`.

```ts
symbol Age = number
const a: Age = Age(30)
const n: number = a   // ok at the type level
Symbol.is(a, Age)     // true (boxed)
```

## Abstract symbols

`abstract symbol` identities are **not** callable. Brand with a concrete descendant instead:

```ts
abstract symbol Failure { message: string }
symbol Defect extends Failure

const d = Defect({ message: "boom" })
// Failure({ message: "x" }) // runtime error
// const f: Failure = d      // type error — use Symbol.to(d, Failure)
```

## Related

- [symbol declarations](./symbol-declarations.md)
- [Symbol.of](./symbol-of.md)
- [Symbol.is / has / to](./symbol-is.md)
- [provide](../environment/provide.md)
