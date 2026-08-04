/**
 * Thunk AST.
 *
 * Supported:
 *   const name [: Type Requires(...) Once] = thunk { ... }
 *   const name = run expr
 *   run expr
 *   return expr
 *   protocol Name<...> { bind<A,B>: ...; ... }
 *   symbol Name = Type;
 *   symbol Name { ... }
 *
 * Expressions are kept as raw TypeScript text + span (hybrid strategy).
 */

import type { Range } from "./source-map";

export interface SourceFile {
  readonly kind: "SourceFile";
  readonly fileName: string;
  readonly text: string;
  readonly statements: Statement[];
}

export type Statement =
  | VariableStatement
  | ReturnStatement
  | ExpressionStatement
  | ProtocolDeclaration
  | SymbolDeclaration;

/** Associated type of a `symbol` declaration. */
export interface SymbolAssociatedType {
  readonly form: "alias" | "object";
  readonly text: string;
  readonly range: Range;
}

/**
 * `symbol Name = Type;` or `symbol Name { ... }` (object sugar).
 * Introduces value `Name` and branded type `Name`.
 */
export interface SymbolDeclaration {
  readonly kind: "SymbolDeclaration";
  readonly name: Identifier;
  readonly associatedType: SymbolAssociatedType;
  readonly range: Range;
}

export interface ProtocolClause {
  readonly name: string;
  /** Type text inside Requires(...); omitted for flag protocols like Once. */
  readonly payload?: string;
  readonly range: Range;
}

export interface TypeAnnotation {
  /** Base type text before postfix protocols (e.g. `Thunk<User>`). */
  readonly baseText: string;
  readonly protocols: readonly ProtocolClause[];
  readonly range: Range;
}

export interface VariableStatement {
  readonly kind: "VariableStatement";
  readonly range: Range;
  readonly declarationKind: "const" | "let";
  readonly name: Identifier;
  readonly typeAnnotation?: TypeAnnotation;
  readonly initializer: Expression;
}

export interface ReturnStatement {
  readonly kind: "ReturnStatement";
  readonly range: Range;
  readonly expression: Expression;
}

export interface ExpressionStatement {
  readonly kind: "ExpressionStatement";
  readonly range: Range;
  readonly expression: Expression;
}

export interface ProtocolTypeFunction {
  readonly name: string;
  readonly typeParams: string;
  readonly resultType: string;
  readonly range: Range;
}

export interface ProtocolDeclaration {
  readonly kind: "ProtocolDeclaration";
  readonly range: Range;
  readonly name: Identifier;
  /** Raw generic params text, e.g. `Tags extends Tag<any>`, or empty. */
  readonly typeParams: string;
  readonly members: readonly ProtocolTypeFunction[];
}

export type Expression =
  | Identifier
  | ThunkExpression
  | RunExpression
  | TsExpression;

export interface Identifier {
  readonly kind: "Identifier";
  readonly range: Range;
  readonly name: string;
}

export interface ThunkExpression {
  readonly kind: "ThunkExpression";
  readonly range: Range;
  readonly body: Statement[];
}

export interface RunExpression {
  readonly kind: "RunExpression";
  readonly range: Range;
  readonly expression: Expression;
}

/** Opaque TypeScript expression text (hybrid front-end). */
export interface TsExpression {
  readonly kind: "TsExpression";
  readonly range: Range;
  readonly text: string;
}
