# Requires

## What it is

Built-in protocol: the thunk needs one or more **symbol identities** in the environment before it can run.

## Introducing requirements

[`use(Database)`](../environment/use.md) yields the service and adds `Requires(Database)` (identity = `typeof Database`).

## Discharging requirements

[`provide`](../environment/provide.md) removes identities supplied by a layer or branded inhabitant.

## Keys are identities

Bag keys are symbol **identities** (`typeof Database`), not the branded service shape. Hover pretty-prints `Requires(Database)`.

## Related

- [Protocols overview](./protocols-overview.md)
- [symbol declarations](../symbols/symbol-declarations.md)
- [use](../environment/use.md)
- [provide](../environment/provide.md)
