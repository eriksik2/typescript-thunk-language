/**
 * Author-facing Thunk runtime — import explicitly in `.thunk` files.
 *
 * Compiler helpers live in `@thunk/runtime/internal` (injected by the lowerer).
 * The type `Thunk<T>` is auto-imported by the lowerer from `@thunk/types`.
 */

export {
  use,
  provide,
  layerOf,
  mergeLayers,
  type Layer,
} from "./internal";

export type {
  Thunk,
  EmptyProtocols,
  ProtocolBag,
  MergeProtocols,
  ExecuteResult,
  ThunkSymbol,
  SymbolType,
  WithRequires,
  ProvideRequires,
  Requires,
} from "@thunk/types";
