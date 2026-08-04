/**
 * Lower Thunk AST → TypeScript text + source maps.
 *
 * - `thunk { body }` → `defer(() => <lowered body>)`
 * - `run expr` inside thunk → `bind(expr, value => …)`
 * - `run expr` at top level → `execute(expr)`
 * - `return expr` at thunk statement-list → `succeed(expr)`
 * - Opaque TsStatement control flow is emitted as-is inside defer/bind bodies
 */

import type { Expression, SourceFile, Statement, ThunkExpression } from "./ast";
import { parseThunkSource } from "./parse";
import type { Mapping, Range, SourceMap } from "./source-map";

export interface LoweredFile {
  readonly fileName: string;
  readonly originalText: string;
  readonly generatedText: string;
  readonly sourceMap: SourceMap;
}

class Emitter {
  private chunks: string[] = [];
  private mappings: Mapping[] = [];
  private line = 0;
  private character = 0;

  constructor(
    private readonly originalText: string,
    private readonly runtimeImportPath: string,
  ) {}

  emitFile(ast: SourceFile): LoweredFile {
    this.write(
      `import { succeed, defer, bind, execute } from "${this.runtimeImportPath}";\n\n`,
    );

    for (const stmt of ast.statements) {
      this.emitTopLevelStatement(stmt);
    }

    return {
      fileName: ast.fileName.replace(/\.thunk$/, ".thunk.ts"),
      originalText: this.originalText,
      generatedText: this.chunks.join(""),
      sourceMap: { mappings: this.mappings },
    };
  }

  private emitTopLevelStatement(stmt: Statement): void {
    switch (stmt.kind) {
      case "VariableStatement": {
        this.write(`${stmt.declarationKind} `);
        this.writeMapped(stmt.name.name, stmt.name.range);
        if (stmt.typeAnnotation) {
          this.write(`: ${stmt.typeAnnotation}`);
        }
        this.write(" = ");
        this.emitTopLevelExpression(stmt.initializer);
        this.write(";\n");
        return;
      }
      case "ExpressionStatement": {
        this.emitTopLevelExpression(stmt.expression);
        this.write(";\n");
        return;
      }
      case "TsStatement": {
        this.writeMapped(stmt.text, stmt.range);
        if (!stmt.text.endsWith("}") && !stmt.text.endsWith(";")) {
          this.write(";");
        }
        this.write("\n");
        return;
      }
      case "ReturnStatement":
        throw new Error("return is only valid inside thunk bodies");
    }
  }

  private emitTopLevelExpression(expr: Expression): void {
    if (expr.kind === "RunExpression") {
      this.write("execute(");
      this.emitValueExpression(expr.expression);
      this.write(")");
      return;
    }
    if (expr.kind === "ThunkExpression") {
      this.emitThunk(expr);
      return;
    }
    this.emitValueExpression(expr);
  }

  private emitThunk(expr: ThunkExpression): void {
    const thunkKeyword: Range = {
      start: expr.range.start,
      end: {
        line: expr.range.start.line,
        character: expr.range.start.character + "thunk".length,
      },
    };
    this.writeMapped("defer", thunkKeyword);
    this.write("(() => ");
    this.emitThunkBody(expr.body);
    this.write(")");
  }

  private emitThunkBody(body: Statement[]): void {
    const runIndex = body.findIndex(isRunBindingStatement);
    if (runIndex === -1) {
      this.emitPureBody(body);
      return;
    }

    const before = body.slice(0, runIndex);
    const runStmt = body[runIndex]!;
    const after = body.slice(runIndex + 1);
    const needsBlock = before.length > 0;

    if (needsBlock) {
      this.write("{\n");
      for (const stmt of before) {
        this.emitOrdinaryStatementInThunk(stmt);
      }
      this.write("return ");
    }

    let bindSource: Expression;
    let bindName: string | undefined;
    let bindNameRange: Range | undefined;

    if (runStmt.kind === "VariableStatement") {
      if (runStmt.initializer.kind !== "RunExpression") {
        throw new Error("expected run initializer");
      }
      bindName = runStmt.name.name;
      bindNameRange = runStmt.name.range;
      bindSource = runStmt.initializer.expression;
    } else if (
      runStmt.kind === "ExpressionStatement" &&
      runStmt.expression.kind === "RunExpression"
    ) {
      bindSource = runStmt.expression.expression;
    } else {
      throw new Error("run must be in statement position");
    }

    this.write("bind(");
    this.emitValueExpression(bindSource);
    this.write(", ");
    if (bindName && bindNameRange) {
      this.writeMapped(bindName, bindNameRange);
    } else {
      this.write("_");
    }
    this.write(" => ");
    this.emitThunkBody(after);
    this.write(")");

    if (needsBlock) {
      this.write(";\n}");
    }
  }

