# Branding

## What it is

Calling the symbol value brands an associated-type inhabitant. Brands are
**opaque** — not assignable to the associated type. Use [`Symbol.unwrap`](./symbol-is.md)
to recover the payload.

```ts
symbol Age = number
const a: Age = Age(30)
// const n: number = a          // error
const n: number = Symbol.unwrap(a)  // ok
// const bad: Age = 30          // error
```

```ts
symbol Database { name: string }
const DatabaseLive = Database({ name: "live" })
const name = Symbol.unwrap(DatabaseLive).name
```

`use(Database)` still yields the **associated** service type (unwrapped) so
handlers can call methods without an extra unwrap.

## Identity retention

Branding **stamps** the symbol identity onto the value so [`Symbol.of`](./symbol-of.md) / [`match`](../core/match.md) / [`provide`](../environment/provide.md) work:

- **Objects / functions** — stamped in place (runtime still has fields; types are opaque).
- **Primitives** — boxed (e.g. `Object(30)` plus a payload slot). Match / `unwrap` read via `__symbolPayload`.

```ts
symbol Age = number
const a: Age = Age(30)
Symbol.is(a, Age)              // true (boxed)
Symbol.unwrap(a)               // number
```

## Abstract symbols

`abstract symbol` identities are **not** callable. Brand with a concrete descendant instead:

```ts
abstract symbol Failure { message: string }
symbol Defect extends Failure

const d = Defect({ message: "boom" })
// Failure({ message: "x" }) // runtime error
// const f: Failure = d      // type error — use Symbol.to(d, Failure)
Symbol.unwrap(Symbol.to(d, Failure)).message
```

## Related

- [symbol declarations](./symbol-declarations.md)
- [Symbol.of](./symbol-of.md)
- [Symbol.is / isAny / unwrap](./symbol-is.md)
- [provide](../environment/provide.md)
