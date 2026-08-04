# Thunk Language — Language Design

**Status:** Canonical language description  
**Companion:** Implementation, editor packaging, and milestones live in `[ARCHITECTURE.md](./ARCHITECTURE.md)`.  
**Feature checklist:** Per-feature status, examples, and expected behavior → `[FEATURES.md](./FEATURES.md)`.  
**Browseable reference:** Per-feature how-to pages → `[language-reference/](./language-reference/README.md)`.

This document is the full design of Thunk’s syntax, semantics, protocols, lowering, and runtime. Where architecture decisions are settled (editor stack, file extension, milestone order), see `ARCHITECTURE.md`; this file owns *what the language is*. For “is X implemented yet?” see `FEATURES.md`. For “how does feature X work?” prefer `language-reference/`.

---



## 1. Goals

The language is a TypeScript-adjacent language built on top of the TypeScript compiler and JavaScript runtime.

It is **not** a TypeScript superset. It has its own syntax and semantics, while intentionally preserving TypeScript’s familiar style:

- imperative statements;
- ordinary variables and mutation;
- explicit `return`;
- TypeScript-like types and generics;
- ordinary functions and interfaces;
- structural typing where appropriate.

The language should provide powerful typed computation composition without requiring functional-programming style.

The programmer should write:

```ts
const program = thunk {
  const user = run getUser(id)
  const posts = run getPosts(user.id)

  return {
    user,
    posts,
  }
}
```

The programmer should not need to write:

```ts
getUser(id)
  .flatMap(user =>
    getPosts(user.id)
      .map(posts => ({
        user,
        posts,
      })),
  )
```

The language may use state machines, continuations, or other representations internally, but those are implementation details.

The initial language is centered around:

1. thunks;
2. explicit execution with `run`;
3. compiler-generated state machines for `run`;
4. pipe syntax;
5. extensible protocol types;
6. protocol-aware type inference;
7. runtime operations corresponding to protocol-aware library functions.

Errors, typed failure channels, cancellation, concurrency, and resource scopes are intentionally outside the initial core unless required by the thunk runtime.

---



## 2. Core Concepts



### 2.1 Thunks

A thunk is an inert computation that produces a value when run.

Basic syntax:

```ts
const value = thunk {
  return 42
}
```

Its type is:

```ts
Thunk<number>
```

Creating a thunk does not execute its body.

```ts
const value = thunk {
  console.log("executing")

  return 42
}
```

The log occurs only when the thunk is run:

```ts
const result = run value
```

Thunk bodies use ordinary TypeScript-like statements:

```ts
const program = thunk {
  let total = 0

  for (const value of values) {
    total += value
  }

  return total
}
```

Thunk bodies use explicit `return`. There are no implicit final-expression returns.

### 2.2 Thunk types

A thunk has:

1. a return type;
2. a protocol bag.

The simplest thunk is:

```ts
Thunk<T>
```

A thunk with protocols is written:

```ts
Thunk<T>
  Requires(ServiceA | ServiceB)
  Once
```

The protocol syntax is postfix and compositional.

For example:

```ts
Thunk<User>
  Requires(Database | Logger)
  Once
```

means:

- the thunk returns `User`;
- it requires `Database` and `Logger`;
- it has the `Once` protocol.

Protocols are not ordinary TypeScript intersections or unions.

The protocol syntax represents a dedicated **protocol bag**.

Conceptually:

```ts
Thunk<T>
  Requires(A)
  Once
  Requires(B)
```

normalizes to:

```ts
Thunk<T>
  Requires(A | B)
  Once
```

The protocol bag behaves similarly to a record with protocol identities as keys:

```ts
{
  [Requires]: A | B,
  [Once]: void,
}
```

However, this record representation is an implementation model, not necessarily the surface syntax or the complete semantic definition.

---



## 3. Protocol Bags



### 3.1 Protocol entries

A protocol bag contains at most one normalized entry for each protocol.

These are equivalent:

```ts
Thunk<T>
  Requires(A)
  Requires(B)
```

```ts
Thunk<T>
  Requires(A | B)
```

The repeated `Requires` entries are merged using the protocol’s composition rules.

The conceptual internal representation is:

```ts
{
  [Requires]: A | B,
}
```

not:

```ts
{
  [Requires]: A,
}
&
{
  [Requires]: B,
}
```

The latter may be used as an intermediate representation, but the compiler must normalize it according to the protocol definition.

The protocol bag is therefore not a plain TypeScript object intersection. It has protocol-aware merge semantics.

### 3.2 Protocol payloads

Every protocol has a payload type.

For:

```ts
Requires(Database | Logger)
```

the payload is:

```ts
Database | Logger
```

For:

```ts
Once
```

the payload may be:

```ts
void
```

or another internal marker type.

The protocol identity and the payload are separate concepts:

```text
Protocol identity:
    Requires

Protocol payload:
    Database | Logger
```

A protocol declaration defines the valid domain of its payload.

### 3.3 Protocol bag type utilities

The language exposes type utilities for inspecting and rebuilding thunk types.

Conceptually:

```ts
type Protocol<T extends Thunk<any>>
```

returns the entire protocol bag.

Example:

```ts
const test =
  thunk
    Requires(A | B)
    Once
  {
    // ...
  }

type TestProtocol =
  Protocol<typeof test>
```

Conceptually:

```ts
type TestProtocol = {
  [Requires]: A | B
  [Once]: void
}
```

The protocol bag may support indexed access:

```ts
type RequiredServices =
  TestProtocol[Requires]
```

