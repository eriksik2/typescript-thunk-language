/**
 * Lower Thunk AST → TypeScript text + source maps.
 */

import type {
  Expression,
  ImportDeclaration,
  ProtocolDeclaration,
  SourceFile,
  Statement,
  SymbolDeclaration,
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
  /** @deprecated Public APIs are no longer auto-imported. */
  runtimeImportPath?: string;
  /** Compiler helpers (`succeed` / `defer` / …). Default `@thunk/runtime/internal`. */
  internalImportPath?: string;
  /** Auto-injected `Thunk` / `Requires`. Default `@thunk/types`. */
  typesImportPath?: string;
}

class Emitter {
  private chunks: string[] = [];
  private mappings: Mapping[] = [];
  private line = 0;
  private character = 0;
  private needsThunkType = false;
  private needsRequiresType = false;
  private needsMakeSymbol = false;

  constructor(
    private readonly originalText: string,
    private readonly internalImportPath: string,
    private readonly typesImportPath: string,
  ) {}

  emitFile(ast: SourceFile): LoweredFile {
    const typesNeeded = fileNeedsTypesImport(ast);
    this.needsThunkType = typesNeeded.thunk;
    this.needsRequiresType = typesNeeded.requires;
    this.needsMakeSymbol = fileHasSymbolDecls(ast);

    const imports = ast.statements.filter(
      (s): s is ImportDeclaration => s.kind === "ImportDeclaration",
    );
    const rest = ast.statements.filter((s) => s.kind !== "ImportDeclaration");

    for (const imp of imports) {
      this.emitImportDeclaration(imp);
    }

    const internalNames = ["succeed", "defer", "bind", "execute"];
    if (this.needsMakeSymbol) {
      internalNames.push("__makeSymbol");
    }
    this.write(
      `import { ${internalNames.join(", ")} } from "${this.internalImportPath}";\n`,
    );

    if (this.needsThunkType || this.needsRequiresType) {
      const typeNames: string[] = [];
      if (this.needsThunkType) typeNames.push("Thunk");
      if (this.needsRequiresType) typeNames.push("Requires");
      this.write(
        `import type { ${typeNames.join(", ")} } from "${this.typesImportPath}";\n`,
      );
    }
    this.write("\n");

    for (const stmt of rest) {
      this.emitTopLevelStatement(stmt);
    }

    return {
      fileName: ast.fileName.replace(/\.thunk$/, ".thunk.ts"),
      originalText: this.originalText,
      generatedText: this.chunks.join(""),
      sourceMap: { mappings: this.mappings },
    };
  }

  private emitImportDeclaration(decl: ImportDeclaration): void {
    this.writeMapped(decl.text, decl.range);
    if (!decl.text.endsWith(";")) this.write(";");
    this.write("\n");
  }

  private emitTopLevelStatement(stmt: Statement): void {
    switch (stmt.kind) {
      case "ImportDeclaration":
        this.emitImportDeclaration(stmt);
        return;
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
      case "SymbolDeclaration":
        this.emitSymbolDeclaration(stmt);
        return;
      case "ReturnStatement":
        throw new Error("return is only valid inside thunk bodies");
    }
  }

  private emitSymbolDeclaration(decl: SymbolDeclaration): void {
    const name = decl.name.name;
    const assoc = decl.associatedType.text;
    const brand = `__brand_${name}`;

    this.write(`declare const ${brand}: unique symbol;\n`);

    // Value first so `typeof Name` is available on the branded type.
    this.write("const ");
    this.writeMapped(name, decl.name.range);
    this.write(" = __makeSymbol<");
    this.writeMapped(assoc, decl.associatedType.range);
    this.write(`>(${JSON.stringify(name)}) as unknown as ((value: `);
    this.writeMapped(assoc, decl.associatedType.range);
    this.write(") => ");
    this.writeMapped(name, decl.name.range);
    this.write(") & { readonly key: symbol; readonly __assoc: ");
    this.writeMapped(assoc, decl.associatedType.range);
    this.write(" };\n");

    this.write("type ");
    this.writeMapped(name, decl.name.range);
    this.write(" = ");
    this.writeMapped(assoc, decl.associatedType.range);
    this.write(
      ` & { readonly [${brand}]: typeof ${brand} } & { readonly __assoc: `,
    );
    this.writeMapped(assoc, decl.associatedType.range);
    this.write(" } & { readonly __symbolIdentity?: typeof ");
    this.writeMapped(name, decl.name.range);
    this.write(" };\n");
    this.write("\n");
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
      case "SymbolDeclaration":
        throw new Error("symbol declarations are only valid at top level");
      case "ImportDeclaration":
        throw new Error("import declarations are only valid at top level");
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

function fileHasSymbolDecls(ast: SourceFile): boolean {
  return ast.statements.some((s) => s.kind === "SymbolDeclaration");
}

function fileNeedsTypesImport(ast: SourceFile): {
  thunk: boolean;
  requires: boolean;
} {
  let thunk = false;
  let requires = false;
  for (const stmt of ast.statements) {
    if (stmt.kind === "ProtocolDeclaration") {
      // Protocol decls may reference types; keep Thunk available if annotated elsewhere.
      continue;
    }
    if (stmt.kind === "VariableStatement" && stmt.typeAnnotation) {
      const { needsTypesImport } = encodeThunkTypeAnnotation(
        stmt.typeAnnotation.baseText,
        stmt.typeAnnotation.protocols,
      );
      if (stmt.typeAnnotation.protocols.some((p) => p.name === "Requires")) {
        requires = true;
        thunk = true;
      }
      if (needsTypesImport || /Thunk\s*</.test(stmt.typeAnnotation.baseText)) {
        thunk = true;
      }
      if (stmt.typeAnnotation.protocols.length > 0) {
        thunk = true;
        if (stmt.typeAnnotation.protocols.some((p) => p.name === "Requires")) {
          requires = true;
        }
      }
    }
  }
  return { thunk, requires };
}

export function lowerSourceFile(
  ast: SourceFile,
  options?: LowerOptions,
): LoweredFile {
  const internalImportPath =
    options?.internalImportPath ?? "@thunk/runtime/internal";
  const typesImportPath = options?.typesImportPath ?? "@thunk/types";
  return new Emitter(
    ast.text,
    internalImportPath,
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
