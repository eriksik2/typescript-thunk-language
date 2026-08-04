/**
 * Lower Thunk AST → TypeScript text + source maps.
 */

import type {
  Expression,
  ProtocolDeclaration,
  SourceFile,
  Statement,
  ThunkExpression,
  TypeAnnotation,
  VariableStatement,
} from "./ast";
import { parseThunkSource } from "./parse";
import { encodeThunkTypeAnnotation } from "./protocol-encode";
import type { Mapping, Range, SourceMap } from "./source-map";

export interface LoweredFile {
  readonly fileName: string;
  readonly originalText: string;
  readonly generatedText: string;
  readonly sourceMap: SourceMap;
}

export interface LowerOptions {
  runtimeImportPath?: string;
  typesImportPath?: string;
}

class Emitter {
  private chunks: string[] = [];
  private mappings: Mapping[] = [];
  private line = 0;
  private character = 0;
  private needsTypesImport = false;

  constructor(
    private readonly originalText: string,
    private readonly runtimeImportPath: string,
    private readonly typesImportPath: string,
  ) {}

  emitFile(ast: SourceFile): LoweredFile {
    this.needsTypesImport = fileNeedsTypesImport(ast);

    this.write(
      `import { succeed, defer, bind, execute, use, provide, layerOf, createTag, mergeLayers } from "${this.runtimeImportPath}";\n`,
    );
    if (this.needsTypesImport) {
      this.write(
        `import type { Thunk, Requires, Tag } from "${this.typesImportPath}";\n`,
      );
    }
    this.write("\n");

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
      case "VariableStatement":
        this.emitVariableStatement(stmt);
        return;
      case "ExpressionStatement": {
        this.emitTopLevelExpression(stmt.expression);
        this.write(";\n");
        return;
      }
      case "ProtocolDeclaration":
        this.emitProtocolDeclaration(stmt);
        return;
      case "ReturnStatement":
        throw new Error("return is only valid inside thunk bodies");
    }
  }

  private emitVariableStatement(stmt: VariableStatement): void {
    this.write(`${stmt.declarationKind} `);
    this.writeMapped(stmt.name.name, stmt.name.range);
    if (stmt.typeAnnotation) {
      this.write(": ");
      this.emitTypeAnnotation(stmt.typeAnnotation);
    }
    this.write(" = ");
    this.emitTopLevelExpression(stmt.initializer);
    this.write(";\n");
  }

  private emitTypeAnnotation(ann: TypeAnnotation): void {
    const { typeText } = encodeThunkTypeAnnotation(
      ann.baseText,
      ann.protocols,
    );
    this.writeMapped(typeText, ann.range);
  }

  private emitProtocolDeclaration(decl: ProtocolDeclaration): void {
    const params = decl.typeParams ? `<${decl.typeParams}>` : "";
    this.write(`/** protocol ${decl.name.name} */\n`);
    for (const m of decl.members) {
      const tp = m.typeParams && m.typeParams !== "<>" ? m.typeParams : "";
      const alias = `${decl.name.name}_${m.name}`;
      this.writeMapped(`type ${alias}${tp} = ${m.resultType};\n`, m.range);
    }
    this.writeMapped(
      `type ${decl.name.name}${params} = { readonly __protocol: "${decl.name.name}" };\n`,
      decl.name.range,
    );
    this.write("\n");
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
          this.write(": ");
          this.emitTypeAnnotation(stmt.typeAnnotation);
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
      case "ReturnStatement":
        this.write("return succeed(");
        this.emitValueExpression(stmt.expression);
        this.write(");\n");
        return;
      case "ProtocolDeclaration":
        throw new Error("protocol declarations are only valid at top level");
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

function fileNeedsTypesImport(ast: SourceFile): boolean {
  for (const stmt of ast.statements) {
    if (stmt.kind === "ProtocolDeclaration") return true;
    if (stmt.kind === "VariableStatement" && stmt.typeAnnotation) {
      const { needsTypesImport } = encodeThunkTypeAnnotation(
        stmt.typeAnnotation.baseText,
        stmt.typeAnnotation.protocols,
      );
      if (needsTypesImport || stmt.typeAnnotation.protocols.length > 0) {
        return true;
      }
      if (/Thunk\s*</.test(stmt.typeAnnotation.baseText)) return true;
    }
  }
  return false;
}

export function lowerSourceFile(
  ast: SourceFile,
  options?: LowerOptions,
): LoweredFile {
  const runtimeImportPath = options?.runtimeImportPath ?? "@thunk/runtime";
  const typesImportPath = options?.typesImportPath ?? "@thunk/types";
  return new Emitter(
    ast.text,
    runtimeImportPath,
    typesImportPath,
  ).emitFile(ast);
}

export function lowerThunkSource(
  text: string,
  fileName = "input.thunk",
  options?: LowerOptions,
): LoweredFile {
  return lowerSourceFile(parseThunkSource(text, fileName), options);
}
