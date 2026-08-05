/**
 * Thunk AST.
 *
 * Supported:
 *   import { … } from "…"
 *   import type { … } from "…"
 *   const name [: Type Requires(...) Once] = thunk { ... }
 *   const name = run expr
 *   run expr
 *   return expr
 *   protocol Name<...> { bind<A,B>: ...; ... }
 *   symbol Name = Type;
 *   symbol Name<A> = Type;
 *   symbol Name { ... }
 *   abstract symbol Name { ... }
 *   symbol Name extends Parent
 *   symbol Name extends Parent { ... }
 *   expr | fn / expr | fn(a)   (first-arg pipe)
 *   match (expr) { Arm, … }
 *   expr is Pattern          (boolean pattern test)
 *   a && b                   (logical and; binds from `is` flow left-to-right)
 *
 * Expressions: hybrid TS text + structural thunk/run/pipe/match/is; expression-position
 * `run` is normalized via ANF before machine lowering.
 */

import type { Range } from "./source-map";

export interface SourceFile {
  readonly kind: "SourceFile";
  readonly fileName: string;
  readonly text: string;
  readonly statements: Statement[];
}

export type Statement =
  | ImportDeclaration
  | VariableStatement
  | ReturnStatement
  | ExpressionStatement
  | ProtocolDeclaration
  | SymbolDeclaration
  | TypeAliasDeclaration
  | BlockStatement
  | IfStatement
  | WhileStatement
  | ForStatement
  | BreakStatement
  | ContinueStatement;

/**
 * Opaque TypeScript `type Name = …` / `type Name<…> = …` passthrough.
 * Needed so `|` in type aliases is not parsed as pipe.
 */
export interface TypeAliasDeclaration {
  readonly kind: "TypeAliasDeclaration";
  readonly range: Range;
  /** Full original statement text (for faithful emit). */
  readonly text: string;
}

/** `{ … }` */
export interface BlockStatement {
  readonly kind: "BlockStatement";
  readonly range: Range;
  readonly statements: Statement[];
}

/** `if (cond) then [else else]` */
export interface IfStatement {
  readonly kind: "IfStatement";
  readonly range: Range;
  readonly condition: Expression;
  readonly consequent: Statement;
  readonly alternate?: Statement;
}

/** `while (cond) body` */
export interface WhileStatement {
  readonly kind: "WhileStatement";
  readonly range: Range;
  readonly condition: Expression;
  readonly body: Statement;
}

/**
 * C-style `for (init; cond; update) body`.
 * `init` may be a variable statement or expression statement; empty slots are omitted.
 */
export interface ForStatement {
  readonly kind: "ForStatement";
  readonly range: Range;
  readonly initializer?: VariableStatement | ExpressionStatement;
  readonly condition?: Expression;
  readonly update?: Expression;
  readonly body: Statement;
}

export interface BreakStatement {
  readonly kind: "BreakStatement";
  readonly range: Range;
}

export interface ContinueStatement {
  readonly kind: "ContinueStatement";
  readonly range: Range;
}

export interface ImportSpecifier {
  /** Local binding name (after `as` if present). */
  readonly local: string;
  /** Imported name (before `as`), or same as local. */
  readonly imported: string;
  readonly isTypeOnly: boolean;
  readonly range: Range;
}

/**
 * `import { use, provide } from "@thunk/runtime"`
 * `import type { Foo } from "…"`
 */
export interface ImportDeclaration {
  readonly kind: "ImportDeclaration";
  /** True for `import type { … }`. */
  readonly isTypeOnly: boolean;
  readonly specifiers: readonly ImportSpecifier[];
  readonly module: string;
  /** Full original statement text (for faithful emit). */
  readonly text: string;
  readonly range: Range;
}

/** Associated type of a `symbol` declaration. */
export interface SymbolAssociatedType {
  readonly form: "alias" | "object";
  readonly text: string;
  readonly range: Range;
}

