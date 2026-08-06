True language support changes these problems because the compiler, types, and runtime can share one model. Libraries can approximate that; only language features can make “the wrong shape” unrepresentable or auto-derived. Below is an abstract tour of each area, plus a few adjacent ones.

---

### 1. Code organization

**The real pain:** folder structure is convention. Boundaries are soft. “Where does this live?” and “who may depend on whom?” are tribal knowledge.

**Language-shaped answer:** modules that carry *roles* and *allowed edges*, not just names.

- **Architectural units as kinds:** `domain`, `adapter`, `policy`, `worker`, `migration` — each with different import rules.
- **Dependency direction as types:** `UI` cannot import `Storage` unless through a declared port; the compiler enforces the graph.
- **Ownership:** every symbol belongs to a *bounded context*; cross-context use requires an explicit bridge type, not a casual import.
- **Co-location contracts:** “this screen may only talk to these three capabilities” is a protocol bag / capability set, not a README.

Difference from packages: the unit of organization becomes something the typechecker understands, so refactors that violate layering fail the same way a type error does.

---

### 2. “One clear way” for large, specific things

**The real pain:** every team invents a slightly different CQRS / saga / outbox / “service layer.” Patterns exist; the language doesn’t pick one, so codebases become museums of half-patterns.

**Language-shaped answer:** *opinionated primitives* with a closed surface, not infinite DIY.

- A first-class **command / query / reaction** triad with fixed lifecycle hooks.
- A single **transaction boundary** primitive (`atomic { ... }`) that composes with effects, not ad-hoc `begin/commit`.
- **One** way to declare “this is a background job,” “this is a user-facing request,” “this is a replayable workflow.”

The win isn’t that other styles become impossible — it’s that the *default* path is complete (types, emit, runtime, observability) so inventing a second way has a real cost. Languages that “support everything equally” lose this.

---

### 3. Features split across app, infra, and workers

**The real pain:** “feature X” is half in HTTP handlers, half in queues, half in cron, half in Terraform. No single artifact *is* the feature.

**Language-shaped answer:** a **feature** as a compile unit that lowers to multiple deployments.

```text
feature Billing {
  endpoint charge(...)
  worker reconcile(...)
  schedule nightly(...)
  resource queue:outbox
}
```

The compiler would:

- check that every path that enqueues also has a consumer,
- generate the worker entrypoints and infra stubs from one definition,
- keep types consistent across process boundaries (same schema on both sides of the queue).

Protocols / capability bags already point this direction: a feature’s *requirements* are the distributed surface. Language support would make the *topology* part of the program, not a side document.

---

### 4. Legacy support and migration

**The real pain:** dual-write, strangler figs, feature flags for months, “old path / new path” forever. Migration is process, not language.

**Language-shaped answer:** **versioned interfaces** and **migration as a type**.

- `api v1 | v2` with compulsory adapters until v1 is deleted.
- `migrate from OldUser to NewUser` that the compiler tracks: every producer/consumer must be on a known stage (`shadow` / `dual` / `cutover` / `retire`).
- **Deprecation in the type system:** calling a retired symbol is an error; calling a deprecated one is a warning with an expiry date baked into CI.
- **Compatibility proofs:** “this transform is total and invertible” as a checked property for schema migrations.

Libraries give you tools; language support makes “we’re mid-migration” a first-class program state the toolchain can reason about.

---

### 5. Database access (the thousand libraries)

**The real pain:** ORMs, query builders, raw SQL, repositories — each leaks differently. The DB is the real schema; the code is a rumor.

**Language-shaped answer:** treat **storage as an effect protocol with a schema identity**, not as “pick a library.”

- Queries typed against a **named schema version**, not against invent-your-own entity classes.
- Capability: `Requires(Db<"orders", v14>)` — you cannot query tables you didn’t declare.
- **Query language embedded** with the same typechecker as the host (not string SQL, not a separate DSL that drifts).
- One lowering target (SQL dialect) but one *source* model; adapters become backends, not competing worldviews.

The language doesn’t need to replace Postgres. It needs to make “which schema am I talking to?” and “is this query valid *now*?” as checked as function types.

---

### 6. State machines — and then persisted / distributed ones

**The real pain:** ad-hoc enums + booleans → “we should have used a state machine” → “now we need durable execution across workers.” Two different problems glued together.

**Language-shaped answer:** separate **behavioral FSM** from **durable workflow**, with a bridge.

1. **Local machine:** states, events, guards, transitions — exhaustive, no illegal transitions, derived diagrams.
2. **Durable machine:** same graph, but each transition is a checkpoint; timers, signals, and compensation are syntax; identity is a workflow id, not a heap object.
3. **Distribution:** the language defines *exactly-once vs at-least-once* at the transition boundary, and which state is recoverable after crash.

Most languages stop at (1) in libraries. Production needs (2)+(3). True support means the *same* state graph can run in-memory for tests and durably in prod without rewriting the machine into a saga framework’s idiom.

Thunk’s `machine` / effect direction is philosophically close: effects already encode “steps.” Language work is making *persisted identity*, *replay*, and *worker affinity* part of that model rather than bolted-on.

---

### 7. Validation, schemas, transforms, serializers

**The real pain:** Zod vs class-validator vs OpenAPI vs protobuf vs DB constraints — four truths, none of which stay equal.