which evaluates to:

```ts
A | B
```

Protocol bag utilities may include:

```ts
type Omit<
  P,
  Protocol
>
```

which removes a protocol entry:

```ts
type WithoutRequires =
  Omit<
    TestProtocol,
    Requires
  >
```

The result conceptually contains:

```ts
{
  [Once]: void
}
```

A thunk can be stripped to its return type:

```ts
type Strip<
  T extends Thunk<any>
>
```

For:

```ts
Thunk<User>
  Requires(Database)
  Once
```

the result is:

```ts
Thunk<User>
```

The return type may be extracted using:

```ts
type ReturnType<
  T extends Thunk<any>
>
```

or a thunk-specific equivalent.

The exact names remain provisional (see §22.6).

---



## 4. Protocol Declarations



### 4.1 Protocol syntax

Protocols are declared using:

```ts
protocol Name<
  PayloadConstraint
> {
  // type functions
}
```

Example:

```ts
protocol Requires<
  Tags extends Tag<any>
> {
  bind<A, B>: A | B;

  execute<A>:
    A extends never
      ? never
      : CompileError<
          `Protocol violated`
        >;
}
```

The body resembles an interface, but its declarations are not methods.

This:

```ts
bind<A, B>: A | B;
```

is a type-function declaration.

It has:

- a name;
- generic type parameters;
- a type-level result.

It has no runtime receiver and no runtime implementation.

The absence of `()` distinguishes it from an ordinary method declaration.

### 4.2 Protocol type functions

Protocol members are type-level functions.

For:

```ts
protocol Requires<
  Tags extends Tag<any>
> {
  bind<A, B>: A | B;
}
```

the compiler may conceptually evaluate:

```ts
Requires.bind<
  Database,
  Logger
>
```

as:

```ts
Database | Logger
```

The protocol declaration defines behavior only for its own payload.

The `Requires` protocol receives:

```ts
Database | Logger
```

It does not receive:

- the thunk return type;
- the complete thunk type;
- unrelated protocol entries;
- runtime values.

The compiler manages the complete protocol bag and invokes each protocol independently.

### 4.3 Automatic protocol payload constraints

The protocol payload declaration constrains the parameters of protocol type functions.

Given:

```ts
protocol Requires<
  Tags extends Tag<any>
> {
  bind<A, B>: A | B;
}
```

the parameters are implicitly constrained:

```ts
A extends Tag<any>
B extends Tag<any>
```

The constraints do not need to be repeated.

Conceptually:

```ts
bind<
  A extends Tag<any>,
  B extends Tag<any>
>: A | B;
```

The shorter syntax is preferred.

### 4.4 Built-in thunk primitive functions

The compiler lowers thunk syntax into a small set of atomic operations.

The initial candidate operations are:

```text
succeed
defer
bind
execute
```

A protocol may define type behavior for these operations.

A complete generic example:

```ts
protocol ProtocolName<
  ProtocolType extends any
> {
  bind<A, B>:
    A | B;

  succeed<>:
    never;

  defer<A>:
    A;

  execute<A>:
    A extends never
      ? never
      : CompileError<
          `Protocol violated`
        >;
}
```

The meanings are:

```text
succeed:
    Determine the protocol payload of a completed value.

defer:
    Determine the protocol payload of a deferred computation.

bind:
    Combine protocol payloads during sequential composition.

execute:
    Validate the final protocol payload when execution begins.
```

Protocols only define their own type behavior.

The compiler combines the results into the complete protocol bag.

### 4.5 Default primitive behavior

The language provides inherited defaults:

```text
succeed<>:
    never

defer<A>:
    A
```

A protocol may omit these declarations when it uses the defaults.

Therefore `Requires` can remain compact:

```ts
protocol Requires<
  Tags extends Tag<any>
> {
  bind<A, B>:
    A | B;

  execute<A>:
    A extends never
      ? never
      : CompileError<
          `Unsatisfied requirements`
        >;
}
```

This means:

- a successful pure value introduces no requirements;
- deferring a computation preserves its requirements;
- sequential composition unions requirements;
- execution is invalid while requirements remain.

---



## 5. The Atomic Thunk Runtime



### 5.1 Semantic primitives

The initial semantic kernel is:

```ts
succeed<T>(
  value: T,
): Thunk<T>
```

```ts
defer<T>(
  factory: () => Thunk<T>,
): Thunk<T>
```

```ts
runEffect<A>(
  source: Thunk<A>,
): Suspend<A>
```

```ts
machine<R>(
  step: (resume?: unknown) => R,
): Thunk<…>
```

```ts
execute<T>(
  thunk: Thunk<T>,
): T
```

`bind` remains available as a semantic / hand-written sequencing primitive, but **thunk lowering emits `machine` + `runEffect`**, not nested `bind` continuations.

These operations are semantic primitives.

The generated representation for thunks with `run` is an **iterative switch-based state machine**. Other representations (closures, bytecode, interpreters) remain allowed if behavior stays equivalent.

### 5.2 `succeed`

`succeed` creates a completed thunk.

Conceptually:

```ts
succeed(42)
```

produces:

```ts
Thunk<number>
```

A protocol’s `succeed` type function determines the payload associated with this operation.

For `Requires`:

```ts
Requires.succeed<>
```

is:

```ts
never
```

Therefore a pure completed thunk has no requirements.

### 5.3 `defer`

`defer` delays construction and execution of a thunk computation.

Conceptually:

