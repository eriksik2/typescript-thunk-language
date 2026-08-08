/**
 * Author-facing symbol APIs: of / is / isAny / unwrap / to / extends.
 *
 * Hierarchy is a relation on identities — not value subtyping (no LSP).
 * Brands are opaque — unwrap to recover the associated payload.
 */

import type {
  BrandCarrier,
  SymbolExtends,
  SymbolHasValue,
  SymbolOfValue,
  SymbolToTarget,
  SymbolType,
  ThunkSymbol,
} from "@thunk/types";
import { Defect } from "./failure";
import {
  __symbolPayload,
  symbolExtends as extendsIdentity,
  symbolIsAny as isAnyIdentity,
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

/**
 * Pedigree: leaf is `sym` or extends it.
 * Narrows like TS `typeof` — else branch excludes matching arms from the union.
 */
export function symbolIsAny<V, S extends ThunkSymbol<any>>(
  value: V,
  sym: S,
): value is SymbolHasValue<V, S> {
  return isAnyIdentity(value, sym);
}

/** Recover the associated payload from an opaque branded value. */
export function symbolUnwrap<V>(value: V): SymbolType<V> {
  return __symbolPayload(value);
}

/** Identity-level ancestry (no value). */
export function symbolExtends(
  child: ThunkSymbol<any>,
  parent: ThunkSymbol<any>,
): boolean {
  return extendsIdentity(child, parent);
}

/**
 * Checked upcast along the hierarchy (opaque parent brand).
 * - Type: `sym` must be an ancestor of the value's leaf (`SymbolToTarget`).
 * - Runtime: `isAny` must hold; otherwise throws `Defect`.
 * - Does not re-stamp — `Symbol.of` stays the leaf.
 * - Use `Symbol.unwrap` for the associated payload fields.
 */
export function symbolTo<V, S extends ThunkSymbol<any>>(
  value: V,
  sym: SymbolToTarget<V, S>,
): { readonly __assoc: SymbolType<S> } & BrandCarrier<SymbolType<S>> {
  return toInternal(value, sym as S, (message) => {
    throw Defect({ message });
  }) as { readonly __assoc: SymbolType<S> } & BrandCarrier<SymbolType<S>>;
}

export const Symbol = {
  of: symbolOf,
  is: symbolIs,
  isAny: symbolIsAny,
  unwrap: symbolUnwrap,
  to: symbolTo,
  extends: symbolExtends,
} as const;

export type { SymbolExtends, SymbolHasValue, SymbolToTarget };
