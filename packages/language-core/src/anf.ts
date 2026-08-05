/**
 * ANF normalization: lift expression-position `run` to statement
 * `const __rN = run …` so the state-machine lowerer only sees statement-shaped
 * run sites.
 */

import type {
  Expression,
  ExpressionStatement,
  Identifier,
  Statement,
  TsExpression,
  TsExpressionPart,
  VariableStatement,
} from "./ast";
import type { Range } from "./source-map";

export function normalizeAnf(body: readonly Statement[]): Statement[] {
  const ctx = { nextId: 0 };
  const out: Statement[] = [];
  for (const stmt of body) {
    out.push(...normalizeStatement(stmt, ctx));
  }
  return out;
}

type AnfCtx = { nextId: number };

function normalizeStatement(stmt: Statement, ctx: AnfCtx): Statement[] {
  const lifted: Statement[] = [];
  const lift = (expr: Expression): Expression =>
    liftRuns(expr, false, lifted, ctx);

  switch (stmt.kind) {
    case "VariableStatement": {
      const init = stmt.initializer;
      if (init.kind === "RunExpression") {
        const inner = liftRuns(init.expression, false, lifted, ctx);
        const next: VariableStatement = {
          ...stmt,
          initializer: { ...init, expression: inner },
        };
        return [...lifted, next];
      }
      const initializer = lift(init);
      return [...lifted, { ...stmt, initializer }];
    }
    case "ReturnStatement": {
      if (!stmt.expression) return [...lifted, stmt];
      if (stmt.expression.kind === "RunExpression") {
        const inner = liftRuns(
          stmt.expression.expression,
          false,
          lifted,
          ctx,
        );
        return [
          ...lifted,
          {
            ...stmt,
            expression: { ...stmt.expression, expression: inner },
          },
        ];
      }
      const expression = lift(stmt.expression);
      return [...lifted, { ...stmt, expression }];
    }
    case "ExpressionStatement": {
      if (stmt.expression.kind === "RunExpression") {
        const inner = liftRuns(
          stmt.expression.expression,
          false,
          lifted,
          ctx,
        );
        const next: ExpressionStatement = {
          ...stmt,
          expression: { ...stmt.expression, expression: inner },
        };
        return [...lifted, next];
      }
      const expression = lift(stmt.expression);
      return [...lifted, { ...stmt, expression }];
    }
    case "BlockStatement":
      return [
        ...lifted,
        { ...stmt, statements: normalizeAnf(stmt.statements) },
      ];
    case "IfStatement": {
      const condition = lift(stmt.condition);
      const consequent = asBlock(
        normalizeStatement(stmt.consequent, ctx),
        stmt.consequent.range,
      );
      const alternate = stmt.alternate
        ? asBlock(
            normalizeStatement(stmt.alternate, ctx),
            stmt.alternate.range,
          )
        : undefined;
      return [
        ...lifted,
        { ...stmt, condition, consequent, alternate },
      ];
    }
    case "WhileStatement": {
      // Re-evaluate expression-position `run` each iteration by rewriting
      // `while (cond) body` → `while (true) { const __rN = …; if (!__rN) break; body }`
      // when `cond` contains a nested run.
      if (expressionContainsRun(stmt.condition)) {
        const condLifted: Statement[] = [];
        const condition = liftRuns(stmt.condition, false, condLifted, ctx);
        const bodyNorm = normalizeStatement(stmt.body, ctx);
        const breakIf: Statement = {
          kind: "IfStatement",
          range: stmt.condition.range,
          condition: {
            kind: "TsExpression",
            range: stmt.condition.range,
            text: `!(${conditionText(condition)})`,
            parts: [
              {
                kind: "text",
                text: `!(${conditionText(condition)})`,
                range: stmt.condition.range,
              },
            ],
          },
          consequent: {
            kind: "BreakStatement",
            range: stmt.condition.range,
          },
        };
        const trueCond: Expression = {
          kind: "TsExpression",
          range: stmt.condition.range,
          text: "true",
          parts: [
            {
              kind: "text",
              text: "true",
              range: stmt.condition.range,
            },
          ],
        };
        const loopBody: Statement = {
          kind: "BlockStatement",
          range: stmt.body.range,
          statements: [...condLifted, breakIf, ...bodyNorm],
        };
        return [
          ...lifted,
          { ...stmt, condition: trueCond, body: loopBody },
        ];
      }
      const condition = lift(stmt.condition);
      const body = asBlock(
        normalizeStatement(stmt.body, ctx),
        stmt.body.range,
      );
      return [...lifted, { ...stmt, condition, body }];
    }
    case "ForStatement": {
      let initializer = stmt.initializer;
      const initLifted: Statement[] = [];
      if (initializer) {
        const parts = normalizeStatement(initializer, ctx);
        if (parts.length > 0) {
          initLifted.push(...parts.slice(0, -1));
          initializer = parts[parts.length - 1] as NonNullable<
            typeof initializer
          >;
        }
      }
      const condition = stmt.condition ? lift(stmt.condition) : undefined;
      const update = stmt.update ? lift(stmt.update) : undefined;
      const body = asBlock(
        normalizeStatement(stmt.body, ctx),
        stmt.body.range,
      );
      return [
        ...lifted,
        ...initLifted,
        { ...stmt, initializer, condition, update, body },
      ];
    }
    case "BreakStatement":
    case "ContinueStatement":
    case "ImportDeclaration":
    case "ProtocolDeclaration":
    case "SymbolDeclaration":
    case "TypeAliasDeclaration":
      return [...lifted, stmt];
  }
}