```ts
defer(() => {
  const value = calculate()

  return succeed(value)
})
```

does not execute `calculate()` until the resulting thunk is run.

`defer` is required because thunk bodies may contain ordinary code before the first `run`.

Example:

```ts
const program = thunk {
  const started = Date.now()

  const user = run getUser()

  return {
    user,
    started,
  }
}
```

`Date.now()` must not execute when `program` is constructed.

The outer thunk therefore lowers through `defer`.

### 5.4 `runEffect` / `machine` (and `bind`)

Inside a thunk, each `run` lowers to **`runEffect(source)`**: suspend the current state machine, execute `source`, then resume `step` with the yield value.

The enclosing thunk body becomes a **`machine(step)`** whose `step` is an iterative `while`/`switch` over explicit state and hoisted locals:

```ts
let state = 0
let user
return machine(function step(value) {
  while (true) {
    switch (state) {
      case 0:
        state = 1
        return runEffect(getUser())
      case 1:
        user = value
        return succeed(user.name)
    }
  }
})
```

Branches and loops become ordinary state transitions (`state = next; continue`). Shared control-flow joins are shared states.

`bind` remains a valid hand-written sequencing API and a useful semantic explanation of `run`, but it is **not** what the lowerer emits.

### 5.5 `execute`

`execute` begins actual execution at an outer execution boundary.

Conceptually:

```ts
execute(program)
```

runs the thunk and returns its produced value.

The compiler invokes every protocol’s `execute` type function before allowing this operation.

For:

```ts
Thunk<User>
  Requires(Database)
```

the compiler evaluates:

```ts
Requires.execute<
  Database
>
```

which produces a compile error.

For:

```ts
Thunk<User>
  Requires(never)
```

the compiler evaluates:

```ts
Requires.execute<
  never
>
```

which succeeds.

---



## 6. `thunk` Lowering



### 6.1 Basic thunk

Source:

```ts
const value = thunk {
  return 42
}
```

Conceptual lowering:

```ts
const value =
  defer(() =>
    succeed(42),
  )
```

The exact generated representation may optimize this to:

```ts
succeed(42)
```

if the compiler proves that the expression has no eager evaluation concerns.

The semantic lowering remains equivalent.

### 6.2 A single `run`

Source:

```ts
const program = thunk {
  const value = run random

  return value * 2
}
```

Conceptual lowering:

```ts
const program =
  defer(() => {
    let state = 0
    let value
    return machine(function (resume) {
      while (true) {
        switch (state) {
          case 0:
            state = 1
            return runEffect(random)
          case 1:
            value = resume
            return succeed(value * 2)
        }
      }
    })
  })
```

Each `run` stores the next state and suspends via `runEffect`. Resume continues in the same dispatcher.

### 6.3 Multiple `run` operations

Source:

```ts
const program = thunk {
  const user =
    run getUser(id)

  const posts =
    run getPosts(user.id)

  return {
    user,
    posts,
  }
}
```

Conceptual lowering:

```ts
const program =
  defer(() => {
    let state = 0
    let user
    let posts
    return machine(function (resume) {
      while (true) {
        switch (state) {
          case 0:
            state = 1
            return runEffect(getUser(id))
          case 1:
            user = resume
            state = 2
            return runEffect(getPosts(user.id))
          case 2:
            posts = resume
            return succeed({ user, posts })
        }
      }
    })
  })
```

Each `run` advances `__state` and returns `runEffect`. Locals are hoisted so they survive suspension.

### 6.4 Ordinary code before `run`

Source:

```ts
const program = thunk {
  const started =
    Date.now()

  const user =
    run getUser()

  return {
    user,
    started,
  }
}
```

Conceptual lowering:

```ts
const program =
  defer(() => {
    const started =
      Date.now()

    return bind(
      getUser(),
      user =>
        succeed({
          user,
          started,
        }),
    )
  })
```

The code before the first `run` executes when the thunk is executed, not when it is constructed.

### 6.5 Ordinary code between `run` operations

Source:

```ts
const program = thunk {
  const user =
    run getUser()

  const name =
    normalize(user.name)

  const posts =
    run getPosts(user.id)

  return {
    name,
    posts,
  }
}
```

Conceptual lowering:

```ts
const program =
  defer(() =>
    bind(
      getUser(),
      user => {
        const name =
          normalize(user.name)

        return bind(
          getPosts(user.id),
          posts =>
            succeed({
              name,
              posts,
            }),
        )
      },
    ),
  )
```

Ordinary statements remain inside the generated continuation.

---



## 7. `run`



### 7.1 One-layer execution

`run` removes exactly one thunk layer.

Given:

```ts
const tx:
  Thunk<Thunk<T>>
```

then:

```ts
const inner =
  run tx
```

has:

```ts
Thunk<T>
```

A second `run` produces:

```ts
T
```

```ts
const value =
  run (run tx)
```

There is no automatic recursive flattening.

### 7.2 `run` inside a thunk

Inside a thunk:

```ts
const value =
  run operation
```

is lowered into:

```ts
bind(
  operation,
  value => {
    // remainder of the thunk
  },
)
```

`run` inside a thunk is therefore a sequencing operation.

It does not create a separate top-level execution boundary.

### 7.3 `run` outside a thunk

Outside a thunk:

```ts
const value =
  run operation
```

is lowered into:

```ts
const value =
  execute(operation)
```

This begins actual execution.

The compiler validates the final protocol bag using each protocol’s `execute` type function.

### 7.4 Nested `run`

Source:

