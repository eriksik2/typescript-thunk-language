/**
 * Author-facing symbol APIs: of / is / has / to / extends.
 *
 * Hierarchy is a relation on identities — not value subtyping (no LSP).
 */

import type {
  BrandCarrier,
  SymbolExtends,
  SymbolOfValue,
  SymbolToTarget,
  SymbolType,
  ThunkSymbol,
} from "@thunk/types";
import { Defect } from "./failure";
import {
  symbolExtends as extendsIdentity,
  symbolHas as hasIdentity,
  symbolIs as isExact,
  symbolOf as ofIdentity,
  symbolTo as toInternal,
} from "./internal";

export function symbolOf<V>(value: V): SymbolOfValue<V> {
  return ofIdentity(value);
}

/** Exact: `Symbol.of(value) === sym`. Type predicate for match narrowing. */
export function symbolIs<V, S extends ThunkSymbol<any>>(
  value: V,
  sym: S,
): value is Extract<V, { readonly __symbolIdentity?: S }> {
  return isExact(value, sym);
}

/** Hierarchy: leaf is `sym` or extends it. */
export function symbolHas(value: unknown, sym: ThunkSymbol<any>): boolean {
  return hasIdentity(value, sym);
}

/** Identity-level ancestry (no value). */
export function symbolExtends(
  child: ThunkSymbol<any>,
  parent: ThunkSymbol<any>,
): boolean {
  return extendsIdentity(child, parent);
}

/**
 * Checked upcast along the hierarchy.
 * - Type: `sym` must be an ancestor of the value's leaf (`SymbolToTarget`).
 * - Runtime: `has` must hold; otherwise throws `Defect`.
 * - Does not re-stamp — `Symbol.of` stays the leaf.
 */
export function symbolTo<V, S extends ThunkSymbol<any>>(
  value: V,
  sym: SymbolToTarget<V, S>,
): SymbolType<S> & BrandCarrier<SymbolType<S>> {
  return toInternal(value, sym as S, (message) => {
    throw Defect({ message });
  });
}

export const Symbol = {
  of: symbolOf,
  is: symbolIs,
  has: symbolHas,
  to: symbolTo,
  extends: symbolExtends,
} as const;

export type { SymbolExtends, SymbolToTarget };