**Language-shaped answer:** **one schema calculus**, many projections.

- A single declaration of shape + invariants.
- Derived: runtime validators, JSON/binary codecs, OpenAPI, DB columns, TypeScript types — all from one AST.
- **Transforms as morphisms** with checked properties: total, partial, lossy, versioned (`v3 → v4`).
- Boundary keyword: `ingress` / `egress` that *must* go through a schema; raw `any` can’t cross the wire.

The language feature isn’t “another validator.” It’s *schema identity* shared by typechecker, runtime, and emit. Drift becomes a compile error.

---

### 8. Infrastructure that isn’t version-controlled (or isn’t the same version as code)

**The real pain:** code in Git; queues, topics, IAM, timeouts in consoles. Drift is silent until prod.

**Language-shaped answer:** **resources as declarations** that lower to infra *and* wire into types.

```text
resource Topic "orders.placed" { retention: 7d }
resource Worker "fulfillment" { concurrency: 32, consumes: Topic... }
```

Then:

- `publish(orders.placed, …)` only typechecks if that resource exists in *this* deployment’s resource set.
- Diff of the program *is* the infra plan (or generates it).
- Environments (`dev` / `staging` / `prod`) are parameterizations of the same declarations, not separate snowflakes.

Pulumi/CDK get halfway there from outside the language. Inside the language, missing a queue is the same class of error as calling an undefined function.

---

### 9. DB schema likewise

Same story, sharper: migrations are ordered history; code assumes a snapshot. Language support could mean:

- Schema versions as **types** (`Schema@42`).
- Application code pinned to a version; deploy order constrained by the typechecker (“app@42 cannot deploy before migration 42”).
- **Expand/contract** as named phases the compiler understands.
- Generated migration diffs from declared schema, not hand-written SQL that diverges from entities.

---

### 10. Higher-level architectural patterns

Huge design space. Language support shines when a pattern has **invariants that libraries can’t enforce**:

| Pattern | Language lever |
|---|---|
| Hexagonal / ports | Ports are types; adapters are the only implementors |
| Event sourcing | Event log + fold as primitives; projections are derived |
| CQRS | Separate write/read type worlds; cross-use restricted |
| Actor / mailbox | Isolated state + message protocols as types |
| Capability security | Authority only via unforgeable tokens (your symbols/Requires direction) |
| Policy-as-code | Authz rules as checked AST, not scattered `if`s |
| Multi-tenant | Tenant id as ambient capability; leakage is a type error |

The theme: **encode the invariant, not the tutorial.** Tutorials live in docs; invariants belong in the checker.

---

### A few more worth the same treatment

**Observability / SLOs**  
Traces and metrics as structured effects: every boundary auto-instruments; “this path must record `payment.attempt`” is required by type. Dashboards become projections of the program.

**Time and causality**  
First-class *logical time*, deadlines, and “happens-before” between steps — critical for distributed machines and outbox patterns. “This handler may run at most 5 minutes after enqueue” as a checked annotation.

**Consistency modes**  
`strong | eventual | read-your-writes` as part of a data access protocol, so you can’t casually mix them inside one transaction without an explicit escape hatch.

**Access control**  
Not middleware bolted on — principals and permissions in the capability bag. “This thunk requires `ActAs(user)` and `Perm(orders.write)`.”

**Configuration & secrets**  
Config keys typed and required at provide-time; missing prod config fails compile/deploy of that feature, not at 3am.

**Testing the architecture**  
`simulate` / `replay` as language modes: same state machine, accelerated time, injected faults. Property tests generated from schema + machine exhaustiveness.

**Human workflows**  
Approvals, tickets, “wait for human” as durable wait states — the boring half of real business processes that pure code FSMs ignore.

**API product surface**  
Public API versions as modules with compatibility rules; breaking changes require a new major and a migration adapter, not a PR description.

---

### What “true language support” actually buys (cross-cutting)

Across all of these, language features win when they provide at least one of:

1. **Unrepresentable illegal states** — illegal transitions, wrong-layer imports, unschematized ingress.
2. **Single source → many artifacts** — code, infra, OpenAPI, migrations, workers from one declaration.
3. **Cross-boundary identity** — same type on both sides of a queue, process, or schema version.
4. **Lifecycle awareness** — migrate, deprecate, dual-run, retire as program states.
5. **Default completeness** — the blessed path includes observability, persistence, and failure, so teams stop re-inventing 80% solutions.

Libraries and runtimes can fake (2) and (5) with enough discipline. (1), (3), and (4) are where syntax + types + compiler cooperation pull ahead — especially if you’re already building something protocol/capability-oriented like Thunk.

---

### A useful filter for your experiments

For each idea, ask:

- **Is the invariant global?** (If yes → language/types. If local → library.)
- **Does it cross process or time?** (If yes → needs identity + serialization + durability in the model.)
- **Would a wrong implementation still typecheck in TS today?** (If yes → that’s the gap language support should close.)
- **Can one declaration lower to app + worker + infra?** (If yes → you’re designing a *system*, not a keyword.)

If you want to go deeper next, pick one cluster (e.g. durable machines, schema-as-identity, or feature-as-deployable-unit) and we can sketch a concrete surface that fits Thunk’s existing thunk/protocol/`Requires`/`Layer` world without committing to implementation.