```ts
const value =
  run (run tx)
```

Conceptually:

```ts
bind(
  tx,
  inner =>
    bind(
      inner,
      value =>
        succeed(value),
    ),
)
```

Each `run` corresponds to one sequencing operation.

---



## 8. Pipe Syntax



### 8.1 Basic pipe

Pipe syntax:

```ts
value | transform
```

lowers to:

```ts
transform(value)
```

A pipe with arguments:

```ts
value | transform(a, b)
```

lowers to:

```ts
transform(
  value,
  a,
  b,
)
```

Pipes are ordinary expression transformations.

They are not specific to thunks.

### 8.2 Pipe precedence with `run`

The expression:

```ts
run tx | flatten(1)
```

means:

```ts
run (
  tx | flatten(1)
)
```

The pipe is applied before `run`.

Conceptual lowering:

```ts
run flatten(
  tx,
  1,
)
```

Then the resulting `run` is lowered according to its context.

Inside a thunk:

```ts
const value =
  run tx | flatten(1)
```

becomes:

```ts
bind(
  flatten(tx, 1),
  value => {
    // remainder
  },
)
```

Outside a thunk:

```ts
const value =
  run tx | flatten(1)
```

becomes:

```ts
execute(
  flatten(tx, 1),
)
```

---



## 9. Protocol Inference



### 9.1 Protocol inference through lowering

Protocols are inferred by applying protocol type functions to the lowered atomic operations.

Example:

```ts
const program = thunk {
  const database =
    run use(Database)

  const logger =
    run use(Logger)

  return database.query(
    logger,
  )
}
```

The relevant lowering is:

```ts
bind(
  use(Database),
  database =>
    bind(
      use(Logger),
      logger =>
        succeed(
          database.query(
            logger,
          ),
        ),
    ),
)
```

The declared types are:

```ts
use(Database):
  Thunk<DatabaseService>
    Requires(Database)
```

```ts
use(Logger):
  Thunk<LoggerService>
    Requires(Logger)
```

The compiler applies:

```ts
Requires.bind<
  Database,
  Logger
>
```

which evaluates to:

```ts
Database | Logger
```

The inferred result is:

```ts
Thunk<Result>
  Requires(
    Database
    | Logger
  )
```



### 9.2 Protocol inference is local

Each protocol operates only on its own payload.

Suppose:

```ts
Thunk<A>
  Requires(Database)
  Once
```

is bound to:

```ts
Thunk<B>
  Requires(Logger)
```

The compiler performs protocol operations independently.

For `Requires`:

```ts
Requires.bind<
  Database,
  Logger
>
```

produces:

```ts
Database | Logger
```

For `Once`, the compiler applies the `Once.bind` type function using the `Once` payloads.

The compiler then reconstructs the complete protocol bag.

Protocols do not inspect or mutate one another.

### 9.3 Absent protocol entries

When a protocol is absent from one side of an operation, the compiler supplies the protocol’s identity payload.

For `Requires`, the identity is:

```ts
never
```

Therefore:

```ts
Requires.bind<
  Database,
  never
>
```

evaluates to:

```ts
Database
```

The identity is supplied by `succeed<>` (see §22.2).

---



## 10. The `Requires` Protocol



### 10.1 Symbols (branding + env tags)

A `symbol` declaration introduces **one value** and **one nominal type** with the same name:

```ts
symbol Age = number
symbol Database {
  name: string
}
```

The object-body form is sugar for `symbol Database = { name: string }`.

**Semantics**

1. **Value** `Name` has type conceptually `symbol T` (identity typed by associated type `T`). It is **callable**: `Name(x: T) => Name` (branded intro).
2. **Type** `Name` is the **branded** type of inhabitants (nominal over `T`).
3. Assignability: `Name` → `T` allowed; `T` → `Name` only via `Name(...)`.
4. `typeof Name` is the symbol identity. `typeof brandedValue` is `Name`.
5. `SymbolType<X>` extracts `T` from either the identity or a branded inhabitant.
6. Branding **object** values stamps the identity so `Symbol.of(branded)` recovers `Name`; primitives stay naked (use `layerOf` for those).
7. Env: `use(Name)`; `provide(thunk, branded)` or `provide(thunk, layerOf(Name, impl))`.
8. `Requires` bag keys are symbol **identities** (`typeof Database`), not the branded service shape.
9. Anonymous `symbol { ... }` in expression position is out of scope (deferred).

Browseable how-to: [`language-reference/symbols/`](./language-reference/symbols/README.md), [`language-reference/environment/`](./language-reference/environment/README.md).

Example (branding):

```ts
symbol Age = number
const a: Age = Age(30)
const n: number = a   // ok
// const bad: Age = 30 // error
```

Example (env / Requires):

```ts
import { use, provide } from "@thunk/runtime"

symbol Database {
  name: string
}

const DatabaseLive = Database({ name: "ada" })

const fetchUser = thunk {
  const db = run use(Database)
  return db.name
}

const program: Thunk<string> = provide(
  fetchUser,
  DatabaseLive,
)
```

See `examples/symbols.thunk` and `examples/requires.thunk`.

Env APIs (`use` / `provide` / `layerOf` / `Symbol`) are imported from `@thunk/runtime`. The type `Thunk<T>` is auto-available (no import). Compiler helpers (`succeed` / `defer` / `bind` / `execute` / `__makeSymbol`) come from `@thunk/runtime/internal` via the lowerer.

### 10.2 `Requires`

Initial declaration:

