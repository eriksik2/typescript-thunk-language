/**
 * Minimal Thunk AST for M0.
 *
 * Supported:
 *   const name = thunk { ... }
 *   const name = run expr
 *   run expr                      (expression statement / top-level)
 *   return expr
 *   let/const name = expr
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
  | ExpressionStatement;

export interface VariableStatement {
  readonly kind: "VariableStatement";
  readonly range: Range;
  readonly declarationKind: "const" | "let";
  readonly name: Identifier;
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