function asBlock(stmts: Statement[], range: Range): Statement {
  if (stmts.length === 1) return stmts[0]!;
  return { kind: "BlockStatement", range, statements: stmts };
}

function expressionContainsRun(expr: Expression): boolean {
  switch (expr.kind) {
    case "RunExpression":
      return true;
    case "PipeExpression":
    case "AndExpression":
      return (
        expressionContainsRun(expr.left) ||
        expressionContainsRun(expr.right)
      );
    case "MatchExpression":
      return (
        expressionContainsRun(expr.scrutinee) ||
        expr.arms.some((a) => expressionContainsRun(a.expression))
      );
    case "IsExpression":
      return expressionContainsRun(expr.scrutinee);
    case "ThunkExpression":
      return false;
    case "Identifier":
      return false;
    case "TsExpression":
      return expr.parts.some(
        (p) => p.kind === "embedded" && expressionContainsRun(p.expression),
      );
  }
}

function conditionText(expr: Expression): string {
  switch (expr.kind) {
    case "Identifier":
      return expr.name;
    case "TsExpression":
      return expr.text;
    case "RunExpression":
      return `run ${conditionText(expr.expression)}`;
    case "PipeExpression":
      return `(${conditionText(expr.left)} | ${conditionText(expr.right)})`;
    case "AndExpression":
      return `(${conditionText(expr.left)} && ${conditionText(expr.right)})`;
    case "IsExpression":
      return `${conditionText(expr.scrutinee)} is …`;
    case "MatchExpression":
      return `match (…)`;
    case "ThunkExpression":
      return "thunk { … }";
  }
}

function liftRuns(
  expr: Expression,
  stmtRunRoot: boolean,
  lifted: Statement[],
  ctx: AnfCtx,
): Expression {
  switch (expr.kind) {
    case "RunExpression": {
      const inner = liftRuns(expr.expression, false, lifted, ctx);
      const runExpr = { ...expr, expression: inner };
      if (stmtRunRoot) return runExpr;
      const name = `__r${ctx.nextId++}`;
      const id: Identifier = {
        kind: "Identifier",
        name,
        range: expr.range,
      };
      const binding: VariableStatement = {
        kind: "VariableStatement",
        range: expr.range,
        declarationKind: "const",
        name: id,
        initializer: runExpr,
      };
      lifted.push(binding);
      return id;
    }
    case "PipeExpression":
    case "AndExpression":
      return {
        ...expr,
        left: liftRuns(expr.left, false, lifted, ctx),
        right: liftRuns(expr.right, false, lifted, ctx),
      };
    case "MatchExpression":
      // Lift only the scrutinee. Arms must not contain `run` (v1).
      return {
        ...expr,
        scrutinee: liftRuns(expr.scrutinee, false, lifted, ctx),
      };
    case "IsExpression":
      return {
        ...expr,
        scrutinee: liftRuns(expr.scrutinee, false, lifted, ctx),
      };
    case "ThunkExpression":
      return expr;
    case "TsExpression":
      return liftTsExpression(expr, lifted, ctx);
    case "Identifier":
      return expr;
  }
}

function liftTsExpression(
  expr: TsExpression,
  lifted: Statement[],
  ctx: AnfCtx,
): TsExpression {
  let changed = false;
  const parts: TsExpressionPart[] = [];
  for (const part of expr.parts) {
    if (part.kind === "text") {
      parts.push(part);
      continue;
    }
    const next = liftRuns(part.expression, false, lifted, ctx);
    if (next !== part.expression) changed = true;
    if (next.kind === "Identifier") {
      parts.push({
        kind: "text",
        text: next.name,
        range: next.range,
      });
      changed = true;
    } else {
      parts.push({ kind: "embedded", expression: next });
    }
  }
  if (!changed) return expr;
  const merged = mergeTextParts(parts);
  return {
    ...expr,
    parts: merged,
    text: merged.map((p) => (p.kind === "text" ? p.text : "")).join(""),
  };
}

function mergeTextParts(
  parts: readonly TsExpressionPart[],
): TsExpressionPart[] {
  const out: TsExpressionPart[] = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    if (part.kind === "text" && prev?.kind === "text") {
      out[out.length - 1] = {
        kind: "text",
        text: prev.text + part.text,
        range: { start: prev.range.start, end: part.range.end },
      };
    } else {
      out.push(part);
    }
  }
  return out;
}