```ts
protocol Requires<
  Tags extends ThunkSymbol<any>
> {
  bind<A, B>:
    A | B;

  execute<A>:
    A extends never
      ? never
      : CompileError<
          `Unsatisfied requirements`
        >;
}
```

Semantics:

```text
bind:
    Merge requirements.

execute:
    Reject execution if requirements remain.
```

Examples:

```ts
Requires.bind<
  Database,
  Logger
>
```

evaluates to:

```ts
Database | Logger
```

```ts
Requires.execute<
  never
>
```

succeeds.

```ts
Requires.execute<
  Database
>
```

produces:

```ts
CompileError<
  `Unsatisfied requirements`
>
```

---



## 11. `use`



### 11.1 Type signature

A first signature:

```ts
function use<
  T extends Tag<any>
>(
  tag: T,
):
  Thunk<
    Infer<T>
  >
  Requires(T);
```

`Infer<T>` extracts the service type from a tag.

Conceptually:

```ts
type Infer<
  T extends Tag<any>
> =
  T extends Tag<
    infer Service
  >
    ? Service
    : never;
```

Example:

```ts
const database =
  use(Database)
```

has:

```ts
Thunk<DatabaseService>
  Requires(Database)
```



### 11.2 Runtime behavior

`use` creates a thunk operation that reads a service from the current runtime environment.

Conceptually:

```text
use(tag):

    When executed:

        Look up tag in the
        current environment.

        Return the associated
        service implementation.
```

The runtime representation may be a tagged thunk node:

```ts
{
  kind: "use",
  tag,
}
```

or an equivalent internal representation.

The protocol type is declared explicitly in the function signature.

The compiler does not infer the requirement from the runtime implementation.

---



## 12. Layers



### 12.1 Layer type

A layer contains implementations for one or more tags.

Conceptually:

```ts
Layer<
  Database
  | Logger
>
```

contains runtime mappings:

```text
Database
    → liveDatabase

Logger
    → liveLogger
```

The layer type records which tags it provides.

The runtime representation may be:

```ts
Map<
  symbol,
  unknown
>
```

or a specialized immutable environment structure.

### 12.2 Layer semantics

A layer is an environment fragment.

Given:

```text
Current environment:

{
  Logger:
    logger
}
```

and:

```text
Layer:

{
  Database:
    database
}
```

providing the layer produces a scoped child environment:

```text
{
  Logger:
    logger

  Database:
    database
}
```

The parent environment is unchanged.

---



## 13. `provide`



### 13.1 Type signature

The current candidate signature is:

```ts
function provide<
  Th extends
    Thunk<any>
    Requires(P),

  P extends Requires,

  S extends P
>(
  thunk: Th,

  layer: Layer<S>,
):
  Strip<Th>
  Omit<
    Protocol<Th>,
    Requires
  >
  Requires(
    Exclude<P, S>
  );
```

The intended meanings are:

```text
Th:
    The complete input thunk type.

P:
    The payload of the thunk's
    Requires protocol.

S:
    The tags supplied by the layer.
```

The constraint:

```ts
S extends P
```

ensures that the layer provides only requirements present in the thunk.

The result:

```ts
Exclude<P, S>
```

removes provided requirements.

### 13.2 Protocol preservation

The signature preserves every unrelated protocol.

Given:

```ts
Thunk<User>
  Requires(
    Database
    | Logger
  )
  Once
```

and:

```ts
Layer<Database>
```

the result is:

```ts
Thunk<User>
  Requires(Logger)
  Once
```

The transformation is:

```text
Input protocol bag:

{
  [Requires]:
    Database | Logger

  [Once]:
    void
}
```

Remove the `Requires` entry:

```text
{
  [Once]:
    void
}
```

Insert the transformed `Requires` entry:

```text
{
  [Requires]:
    Logger

  [Once]:
    void
}
```

The result preserves the complete thunk type except for the transformed `Requires` payload.

### 13.3 Runtime behavior

At runtime, `provide` accepts a **layer** or a **branded object** (resolved via `Symbol.of` to a one-entry layer):

```ts
provide(thunk, DatabaseLive)
provide(thunk, layerOf(Database, impl))
```

creates a thunk that:

1. receives the current environment;
2. extends it with the layer (or branded entry);
3. executes the inner thunk in the extended environment;
4. restores the outer environment after execution.

See [`language-reference/environment/provide.md`](./language-reference/environment/provide.md).

Conceptually:

```ts
function provide(
  thunk,
  layer,
) {
  return runtimeThunk(
    runtime => {
      const childRuntime = {
        ...runtime,

        environment:
          runtime.environment
            .extend(layer),
      }

      return executeIn(
        thunk,
        childRuntime,
      )
    },
  )
}
```

This is illustrative pseudocode.

The actual runtime should avoid unnecessary copying.

### 13.4 Explicit protocol transformations

`provide` is not a special compiler inference rule.

Its type explicitly transforms the protocol:

```text
Requires(P)

    ↓ provide Layer<S>

Requires(
  Exclude<P, S>
)
```

Its runtime implementation explicitly transforms the environment:

```text
Environment

    ↓ provide layer

Extended environment
```

The type behavior and runtime behavior correspond but are independently defined.

---



## 14. Protocol Type Manipulation



### 14.1 Why explicit protocol utilities are needed

Protocol inference handles ordinary thunk composition.

For example:

```ts
run use(Database)
```

causes `Requires(Database)` to propagate through generated `bind` operations.

However, some functions intentionally transform an existing protocol.

Examples include:

