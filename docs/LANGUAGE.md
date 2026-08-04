# Thunk Language — Design Brief (condensed)

Full design intent lives with the original language specification. This file is the working summary aligned with `ARCHITECTURE.md`.

## Core

- `thunk { ... }` builds an inert `Thunk<T>` (plus protocol bag).
- `run` removes one thunk layer: inside a thunk → `bind`; outside → `execute`.
- Bodies use ordinary imperative statements and explicit `return`.
- Lowering targets: `succeed`, `defer`, `bind`, `execute`.

## Protocols

- Postfix protocol bag on thunk types: `Thunk<T> Requires(A | B) Once`.
- Protocols declare type functions for atomic ops (`bind`, `execute`, optional `succeed`/`defer`).
- Bags normalize with protocol-defined composition (not TS intersection of duplicate keys).
- Defaults: `succeed<> = never`, `defer<A> = A` (inherited).

## Runtime library (initial)

- `Tag`, `Layer`, `use`, `provide`
- Built-in protocol: `Requires`

## Deferred

Pipes, richer control flow, protocol inference, `use`/`provide`, and later concerns (errors, cancellation, async, concurrency, resources, linearity) wait until **M1** (Volar + editor + CLI emit) works on the M0 subset. See `ARCHITECTURE.md` §9.

## Implementation base

See `ARCHITECTURE.md`: lower-to-TypeScript + virtual documents; next packaging target is Volar.js.
