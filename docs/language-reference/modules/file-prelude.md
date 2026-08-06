# File prelude

## What it is

Thunk sources start with a short **prelude**. Feature definition files and code files use different forms. Preludes are **navigation / ownership metadata** — erased on lower, not part of generated TypeScript.

### Feature files (`Name.feature.thunk`)

```thunk
feature BankImportSystem
tags Finance Import

feature Parser of BankImportSystem
```

### Code files (`*.thunk`)

```thunk
file charge of BankImportSystem

file parseIntl of BankImportSystem.Parser
```

## Ownership

Each feature is defined by `Name.feature.thunk` in that feature’s folder. Code files and nested subfeatures must live in that folder tree, and not inside a different subfeature’s folder. The innermost enclosing feature owns the path.

## Syntax

| Form | Where | Meaning |
|---|---|---|
| `feature <Ident>` | `*.feature.thunk` | Root feature |
| `feature <Ident> of <Ident>(.<Ident>)*` | `*.feature.thunk` | Subfeature |
| `file <Ident> of <Ident>(.<Ident>)*` | code `.thunk` | Named member of a feature (`of` required) |
| `tags <Ident>+` | optional after either | Feature tags drive the Code Browser tag bar |

## Editor

- **Feature tags** (horizontal toggles above the Code Browser) filter the feature tree (OR).
- **+ feature** / **+ file** open an editor with the prelude filled and the cursor on the name; **Save** creates `Name/Name.feature.thunk` or `Name.thunk`.

## Example

[`examples/Examples.feature.thunk`](../../../examples/Examples.feature.thunk) and members such as [`basic.thunk`](../../../examples/basic.thunk).

## Related

- [Imports](./imports.md)
- [Editor](../tooling/editor.md)
- [Modules](./README.md)