```text
provide:
    Remove requirements.

synchronize:
    Transform an access protocol.

consume:
    Transform a usage protocol.

scope:
    Transform resource ownership.
```

These functions require explicit protocol type manipulation.

The protocol type utilities provide this capability.

### 14.2 Proposed utilities

Conceptually:

```ts
type Protocol<
  T extends Thunk<any>
>
```

Extract the complete protocol bag.

```ts
type Strip<
  T extends Thunk<any>
>
```

Remove all protocols while preserving the thunk return type.

```ts
type ReturnType<
  T extends Thunk<any>
>
```

Extract the produced value type.

```ts
type Omit<
  ProtocolBag,
  Protocol
>
```

Remove a protocol entry.

The language may later provide protocol-specific utilities:

```ts
type GetProtocol<
  ProtocolBag,
  Protocol
>
```

```ts
type SetProtocol<
  ProtocolBag,
  Protocol,
  Payload
>
```

```ts
type RemoveProtocol<
  ProtocolBag,
  Protocol
>
```

The exact public API can remain provisional.

---



## 15. Protocol Bag Normalization



### 15.1 Repeated protocol entries

The language allows repeated protocol syntax:

```ts
Thunk<T>
  Requires(A)
  Requires(B)
```

The compiler normalizes it.

Conceptual input:

```text
{
  [Requires]:
    A
}

&

{
  [Requires]:
    B
}
```

The compiler must not apply ordinary TypeScript intersection semantics directly.

Instead, it groups entries by protocol identity and applies protocol-aware composition.

For `Requires`:

```ts
Requires.bind<
  A,
  B
>
```

produces:

```ts
A | B
```

The normalized result is:

```text
{
  [Requires]:
    A | B
}
```



### 15.2 Protocol payloads that are themselves unions

A protocol payload may itself use union types.

For `Requires`:

```ts
Requires(
  Database
  | Logger
)
```

means the payload is the union:

```ts
Database | Logger
```

The protocol declaration determines how payloads combine.

For `Requires`:

```ts
bind<A, B>:
  A | B;
```

Therefore:

```ts
Requires(A)
Requires(B)
```

becomes:

```ts
Requires(A | B)
```

The fact that the payload is a union does not create ambiguity.

The protocol identity determines which type function is used.

The compiler performs:

```ts
Requires.bind<
  A,
  B
>
```

rather than attempting to infer merging behavior from the payload type itself.

### 15.3 Protocol merge is not necessarily union

The `Requires` protocol uses union because requirements accumulate as a set.

Other protocols may define different behavior.

For example, a hypothetical protocol could use:

```ts
bind<A, B>:
  Combine<A, B>;
```

The language must not assume that all protocol payloads are unions.

The protocol declaration owns the meaning of payload composition.

---



## 16. Type-Level Higher-Order Functions

The protocol type-function syntax is intended to support higher-order type programming.

Example syntax:

```ts
protocol Example<
  T
> {
  transform<
    F
  >:
    Apply<F, T>;
}
```

The exact syntax and semantics are not yet defined.

The important initial requirement is:

> Protocol type functions must be expressive enough to accept, return, and manipulate generic type functions.

This capability is not required for the first `Requires` implementation but should influence the design of the type-function system.

The type-function system should not be limited to ordinary TypeScript aliases.

---



## 17. Compiler Architecture (language view)

Implementation packaging (Volar, packages, milestones) is specified in `ARCHITECTURE.md`. This section states language-facing compiler requirements.

### 17.1 Front-end

Thunk lowers to ordinary TypeScript checked by the stock TypeScript checker. One shared lowering serves the editor (virtual documents + source maps) and CLI emit.

Initial stages:

```text
Source (.thunk)

    ↓

Parse (Thunk front-end)

    ↓

Extended AST

    ↓

Thunk lowering  (thunk / run / pipe → defer / machine / runEffect / succeed / execute)

    ↓

Protocol encoding into TypeScript types

    ↓

Virtual / emitted TypeScript  +  source maps

    ↓

TypeScript checker / emitter
```

Reuse TypeScript where possible:

- ordinary TypeScript syntax in bodies and annotations;
- ordinary declarations and expressions (as `TsExpression` regions early on);
- JavaScript emission;
- module resolution;
- editor infrastructure via virtual documents (Volar).

The language-specific front-end handles:

```text
thunk
run
protocol
postfix protocol syntax
pipe syntax
protocol type functions
```



### 17.2 Extended AST nodes

Initial language-specific AST nodes may include:

```text
ThunkExpression
RunExpression
PipeExpression
ProtocolDeclaration
ProtocolType
ProtocolBagType
ProtocolTypeFunction
```

A thunk expression contains an ordinary block:

```ts
thunk {
  // ordinary statements
}
```

The compiler must preserve ordinary lexical scope when generating continuations.

### 17.3 Thunk lowering pass

The thunk lowering pass should:

1. identify each `run` inside a thunk;
2. split the thunk body into state-machine regions;
3. hoist locals that must survive suspension;
4. emit an iterative `machine` + `switch` dispatcher;
5. suspend with `runEffect` and resume into the next state;
6. wrap construction in `defer`;
7. convert final returns into `succeed`;
8. preserve control-flow semantics (branches/loops as state transitions).

The first implementation may restrict complex control flow.

Recommended initial restrictions:

- `run` allowed only in statement positions;
- no `run` inside arbitrary expressions;
- no `run` inside loop conditions;
- **no `try` / `catch` / `finally`** (handler/finalizer state is designed separately);
- no `run` across other unsupported control-flow boundaries.

