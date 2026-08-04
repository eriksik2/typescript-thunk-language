/**
 * Thunk AST.
 *
 * Hybrid front-end:
 * - Thunk-specific: thunk / run / return / const-let with thunk or run inits
 * - Opaque TypeScript: TsExpression + TsStatement (if/for/while/switch/try/…)
 *
 * Restriction: `run` only in statement-list position (not inside opaque
 * control-flow). `return` that produces the thunk result must be at the
 * thunk body statement-list level (not nested inside if/for/…). Nested
 * blocks should mutate locals and fall through to a final `return`.
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
  | TsStatement;

export interface VariableStatement {
  readonly kind: "VariableStatement";
  readonly range: Range;
  readonly declarationKind: "const" | "let";
  readonly name: Identifier;
  /** Optional TypeScript type annotation text (without `:`). */
  readonly typeAnnotation?: string;
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

/** Opaque TypeScript statement (control flow, functions, bare blocks, …). */
export interface TsStatement {
  readonly kind: "TsStatement";
  readonly range: Range;
  readonly text: string;
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

/** Opaque TypeScript expression text. */
export interface TsExpression {
  readonly kind: "TsExpression";
  readonly range: Range;
  readonly text: string;
}
