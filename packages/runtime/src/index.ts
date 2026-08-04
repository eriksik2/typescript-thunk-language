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

export {
  symbolOf,
  symbolIs,
  symbolHas,
  symbolTo,
  symbolExtends,
  Symbol,
} from "./symbol-api";

export { wrap } from "./wrap";

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

export { Ok, Err } from "./result";
export type { Ok, Err, Result } from "./result";

export type {
  Thunk,
  EmptyProtocols,
  ProtocolBag,
  MergeProtocols,
  ExecuteResult,
  ThunkSymbol,
  SymbolType,
  SymbolOfValue,
  SymbolExtends,
  SymbolToTarget,
  IdentityCarrier,
  ParentCarrier,
  WithRequires,
  WithAsync,
  ProvideRequires,
  Requires,
  Async,
  HasAsync,
} from "@thunk/types";