For example, initially supported:

```ts
const user =
  run getUser()

return user
```

Initially unsupported:

```ts
return (
  run getUser()
).name
```

The latter can be rewritten:

```ts
const user =
  run getUser()

return user.name
```

These restrictions simplify the first state-machine transformation.

Expression-position `run` can later be supported through ANF-style normalization into statement-position `run` before the same machine lowering.

### 17.4 Variable capture

Generated continuations must preserve lexical scope.

Source:

```ts
const program = thunk {
  const prefix =
    "user:"

  const user =
    run getUser()

  return (
    prefix
    + user.name
  )
}
```

Lowering:

```ts
const program =
  defer(() => {
    let state = 0
    let user
    const prefix = "user:"
    return machine(function (resume) {
      while (true) {
        switch (state) {
          case 0:
            state = 1
            return runEffect(getUser())
          case 1:
            user = resume
            return succeed(prefix + user.name)
        }
      }
    })
  })
```

Hoisted / outer-scoped locals capture `prefix` across suspension.

### 17.5 Control flow

Thunk bodies with `run` lower through an **iterative switch-based state machine**. Branches and loops become explicit state transitions (`state = next; continue`), which gives a direct path to `if`, loops, `break`, `continue`, and shared joins without runtime recursion.

Define exact behavior before supporting:

- `break` / `continue` / labeled statements (once loop AST exists);
- `return` from nested functions;
- generators.

**Explicitly out of scope for now:** `try` / `catch` / `finally`. Exception handling and guaranteed finalization need additional handler/finalizer state and must be designed separately rather than added as an incomplete special case.

Prefer a correct, readable state-machine emit over supporting every JavaScript construct immediately.

---



## 18. Runtime Architecture



### 18.1 Runtime thunk representation

A simple initial runtime may use tagged nodes:

```ts
type RuntimeThunk<T> =
  | SucceedNode<T>
  | DeferNode<T>
  | BindNode<any, T>
  | RunEffectNode<any>
  | MachineNode<T>
  | UseNode<T>
  | ProvideNode<T>
```

`machine` + `runEffect` are what the lowerer emits for thunks with `run`. `bind` remains for hand-written sequencing.

Conceptually:

```ts
interface SucceedNode<T> {
  kind: "succeed"
  value: T
}
```

```ts
interface DeferNode<T> {
  kind: "defer"
  factory: () => RuntimeThunk<T>
}
```

```ts
interface RunEffectNode<A> {
  kind: "runEffect"
  source: RuntimeThunk<A>
}
```

```ts
interface MachineNode<T> {
  kind: "machine"
  step: (resume: unknown) => RuntimeThunk<T> | RunEffectNode<any>
}
```

The exact representation is an implementation detail.

### 18.2 Runtime environment

The runtime carries an environment:

```ts
interface Runtime {
  environment:
    Environment
}
```

An environment maps tag identities to implementations.

Conceptually:

```ts
type Environment =
  Map<
    symbol,
    unknown
  >
```

A persistent environment structure may be preferable later.

### 18.3 Runtime execution

The executor evaluates thunk nodes.

Conceptually:

```ts
function execute<T>(
  thunk:
    RuntimeThunk<T>,

  runtime:
    Runtime,
): T
```

Behavior:

```text
succeed:
    Return the value.

defer:
    Invoke the factory and execute
    the resulting thunk.

runEffect (inside machine only):
    Execute the source.
    Resume the machine step with
    the yield value.

machine:
    Call step(undefined).
    On runEffect, execute source,
    then step(resumeValue).
    On succeed, return the value.
    Branches/loops are ordinary
    switch + continue inside step.

bind:
    Execute the source.
    Pass the result to the
    continuation.
    Execute the returned thunk.

use:
    Look up the tag in the
    current environment.

provide:
    Extend the environment.
    Execute the inner thunk in
    the child environment.
```

The executor drives `machine` iteratively so lowered thunks do not grow the JS stack with nested continuations.

---



## 19. Compile-Time and Runtime Separation

The language has two related but distinct systems.

### 19.1 Type-level system

The type system determines:

- thunk return types;
- protocol payloads;
- protocol composition;
- protocol validation;
- explicit protocol transformations.

Example:

```ts
Requires.bind<
  Database,
  Logger
>
```

evaluates to:

```ts
Database | Logger
```



### 19.2 Runtime system

The runtime determines:

- actual thunk execution;
- continuation sequencing;
- environment lookup;
- environment extension;
- service implementations.

Example:

```ts
use(Database)
```

looks up the actual database implementation.

### 19.3 Correspondence without identity

The type and runtime systems correspond but are not the same.

For `provide`:

Type-level behavior:

```text
Requires(P)

    →

Requires(
  Exclude<P, S>
)
```

Runtime behavior:

```text
Environment

    +

Layer<S>

    →

Extended environment
```

The compiler does not derive the type transformation by inspecting the runtime implementation.

The function declares its type transformation explicitly.

---



## 20. Implementation roadmap (language features)

Editor environment (Volar + extension + CLI emit) is **done** — see `ARCHITECTURE.md` §9 (M0–M1). Language features grow on that base:


| Milestone     | Language scope                                                                        |
| ------------- | ------------------------------------------------------------------------------------- |
| **M0** (done) | `thunk { return … }`, `run` in statement position, single-`run` lowering, source maps |
| **M1** (done) | Same subset; real editor + CLI (no new syntax)                                        |
| **M2**        | Pipe + multi-`run` + correct `defer` placement (code before/between runs)             |
| **M3**        | Protocol bag encoding + `Requires` + infer through `bind` + reject bad `execute`      |
| **M4**        | `use` / `provide` / `Layer` (+ `Tag`)                                                 |


