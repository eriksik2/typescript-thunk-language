/**
 * Lower Thunk AST → TypeScript text + source maps.
 *
 * Thunk bodies with `run` lower to an iterative switch-based state machine
 * (`machine` + `runEffect` + `succeed`), not recursive `bind` continuations.
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

type RunSite =
  | {
      kind: "binding";
      name: string;
      nameRange: Range;
      source: Expression;
      typeAnnotation?: TypeAnnotation;
    }
  | { kind: "discard"; source: Expression }
  | { kind: "return"; source: Expression };

/** One state: ordinary statements, then optional suspending `run`. */
interface MachinePart {
  readonly prelude: Statement[];
  readonly run: RunSite | null;
}

class Emitter {
  private chunks: string[] = [];
  private mappings: Mapping[] = [];
  private line = 0;
  private character = 0;
  private needsThunkType = false;
  private needsRequiresType = false;
  private needsMakeSymbol = false;
  private needsThunkReturnType = false;

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

    // First pass buffer: emit body into a side channel? We need to know
    // needsThunkReturnType before writing imports. Scan AST for runs in thunks.
    this.needsThunkReturnType = fileHasRunInThunk(ast);

    const internalNames = [
      "succeed",
      "defer",
      "runEffect",
      "machine",
      "execute",
    ];
    if (this.needsMakeSymbol) {
      internalNames.push("__makeSymbol");
    }
    this.write(
      `import { ${internalNames.join(", ")} } from "${this.internalImportPath}";\n`,
    );

    if (
      this.needsThunkType ||
      this.needsRequiresType ||
      this.needsThunkReturnType
    ) {
      const typeNames: string[] = [];
      if (this.needsThunkType) typeNames.push("Thunk");
      if (this.needsRequiresType) typeNames.push("Requires");
      if (this.needsThunkReturnType) typeNames.push("ThunkReturnType");
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
    if (!body.some(isRunBindingStatement)) {
      this.emitPureBody(body);
      return;
    }
    this.emitStateMachine(body);
  }

  /**
   * Iterative switch-based state machine:
   *
   *   let __state = 0;
   *   let user: ThunkReturnType<…>;
   *   return machine(function (__resume) {
   *     while (true) {
   *       switch (__state) {
   *         case 0:
   *           __state = 1;
   *           return runEffect(getUser());
   *         case 1:
   *           user = __resume as …;
   *           return succeed(user.name);
   *       }
   *     }
   *   });
   */
  private emitStateMachine(body: Statement[]): void {
    const parts = splitMachineParts(body);
    const runSites = parts
      .map((p) => p.run)
      .filter((r): r is RunSite => r !== null);

    this.write("{\n");
    this.write("let __state = 0;\n");

    // Witnesses + run bindings interleaved so later witnesses may reference
    // earlier resume locals (`getPosts(user.id)`). Ordinary locals next.
    this.emitHoistedLocals(body, runSites);

    this.write("return machine(function (__resume?: any) {\n");
    this.write("while (true) {\n");
    this.write("switch (__state) {\n");

    let runIndex = 0;
    for (let state = 0; state < parts.length; state++) {
      const part = parts[state]!;
      this.write(`case ${state}:\n`);

      // Resume from previous run into its binding (states > 0).
      if (state > 0) {
        const prevRun = parts[state - 1]!.run;
        if (prevRun?.kind === "binding") {
          const t = runIndex - 1;
          this.writeMapped(prevRun.name, prevRun.nameRange);
          this.write(
            ` = __resume as ThunkReturnType<NonNullable<typeof __t${t}>>;\n`,
          );
        } else if (prevRun?.kind === "return") {
          this.write("return succeed(__resume);\n");
          // Still emit break-style unreachable default for exhaustiveness.
          this.write("break;\n");
          continue;
        }
        // discard: ignore __resume
      }

      for (const stmt of part.prelude) {
        this.emitMachineStatement(stmt);
      }

      if (part.run) {
        this.write(`__state = ${state + 1};\n`);
        this.write("return runEffect(");
        this.emitValueExpression(part.run.source);
        this.write(");\n");
        runIndex++;
      } else {
        // Final region — succeed with last return or void.
        this.emitFinalSucceed(part.prelude);
      }
    }

    this.write("default:\n");
    this.write('throw new Error("invalid thunk state");\n');
    this.write("}\n");
    this.write("}\n");
    this.write("});\n");
    this.write("}");
  }

