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
  symbolOf,
  symbolIs,
  symbolExtends,
  Symbol,
  type Layer,
} from "./internal";

export {
  Failure,
  Defect,
  UnhandledError,
  Error,
} from "./failure";
export type {
  Failure,
  Defect,
  UnhandledError,
  Error,
  FailurePayload,
} from "./failure";

export type {
  Thunk,
  EmptyProtocols,
  ProtocolBag,
  MergeProtocols,
  ExecuteResult,
  ThunkSymbol,
  SymbolType,
  SymbolOfValue,
  IdentityCarrier,
  WithRequires,
  ProvideRequires,
  Requires,
} from "@thunk/types";