Full initial prototype target (through M4):

### Syntax

```text
thunk { ... }
run expression
value | function
protocol Name<T> { ... }
Thunk<T> Protocol(...)
```



### Atomic operations

```text
succeed  defer  bind  execute
```



### Protocol support

```text
protocol declarations
bind / execute type functions
protocol bag normalization
protocol extraction / replacement / omission
```



### Built-in protocol and runtime

```text
Requires
Tag  Layer  use  provide
```



### Type utilities

```text
Protocol<T>  Strip<T>  ReturnType<T>  Omit<P, Protocol>
```

---



## 21. Explicitly Deferred Features

The following should not influence the initial core design:

- typed error channels;
- error handling semantics;
- cancellation;
- asynchronous execution;
- concurrency;
- parallel composition;
- resource scopes;
- ownership;
- linear usage;
- synchronization;
- locking;
- actor systems;
- effect tracking beyond `Requires`;
- advanced protocol interoperability.

These may later be modeled as protocols or additional atomic operations.

They should not be added before thunk lowering, protocol inference, and the runtime execution model are stable.

---



## 22. Open Questions



### Resolved (see also `ARCHITECTURE.md` §10)


| Topic                                   | Decision                                             |
| --------------------------------------- | ---------------------------------------------------- |
| Protocol defaults (`succeed` / `defer`) | Inherited defaults                                   |
| Protocol identity                       | From `succeed<>`                                     |
| Partial protocol matching               | Yes — extra protocols remain on `Th`                 |
| Editor base                             | Virtual TypeScript + maps via Volar.js               |
| File extension                          | `.thunk` primary                                     |
| Type host                               | Stock TypeScript checker on lowered code             |
| Feature order                           | Editor environment before new syntax (M1 before M2+) |




### 22.1 Protocol defaults — resolved

Inherited defaults:

```ts
succeed<>:
  never

defer<A>:
  A
```



### 22.2 Protocol identity — resolved

Use `succeed<>` as the identity source (no separate `empty:` declaration for v0).

### 22.3 Protocol bag representation

The implementation may use:

```ts
{
  [Protocol]:
    Payload
}
```

but the language must define protocol-aware normalization.

Ordinary TypeScript intersection behavior is insufficient.

The compiler should maintain a dedicated protocol-bag representation until normalization is complete. Exact lowered TypeScript encoding remains an implementation detail (`ARCHITECTURE.md` §5).

### 22.4 Protocol payload constraints

Formalize:

```ts
P extends Requires
```

as shorthand for:

> `P` is a valid payload for the `Requires` protocol.

For `Requires`, this means:

```ts
P extends Tag<any>
```

This should be a language feature rather than an informal convention. Still open for implementation spelling.

### 22.5 Partial protocol matching — resolved

```ts
Th extends
  Thunk<any>
  Requires(P)
```

matches thunks containing additional protocols. Unrelated entries (e.g. `Once`) remain part of `Th`.

### 22.6 Exact protocol utility syntax — open

The following are conceptual:

```ts
Protocol<T>
Strip<T>
Omit<P, Requires>
```

Final names and hover pretty-printing of postfix protocols vs raw encoding remain open.

---



## 23. Design Summary

The language uses familiar TypeScript-like imperative syntax.

A thunk is an inert computation:

```ts
const program = thunk {
  const user =
    run getUser()

  return user
}
```

`run` removes exactly one thunk layer.

Inside a thunk, `run` lowers to `bind`.

Outside a thunk, `run` lowers to `execute`.

Thunk bodies lower into a small semantic core:

```text
succeed
defer
bind
execute
```

Protocols are postfix entries in a dedicated protocol bag:

```ts
Thunk<T>
  Requires(A | B)
  Once
```

The protocol bag behaves conceptually like a record keyed by protocol identity, but uses protocol-defined normalization.

Protocols declare type functions associated with atomic thunk operations:

```ts
protocol Requires<
  Tags extends Tag<any>
> {
  bind<A, B>:
    A | B;

  execute<A>:
    A extends never
      ? never
      : CompileError<
          `Unsatisfied requirements`
        >;
}
```

Protocols operate only on their own payloads.

They do not see or modify:

- thunk return types;
- other protocol entries;
- runtime values.

Ordinary thunk composition infers protocols through the lowered atomic operations.

Protocol-aware functions explicitly introduce or transform protocols through their declared types.

`use` introduces a requirement:

```ts
function use<
  T extends Tag<any>
>(
  tag: T,
):
  Thunk<
    Infer<T>
  >
  Requires(T);
```

`provide` removes requirements while preserving the rest of the thunk’s protocol bag:

```ts
function provide<
  Th extends
    Thunk<any>
    Requires(P),

  P extends Requires,

  S extends P
>(
  thunk: Th,

  layer: Layer<S>,
):
  Strip<Th>
  Omit<
    Protocol<Th>,
    Requires
  >
  Requires(
    Exclude<P, S>
  );
```

At runtime:

- `use` reads a tagged service from the current environment;
- `provide` extends the environment with a layer for the duration of the inner thunk.

The first complete language slice should make these semantics precise, type-safe, and easy to lower into JavaScript—and visible in the editor—before expanding into additional protocols or broader effect-system features.