  private emitHoistedLocals(body: Statement[], runSites: RunSite[]): void {
    // Ordinary locals first so early witnesses can close over them if needed.
    for (const stmt of body) {
      if (stmt.kind !== "VariableStatement") continue;
      if (stmt.initializer.kind === "RunExpression") continue;
      this.write("let ");
      this.writeMapped(stmt.name.name, stmt.name.range);
      if (stmt.typeAnnotation) {
        this.write(": ");
        this.emitTypeAnnotation(stmt.typeAnnotation);
      }
      this.write(";\n");
    }

    // Each run: dead type witness, then typed `let` for the binding (if any).
    runSites.forEach((run, i) => {
      this.write(`const __t${i} = false ? `);
      this.emitValueExpression(run.source);
      this.write(" : undefined;\n");
      if (run.kind === "binding") {
        this.write("let ");
        this.writeMapped(run.name, run.nameRange);
        if (run.typeAnnotation) {
          this.write(": ");
          this.emitTypeAnnotation(run.typeAnnotation);
        } else {
          this.write(
            `: ThunkReturnType<NonNullable<typeof __t${i}>>`,
          );
        }
        this.write(";\n");
      }
    });
  }

  private emitMachineStatement(stmt: Statement): void {
    switch (stmt.kind) {
      case "VariableStatement": {
        if (stmt.initializer.kind === "RunExpression") {
          throw new Error("internal: run should be a machine part boundary");
        }
        this.writeMapped(stmt.name.name, stmt.name.range);
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
        // Returns in prelude of a non-final part are unusual; treat as succeed.
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

  /**
   * Final state succeed. Prelude was already emitted; if it contained a
   * `return`, that emitted `return succeed(...)`. Otherwise succeed void.
   * When the last prelude stmt was a return we already returned; detect via
   * re-scan — actually emitFinalSucceed is only called when run is null,
   * and we've already emitted all prelude stmts. So if the last stmt was
   * ReturnStatement, we already emitted return succeed. If not, emit void.
   */
  private emitFinalSucceed(prelude: Statement[]): void {
    const last = prelude[prelude.length - 1];
    if (last?.kind === "ReturnStatement") {
      // Already emitted as return succeed in emitMachineStatement.
      return;
    }
    this.write("return succeed(undefined as void);\n");
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
          throw new Error("internal: run should be handled by state machine");
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
        for (const part of expr.parts) {
          if (part.kind === "text") {
            this.writeMapped(part.text, part.range);
          } else {
            this.emitValueExpression(part.expression);
          }
        }
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

function splitMachineParts(body: Statement[]): MachinePart[] {
  const parts: MachinePart[] = [];
  let prelude: Statement[] = [];
  for (const stmt of body) {
    const run = runSiteOf(stmt);
    if (run) {
      parts.push({ prelude, run });
      prelude = [];
    } else {
      prelude.push(stmt);
    }
  }
  parts.push({ prelude, run: null });
  return parts;
}

function runSiteOf(stmt: Statement): RunSite | null {
  if (stmt.kind === "VariableStatement") {
    if (stmt.initializer.kind !== "RunExpression") return null;
    return {
      kind: "binding",
      name: stmt.name.name,
      nameRange: stmt.name.range,
      source: stmt.initializer.expression,
      typeAnnotation: stmt.typeAnnotation,
    };
  }
  if (
    stmt.kind === "ExpressionStatement" &&
    stmt.expression.kind === "RunExpression"
  ) {
    return { kind: "discard", source: stmt.expression.expression };
  }
  if (
    stmt.kind === "ReturnStatement" &&
    stmt.expression.kind === "RunExpression"
  ) {
    return { kind: "return", source: stmt.expression.expression };
  }
  return null;
}

function isRunBindingStatement(stmt: Statement): boolean {
  return runSiteOf(stmt) !== null;
}

function fileHasSymbolDecls(ast: SourceFile): boolean {
  return ast.statements.some((s) => s.kind === "SymbolDeclaration");
}

function fileHasRunInThunk(ast: SourceFile): boolean {
  return walkHasRun(ast.statements);
}

function walkHasRun(stmts: Statement[]): boolean {
  for (const stmt of stmts) {
    if (isRunBindingStatement(stmt)) return true;
    if (stmt.kind === "VariableStatement") {
      if (exprHasRun(stmt.initializer)) return true;
    } else if (stmt.kind === "ExpressionStatement") {
      if (exprHasRun(stmt.expression)) return true;
    } else if (stmt.kind === "ReturnStatement") {
      if (exprHasRun(stmt.expression)) return true;
    }
  }
  return false;
}

function exprHasRun(expr: Expression): boolean {
  switch (expr.kind) {
    case "RunExpression":
      return true;
    case "ThunkExpression":
      return walkHasRun(expr.body);
    case "TsExpression":
      return expr.parts.some(
        (p) => p.kind === "embedded" && exprHasRun(p.expression),
      );
    case "Identifier":
      return false;
  }
}

function fileNeedsTypesImport(ast: SourceFile): {
  thunk: boolean;
  requires: boolean;
} {
  let thunk = false;
  let requires = false;
  for (const stmt of ast.statements) {
    if (stmt.kind === "ProtocolDeclaration") {
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