  private emitPureBody(body: Statement[]): void {
    if (body.length === 0) {
      this.write("succeed(undefined as void)");
      return;
    }

    const last = body[body.length - 1]!;
    const before = body.slice(0, -1);

    if (before.length === 0 && last.kind === "ReturnStatement") {
      this.write("succeed(");
      this.emitValueExpression(last.expression);
      this.write(")");
      return;
    }

    this.write("{\n");
    for (const stmt of before) {
      this.emitOrdinaryStatementInThunk(stmt);
    }
    if (last.kind === "ReturnStatement") {
      this.write("return succeed(");
      this.emitValueExpression(last.expression);
      this.write(");\n");
    } else {
      this.emitOrdinaryStatementInThunk(last);
      this.write("return succeed(undefined as void);\n");
    }
    this.write("}");
  }

  private emitOrdinaryStatementInThunk(stmt: Statement): void {
    switch (stmt.kind) {
      case "VariableStatement": {
        if (stmt.initializer.kind === "RunExpression") {
          throw new Error("internal: run should be handled by emitThunkBody");
        }
        this.write(`${stmt.declarationKind} `);
        this.writeMapped(stmt.name.name, stmt.name.range);
        if (stmt.typeAnnotation) {
          this.write(`: ${stmt.typeAnnotation}`);
        }
        this.write(" = ");
        if (stmt.initializer.kind === "ThunkExpression") {
          this.emitThunk(stmt.initializer);
        } else {
          this.emitValueExpression(stmt.initializer);
        }
        this.write(";\n");
        return;
      }
      case "ExpressionStatement": {
        this.emitValueExpression(stmt.expression);
        this.write(";\n");
        return;
      }
      case "TsStatement": {
        this.writeMapped(stmt.text, stmt.range);
        if (!stmt.text.endsWith("}") && !stmt.text.endsWith(";")) {
          this.write(";");
        }
        this.write("\n");
        return;
      }
      case "ReturnStatement":
        this.write("return succeed(");
        this.emitValueExpression(stmt.expression);
        this.write(");\n");
        return;
    }
  }

  private emitValueExpression(expr: Expression): void {
    switch (expr.kind) {
      case "Identifier":
        this.writeMapped(expr.name, expr.range);
        return;
      case "TsExpression":
        this.writeMapped(expr.text, expr.range);
        return;
      case "ThunkExpression":
        this.emitThunk(expr);
        return;
      case "RunExpression":
        this.write("execute(");
        this.emitValueExpression(expr.expression);
        this.write(")");
        return;
    }
  }

  private write(text: string): void {
    for (const ch of text) {
      this.chunks.push(ch);
      if (ch === "\n") {
        this.line++;
        this.character = 0;
      } else {
        this.character++;
      }
    }
  }

  private writeMapped(text: string, original: Range): void {
    const genStart = { line: this.line, character: this.character };
    this.write(text);
    const genEnd = { line: this.line, character: this.character };
    this.mappings.push({
      original,
      generated: { start: genStart, end: genEnd },
      name: text.length < 40 ? text : undefined,
    });
  }
}

function isRunBindingStatement(stmt: Statement): boolean {
  if (stmt.kind === "VariableStatement") {
    return stmt.initializer.kind === "RunExpression";
  }
  if (stmt.kind === "ExpressionStatement") {
    return stmt.expression.kind === "RunExpression";
  }
  return false;
}

export function lowerSourceFile(
  ast: SourceFile,
  options?: { runtimeImportPath?: string },
): LoweredFile {
  const runtimeImportPath = options?.runtimeImportPath ?? "@thunk/runtime";
  return new Emitter(ast.text, runtimeImportPath).emitFile(ast);
}

export function lowerThunkSource(
  text: string,
  fileName = "input.thunk",
  options?: { runtimeImportPath?: string },
): LoweredFile {
  return lowerSourceFile(parseThunkSource(text, fileName), options);
}
