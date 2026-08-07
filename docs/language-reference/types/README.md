# Types

Type-level surface of Thunk programs (checked via lowered TypeScript).

## Pages

| Feature | Summary |
|---|---|
| [Thunk type](./thunk-type.md) | `Thunk<T>` / `Thunk<T, P>` — auto-available |
| [Protocols overview](./protocols-overview.md) | Protocol bags & postfix syntax |
| [Requires](./requires.md) | Requirement protocol |
| [Async](./async.md) | Flag protocol — `execute` → `Promise<T>` |
| [Fallibility](./fallibility.md) | Error-subtype unions; `run` vs `try` |

## Related

- [Symbols](../symbols/README.md) — identities used as `Requires` keys
- [Environment](../environment/README.md) — introducing / discharging requirements
- [wrap](../core/wrap.md) — Promise bridge
