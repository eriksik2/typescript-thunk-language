# Symbols

First-class `symbol` declarations: nominal branding **and** environment tags (same primitive).
Supports **abstract** symbols and **`extends`** hierarchies (value-level Liskov; exact env keys).

## Pages

| Feature | Summary |
|---|---|
| [symbol declarations](./symbol-declarations.md) | `symbol Name = T` / `{ … }` / `abstract` / `extends` |
| [Branding](./branding.md) | `Name(value)` intro; assignability |
| [Symbol.of](./symbol-of.md) | Recover leaf identity from a branded object |
| [Symbol.is / has / to](./symbol-is.md) | Exact `is`, hierarchical `has` / `to` / `extends` |
| [Failure hierarchy](./failure-hierarchy.md) | Built-in `Failure` / `Defect` / `UnhandledError` / `Error` |

## Related

- [use](../environment/use.md) / [provide](../environment/provide.md)
- [Requires](../types/requires.md)