/**
 * `symbol Name = Type;` / `symbol Name<A> = Type;` / `symbol Name { ... }` /
 * `abstract symbol …` / `symbol Name extends Parent [{ … }]`.
 * Introduces value `Name` and branded type `Name`.
 * Abstract symbols are not callable brand constructors.
 */
export interface SymbolDeclaration {
  readonly kind: "SymbolDeclaration";
  readonly name: Identifier;
  /** When true, identity is not a brand constructor. */
  readonly isAbstract: boolean;
  /**
   * Raw generic params text without outer `<>`, e.g. `A` or `A, E`,
   * or empty when non-generic.
   */
  readonly typeParams: string;
  /** Parent symbol name when declared with `extends`. */
  readonly extendsName?: Identifier;
  /**
   * Associated type. Omitted when `extends Parent` with no body (inherit).
   * With `extends` + `{ … }`, text is the *extra* fields (merged with parent).
   */
  readonly associatedType?: SymbolAssociatedType;
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
  | PipeExpression
  | MatchExpression
  | IsExpression
  | AndExpression
  | TsExpression;

/**
 * `scrutinee is Pattern` — boolean exact-leaf test.
 * `infer` bindings are only valid in `if` / `while` conditions (and `&&` chains therein).
 */
export interface IsExpression {
  readonly kind: "IsExpression";
  readonly range: Range;
  readonly scrutinee: Expression;
  readonly pattern: MatchPattern;
}

/**
 * Left-associative `&&`. Used so `ready && x is Err: infer e` parses with
 * `is` tighter than `&&`, and bindings flow into later conjuncts / then-branch.
 */
export interface AndExpression {
  readonly kind: "AndExpression";
  readonly range: Range;
  readonly left: Expression;
  readonly right: Expression;
}

/**
 * `match (scrutinee) { Arm, … }` — exact leaf match (v1).
 * Arms use `Symbol.is`; exhaustiveness is checked via `never` on the remainder.
 */
export interface MatchExpression {
  readonly kind: "MatchExpression";
  readonly range: Range;
  readonly scrutinee: Expression;
  readonly arms: readonly MatchArm[];
}

export interface MatchArm {
  readonly kind: "MatchArm";
  readonly range: Range;
  readonly pattern: MatchPattern;
  readonly expression: Expression;
}

export type MatchPattern =
  | MatchSymbolPattern
  | MatchObjectPattern;

/** `Ok` or `Ok: infer a` */
export interface MatchSymbolPattern {
  readonly kind: "MatchSymbolPattern";
  readonly range: Range;
  readonly symbol: Identifier;
  /** Whole-payload binding from `: infer name`. */
  readonly binding?: Identifier;
}

/** `Person { name: infer n, age: infer age }` */
export interface MatchObjectPattern {
  readonly kind: "MatchObjectPattern";
  readonly range: Range;
  readonly symbol: Identifier;
  readonly fields: readonly MatchFieldPattern[];
}

export interface MatchFieldPattern {
  readonly range: Range;
  readonly field: Identifier;
  readonly binding: Identifier;
}

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

/**
 * Left-associative first-arg pipe: `left | right`.
 * Lowers to `right(left)` or `callee(left, …args)` when `right` is a call.
 */
export interface PipeExpression {
  readonly kind: "PipeExpression";
  readonly range: Range;
  readonly left: Expression;
  readonly right: Expression;
}

/**
 * Piece of a hybrid TS expression: opaque text, or an embedded Thunk form
 * (`thunk { … }` / `run …`) nested inside that text.
 */
export type TsExpressionPart =
  | {
      readonly kind: "text";
      readonly text: string;
      readonly range: Range;
    }
  | {
      readonly kind: "embedded";
      readonly expression: Expression;
    };

/**
 * Hybrid TypeScript expression: mostly opaque text, with optional holes for
 * nested `thunk` / `run` that must be lowered.
 */
export interface TsExpression {
  readonly kind: "TsExpression";
  readonly range: Range;
  /** Full original source span (including any embedded thunk/run text). */
  readonly text: string;
  readonly parts: readonly TsExpressionPart[];
}
