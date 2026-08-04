/**
 * Lower Thunk AST → TypeScript text + source maps.
 *
 * Thunk bodies with `run` lower to an iterative switch-based state machine
 * (`machine` + `runEffect` + `succeed`). Control flow (`if` / `while` / `for` /
 * `break` / `continue`) becomes explicit state transitions.
 */

import type {
  Expression,
  ExpressionStatement,
  ImportDeclaration,
  ProtocolDeclaration,
  SourceFile,
  Statement,
  SymbolDeclaration,
  ThunkExpression,
  TypeAnnotation,
  VariableStatement,
} from "./ast";
import { normalizeAnf } from "./anf";
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
      witnessIndex: number;
    }
  | { kind: "discard"; source: Expression; witnessIndex: number }
  | { kind: "return"; source: Expression; witnessIndex: number };

type Terminator =
  | { kind: "goto"; target: number }
  | {
      kind: "branch";
      condition: Expression;
      thenTarget: number;
      elseTarget: number;
    }
  | { kind: "run"; run: RunSite; next: number }
  | { kind: "succeed"; expression: Expression }
  | { kind: "succeedResume" }
  | { kind: "succeedVoid" };

interface BasicBlock {
  id: number;
  /** If this block is entered by resuming a `run`, assign the binding first. */
  resume?: RunSite;
  body: Statement[];
  term: Terminator;
}

class CfgBuilder {
  readonly blocks: BasicBlock[] = [];
  readonly runSites: RunSite[] = [];
  private loopStack: { continueTarget: number; breakTarget: number }[] = [];

  newBlock(): number {
    const id = this.blocks.length;
    this.blocks.push({
      id,
      body: [],
      term: { kind: "goto", target: -1 },
    });
    return id;
  }

  block(id: number): BasicBlock {
    return this.blocks[id]!;
  }

  setTerm(id: number, term: Terminator): void {
    this.block(id).term = term;
  }

  append(id: number, stmt: Statement): void {
    this.block(id).body.push(stmt);
  }

  compileOne(stmt: Statement, block: number, after: number): void {
    switch (stmt.kind) {
      case "BlockStatement":
        compileSeq(this, stmt.statements, block, after);
        return;

      case "IfStatement": {
        const thenB = this.newBlock();
        const elseB = stmt.alternate ? this.newBlock() : after;
        this.setTerm(block, {
          kind: "branch",
          condition: stmt.condition,
          thenTarget: thenB,
          elseTarget: elseB,
        });
        this.compileStmt(stmt.consequent, thenB, after);
        if (stmt.alternate) {
          this.compileStmt(stmt.alternate, elseB, after);
        }
        return;
      }

      case "WhileStatement": {
        const head =
          this.block(block).body.length > 0 || this.block(block).resume
            ? this.newBlock()
            : block;
        if (head !== block) {
          this.setTerm(block, { kind: "goto", target: head });
        }
        const bodyB = this.newBlock();
        this.setTerm(head, {
          kind: "branch",
          condition: stmt.condition,
          thenTarget: bodyB,
          elseTarget: after,
        });
        this.loopStack.push({ continueTarget: head, breakTarget: after });
        this.compileStmt(stmt.body, bodyB, head);
        this.loopStack.pop();
        return;
      }

      case "ForStatement": {
        if (stmt.initializer) {
          this.append(block, stmt.initializer);
        }
        const head = this.newBlock();
        this.setTerm(block, { kind: "goto", target: head });
        const bodyB = this.newBlock();
        const updateB = this.newBlock();
        if (stmt.condition) {
          this.setTerm(head, {
            kind: "branch",
            condition: stmt.condition,
            thenTarget: bodyB,
            elseTarget: after,
          });
        } else {
          this.setTerm(head, { kind: "goto", target: bodyB });
        }
        this.loopStack.push({
          continueTarget: updateB,
          breakTarget: after,
        });
        this.compileStmt(stmt.body, bodyB, updateB);
        this.loopStack.pop();
        if (stmt.update) {
          this.append(updateB, {
            kind: "ExpressionStatement",
            range: stmt.range,
            expression: stmt.update,
          });
        }
        this.setTerm(updateB, { kind: "goto", target: head });
        return;
      }

      case "BreakStatement": {
        const loop = this.loopStack[this.loopStack.length - 1];
        if (!loop) throw new Error("break outside of loop");
        this.setTerm(block, { kind: "goto", target: loop.breakTarget });
        return;
      }

      case "ContinueStatement": {
        const loop = this.loopStack[this.loopStack.length - 1];
        if (!loop) throw new Error("continue outside of loop");
        this.setTerm(block, { kind: "goto", target: loop.continueTarget });
        return;
      }

      case "ReturnStatement": {
        const run = runSiteOf(stmt, this.runSites.length);
        if (run) {
          this.runSites.push(run);
          const resumeB = this.newBlock();
          this.block(resumeB).resume = run;
          this.setTerm(block, { kind: "run", run, next: resumeB });
          this.setTerm(resumeB, { kind: "succeedResume" });
          return;
        }
        this.setTerm(block, {
          kind: "succeed",
          expression: stmt.expression,
        });
        return;
      }

      case "VariableStatement":
      case "ExpressionStatement": {
        const run = runSiteOf(stmt, this.runSites.length);
        if (!run) {
          throw new Error("internal: ordinary stmt in compileOne");
        }
        this.runSites.push(run);
        this.block(after).resume = run;
        this.setTerm(block, { kind: "run", run, next: after });
        return;
      }

      case "ImportDeclaration":
      case "ProtocolDeclaration":
      case "SymbolDeclaration":
        throw new Error(`${stmt.kind} is only valid at top level`);
    }
  }

  private compileStmt(stmt: Statement, entry: number, exit: number): void {
    if (stmt.kind === "BlockStatement") {
      compileSeq(this, stmt.statements, entry, exit);
      return;
    }
    if (isOrdinaryStmt(stmt)) {
      this.append(entry, stmt);
      this.setTerm(entry, { kind: "goto", target: exit });
      return;
    }
    this.compileOne(stmt, entry, exit);
  }
}

function buildCfg(body: Statement[]): CfgBuilder {
  const b = new CfgBuilder();
  const entry = b.newBlock();
  const exit = b.newBlock();
  compileSeq(b, body, entry, exit);
  b.setTerm(exit, { kind: "succeedVoid" });
  pruneUnreachable(b, entry);
  return b;
}

/** Drop blocks not reachable from entry so dead `succeed(void)` does not
 *  pollute `machine` yield inference (`string | void`). */
function pruneUnreachable(b: CfgBuilder, entry: number): void {
  const reachable = new Set<number>();
  const stack = [entry];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const term = b.block(id).term;
    for (const t of terminatorTargets(term)) {
      stack.push(t);
    }
  }

  if (reachable.size === b.blocks.length) return;

  // Remap surviving block ids to a dense 0..n range.
  const sorted = [...reachable].sort((a, c) => a - c);
  const remap = new Map<number, number>();
  sorted.forEach((old, i) => remap.set(old, i));

  const oldBlocks = b.blocks.slice();
  b.blocks.length = 0;
  for (const oldId of sorted) {
    const block = oldBlocks[oldId]!;
    block.id = remap.get(oldId)!;
    block.term = remapTerminator(block.term, remap);
    b.blocks.push(block);
  }
}

function terminatorTargets(term: Terminator): number[] {
  switch (term.kind) {
    case "goto":
      return [term.target];
    case "branch":
      return [term.thenTarget, term.elseTarget];
    case "run":
      return [term.next];
    case "succeed":
    case "succeedResume":
    case "succeedVoid":
      return [];
  }
}

function remapTerminator(
  term: Terminator,
  remap: Map<number, number>,
): Terminator {
  switch (term.kind) {
    case "goto":
      return { kind: "goto", target: remap.get(term.target)! };
    case "branch":
      return {
        kind: "branch",
        condition: term.condition,
        thenTarget: remap.get(term.thenTarget)!,
        elseTarget: remap.get(term.elseTarget)!,
      };
    case "run":
      return {
        kind: "run",
        run: term.run,
        next: remap.get(term.next)!,
      };
    default:
      return term;
  }
}

function compileSeq(
  b: CfgBuilder,
  stmts: Statement[],
  entry: number,
  exit: number,
): void {
  if (stmts.length === 0) {
    b.setTerm(entry, { kind: "goto", target: exit });
    return;
  }

  let block = entry;
  let i = 0;
  while (i < stmts.length) {
    const stmt = stmts[i]!;

    if (isOrdinaryStmt(stmt)) {
      const ordinary: Statement[] = [];
      while (i < stmts.length && isOrdinaryStmt(stmts[i]!)) {
        ordinary.push(stmts[i]!);
        i++;
      }
      for (const s of ordinary) {
        b.append(block, s);
      }
      if (i >= stmts.length) {
        b.setTerm(block, { kind: "goto", target: exit });
      }
      continue;
    }

    const rest = stmts.slice(i + 1);
    const after = rest.length > 0 ? b.newBlock() : exit;
    b.compileOne(stmt, block, after);
    if (rest.length > 0) {
      compileSeq(b, rest, after, exit);
    }
    return;
  }
}

function isOrdinaryStmt(stmt: Statement): boolean {
  if (stmt.kind === "VariableStatement") {
    return stmt.initializer.kind !== "RunExpression";
  }
  if (stmt.kind === "ExpressionStatement") {
    return stmt.expression.kind !== "RunExpression";
  }
  return false;
}

class Emitter {
  private chunks: string[] = [];
  private mappings: Mapping[] = [];
  private line = 0;
  private character = 0;
  private needsThunkType = false;
  private needsRequiresType = false;
  private needsAsyncType = false;
  private needsMakeSymbol = false;
  private needsThunkReturnType = false;
  private needsSymbolType = false;
  /** Same-file symbol name → resolved associated type text. */
  private readonly symbolAssoc = new Map<string, string>();
  /** Same-file symbol decls by name (for parent brand chaining). */
  private readonly symbolDecls = new Map<string, SymbolDeclaration>();

  constructor(
    private readonly originalText: string,
    private readonly internalImportPath: string,
    private readonly typesImportPath: string,
  ) {}

  emitFile(ast: SourceFile): LoweredFile {
    const typesNeeded = fileNeedsTypesImport(ast);
    this.needsThunkType = typesNeeded.thunk;
    this.needsRequiresType = typesNeeded.requires;
    this.needsAsyncType = typesNeeded.async;
    this.needsMakeSymbol = fileHasSymbolDecls(ast);
    this.needsThunkReturnType = fileHasRunInThunk(ast);
    this.collectSymbolDecls(ast);

    const imports = ast.statements.filter(
      (s): s is ImportDeclaration => s.kind === "ImportDeclaration",
    );
    const rest = ast.statements.filter((s) => s.kind !== "ImportDeclaration");

    for (const imp of imports) {
      this.emitImportDeclaration(imp);
    }

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
      this.needsAsyncType ||
      this.needsThunkReturnType ||
      this.needsSymbolType
    ) {
      const typeNames: string[] = [];
      if (this.needsThunkType) typeNames.push("Thunk");
      if (this.needsRequiresType) typeNames.push("Requires");
      if (this.needsAsyncType) typeNames.push("Async");
      if (this.needsThunkReturnType) typeNames.push("ThunkReturnType");
      if (this.needsSymbolType) typeNames.push("SymbolType");
      this.write(
        `import type { ${typeNames.join(", ")} } from "${this.typesImportPath}";\n`,
      );
    }
    this.write("\n");

    const anfRest = normalizeAnf(rest);
    for (const stmt of anfRest) {
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
      case "BlockStatement":
      case "IfStatement":
      case "WhileStatement":
      case "ForStatement":
      case "BreakStatement":
      case "ContinueStatement":
        throw new Error(`${stmt.kind} is only valid inside thunk bodies`);
    }
  }

  private collectSymbolDecls(ast: SourceFile): void {
    for (const stmt of ast.statements) {
      if (stmt.kind !== "SymbolDeclaration") continue;
      this.symbolDecls.set(stmt.name.name, stmt);
    }
    for (const stmt of ast.statements) {
      if (stmt.kind !== "SymbolDeclaration") continue;
      this.symbolAssoc.set(stmt.name.name, this.resolveAssocText(stmt));
    }
  }

  /** Resolved associated type text (parent merge + extras). */
  private resolveAssocText(decl: SymbolDeclaration): string {
    const extra = decl.associatedType?.text;
    const emptyExtra =
      !extra || (decl.associatedType?.form === "object" && extra.replace(/\s/g, "") === "{}");

    if (decl.extendsName) {
      const parentName = decl.extendsName.name;
      const parentAssoc =
        this.symbolAssoc.get(parentName) ??
        (() => {
          this.needsSymbolType = true;
          return `SymbolType<typeof ${parentName}>`;
        })();
      if (emptyExtra) return parentAssoc;
      return `${parentAssoc} & ${extra}`;
    }

    if (!decl.associatedType) {
      throw new Error(
        `symbol ${decl.name.name} requires an associated type or extends clause`,
      );
    }
    return decl.associatedType.text;
  }

  private emitSymbolDeclaration(decl: SymbolDeclaration): void {
    const name = decl.name.name;
    const assoc = this.symbolAssoc.get(name) ?? this.resolveAssocText(decl);
    const brand = `__brand_${name}`;
    const parentName = decl.extendsName?.name;
    const assocRange = decl.associatedType?.range ?? decl.name.range;

    this.write(`declare const ${brand}: unique symbol;\n`);
    this.write("const ");
    this.writeMapped(name, decl.name.range);

    // Runtime identity
    this.write(" = __makeSymbol<");
    this.writeMapped(assoc, assocRange);
    this.write(`>(${JSON.stringify(name)}`);
    if (decl.isAbstract || parentName) {
      this.write(", {");
      if (decl.isAbstract) this.write(" abstract: true,");
      if (parentName) {
        this.write(" parent: ");
        this.writeMapped(parentName, decl.extendsName!.range);
        this.write(",");
      }
      this.write(" }");
    }
    this.write(") as unknown as ");

    if (decl.isAbstract) {
      this.write("{ readonly key: symbol; readonly __assoc: ");
      this.writeMapped(assoc, assocRange);
      this.write('; readonly __thunkSymbol?: "ThunkSymbol"; readonly __abstract: true');
      if (parentName) {
        this.write("; readonly __parent?: typeof ");
        this.writeMapped(parentName, decl.extendsName!.range);
      }
      this.write(" }");
    } else {
      this.write("((value: ");
      this.writeMapped(assoc, assocRange);
      this.write(") => ");
      this.writeMapped(name, decl.name.range);
      this.write(") & { readonly key: symbol; readonly __assoc: ");
      this.writeMapped(assoc, assocRange);
      this.write(" }");
      if (parentName) {
        this.write(" & { readonly __parent?: typeof ");
        this.writeMapped(parentName, decl.extendsName!.range);
        this.write(" }");
      }
    }
    this.write(";\n");

    // Branded type — own brand only (no parent intersection / no value LSP).
    // Associated type still merges parent fields for the payload shape.
    this.write("type ");
    this.writeMapped(name, decl.name.range);
    this.write(" = ");
    this.writeMapped(assoc, assocRange);
    this.write(" & ");
    this.write(
      `{ readonly [${brand}]: typeof ${brand} } & { readonly __assoc: `,
    );
    this.writeMapped(assoc, assocRange);
    this.write(" }");
    // IdentityCarrier only on non-abstract symbols (leaf branding)
    if (!decl.isAbstract) {
      this.write(" & { readonly __symbolIdentity?: typeof ");
      this.writeMapped(name, decl.name.range);
      this.write(" }");
    }
    this.write(";\n");
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
    const normalized = normalizeAnf(body);
    if (!bodyContainsRun(normalized)) {
      this.emitPureBody(normalized);
      return;
    }
    this.emitStateMachine(normalized);
  }

  private emitStateMachine(body: Statement[]): void {
    const cfg = buildCfg(body);
    const runSites = cfg.runSites;

    this.write("{\n");
    this.write("let __state = 0;\n");
    this.emitHoistedLocals(body, runSites);

    this.write("return machine(function (__resume?: any) {\n");
    this.write("while (true) {\n");
    this.write("switch (__state) {\n");

    for (const block of cfg.blocks) {
      this.write(`case ${block.id}:\n`);
      if (block.resume?.kind === "binding") {
        this.writeMapped(block.resume.name, block.resume.nameRange);
        this.write(
          ` = __resume as ThunkReturnType<NonNullable<typeof __t${block.resume.witnessIndex}>>;\n`,
        );
      }
      for (const stmt of block.body) {
        this.emitMachineStatement(stmt);
      }
      this.emitTerminator(block.term);
    }

    this.write("default:\n");
    this.write('throw new Error("invalid thunk state");\n');
    this.write("}\n");
    this.write("}\n");
    this.write("});\n");
    this.write("}");
  }

  private emitTerminator(term: Terminator): void {
    switch (term.kind) {
      case "goto":
        this.write(`__state = ${term.target};\n`);
        this.write("continue;\n");
        return;
      case "branch":
        this.write("if (");
        this.emitValueExpression(term.condition);
        this.write(") {\n");
        this.write(`__state = ${term.thenTarget};\n`);
        this.write("continue;\n");
        this.write("} else {\n");
        this.write(`__state = ${term.elseTarget};\n`);
        this.write("continue;\n");
        this.write("}\n");
        return;
      case "run":
        this.write(`__state = ${term.next};\n`);
        this.write("return runEffect(");
        this.emitValueExpression(term.run.source);
        this.write(");\n");
        return;
      case "succeed":
        this.write("return succeed(");
        this.emitValueExpression(term.expression);
        this.write(");\n");
        return;
      case "succeedResume":
        this.write("return succeed(__resume);\n");
        return;
      case "succeedVoid":
        this.write("return succeed(undefined as void);\n");
        return;
    }
  }

  private emitHoistedLocals(body: Statement[], runSites: RunSite[]): void {
    const ordinary: VariableStatement[] = [];
    collectOrdinaryVars(body, ordinary);

    for (const stmt of ordinary) {
      this.write("let ");
      this.writeMapped(stmt.name.name, stmt.name.range);
      if (stmt.typeAnnotation) {
        this.write(": ");
        this.emitTypeAnnotation(stmt.typeAnnotation);
      }
      this.write(";\n");
    }

    for (const run of runSites) {
      this.write(`const __t${run.witnessIndex} = false ? `);
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
            `: ThunkReturnType<NonNullable<typeof __t${run.witnessIndex}>>`,
          );
        }
        this.write(";\n");
      }
    }
  }

  private emitMachineStatement(stmt: Statement): void {
    switch (stmt.kind) {
      case "VariableStatement": {
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
      default:
        throw new Error(
          `internal: ${stmt.kind} should not appear in basic-block body`,
        );
    }
  }

  private emitPureBody(body: Statement[]): void {
    // Pure bodies may still contain if/while/for — emit as ordinary JS in a
    // deferred factory (no machine needed when there is no `run`).
    if (body.length === 0) {
      this.write("succeed(undefined as void)");
      return;
    }

    const last = body[body.length - 1]!;
    const before = body.slice(0, -1);

    if (
      before.length === 0 &&
      last.kind === "ReturnStatement" &&
      last.expression.kind !== "RunExpression"
    ) {
      this.write("succeed(");
      this.emitValueExpression(last.expression);
      this.write(")");
      return;
    }

    this.write("{\n");
    for (const stmt of before) {
      this.emitPureStatement(stmt);
    }
    if (last.kind === "ReturnStatement") {
      this.write("return succeed(");
      this.emitValueExpression(last.expression);
      this.write(");\n");
    } else {
      this.emitPureStatement(last);
      // If/else chains that return on every branch should not widen the yield
      // type with `succeed(undefined as void)`.
      if (
        last.kind === "IfStatement" ||
        last.kind === "BlockStatement" ||
        last.kind === "WhileStatement" ||
        last.kind === "ForStatement"
      ) {
        this.write('throw new Error("unreachable");\n');
      } else {
        this.write("return succeed(undefined as void);\n");
      }
    }
    this.write("}");
  }

  private emitPureStatement(stmt: Statement): void {
    switch (stmt.kind) {
      case "VariableStatement": {
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
      case "BlockStatement":
        this.write("{\n");
        for (const s of stmt.statements) this.emitPureStatement(s);
        this.write("}\n");
        return;
      case "IfStatement":
        this.write("if (");
        this.emitValueExpression(stmt.condition);
        this.write(") ");
        this.emitPureStatement(stmt.consequent);
        if (stmt.alternate) {
          this.write(" else ");
          this.emitPureStatement(stmt.alternate);
        }
        return;
      case "WhileStatement":
        this.write("while (");
        this.emitValueExpression(stmt.condition);
        this.write(") ");
        this.emitPureStatement(stmt.body);
        return;
      case "ForStatement": {
        this.write("for (");
        if (stmt.initializer) {
          if (stmt.initializer.kind === "VariableStatement") {
            const v = stmt.initializer;
            this.write(`${v.declarationKind} `);
            this.writeMapped(v.name.name, v.name.range);
            this.write(" = ");
            this.emitValueExpression(v.initializer);
          } else {
            this.emitValueExpression(stmt.initializer.expression);
          }
        }
        this.write("; ");
        if (stmt.condition) this.emitValueExpression(stmt.condition);
        this.write("; ");
        if (stmt.update) this.emitValueExpression(stmt.update);
        this.write(") ");
        this.emitPureStatement(stmt.body);
        return;
      }
      case "BreakStatement":
        this.write("break;\n");
        return;
      case "ContinueStatement":
        this.write("continue;\n");
        return;
      case "ImportDeclaration":
      case "ProtocolDeclaration":
      case "SymbolDeclaration":
        throw new Error(`${stmt.kind} is only valid at top level`);
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
      case "PipeExpression":
        this.emitPipeExpression(expr);
        return;
      case "RunExpression":
        // After ANF, nested run should not appear in value position inside
        // thunks; top-level / fallback peels via execute.
        this.write("execute(");
        this.emitValueExpression(expr.expression);
        this.write(")");
        return;
    }
  }

  /**
   * `left | right` → `right(left)` or `callee(left, args…)` when right is a call.
   */
  private emitPipeExpression(expr: {
    readonly left: Expression;
    readonly right: Expression;
  }): void {
    const rightText = expressionText(expr.right);
    const call = splitTrailingCall(rightText);
    if (call) {
      this.write(call.callee.trim());
      this.write("(");
      this.emitValueExpression(expr.left);
      if (call.args.trim()) {
        this.write(", ");
        this.write(call.args.trim());
      }
      this.write(")");
      return;
    }
    // Non-call RHS: treat as callee expression
    if (expr.right.kind === "TsExpression" || expr.right.kind === "Identifier") {
      this.emitValueExpression(expr.right);
      this.write("(");
      this.emitValueExpression(expr.left);
      this.write(")");
      return;
    }
    // Fallback: wrap complex RHS
    this.write("(");
    this.emitValueExpression(expr.right);
    this.write(")(");
    this.emitValueExpression(expr.left);
    this.write(")");
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

function runSiteOf(stmt: Statement, witnessIndex: number): RunSite | null {
  if (stmt.kind === "VariableStatement") {
    if (stmt.initializer.kind !== "RunExpression") return null;
    return {
      kind: "binding",
      name: stmt.name.name,
      nameRange: stmt.name.range,
      source: stmt.initializer.expression,
      typeAnnotation: stmt.typeAnnotation,
      witnessIndex,
    };
  }
  if (
    stmt.kind === "ExpressionStatement" &&
    stmt.expression.kind === "RunExpression"
  ) {
    return {
      kind: "discard",
      source: stmt.expression.expression,
      witnessIndex,
    };
  }
  if (
    stmt.kind === "ReturnStatement" &&
    stmt.expression.kind === "RunExpression"
  ) {
    return {
      kind: "return",
      source: stmt.expression.expression,
      witnessIndex,
    };
  }
  return null;
}

function collectOrdinaryVars(
  stmts: Statement[],
  out: VariableStatement[],
): void {
  for (const stmt of stmts) {
    switch (stmt.kind) {
      case "VariableStatement":
        if (stmt.initializer.kind !== "RunExpression") out.push(stmt);
        break;
      case "BlockStatement":
        collectOrdinaryVars(stmt.statements, out);
        break;
      case "IfStatement":
        collectOrdinaryVars([stmt.consequent], out);
        if (stmt.alternate) collectOrdinaryVars([stmt.alternate], out);
        break;
      case "WhileStatement":
        collectOrdinaryVars([stmt.body], out);
        break;
      case "ForStatement":
        if (stmt.initializer?.kind === "VariableStatement") {
          out.push(stmt.initializer);
        }
        collectOrdinaryVars([stmt.body], out);
        break;
    }
  }
}

function bodyContainsRun(stmts: Statement[]): boolean {
  for (const stmt of stmts) {
    if (runSiteOf(stmt, 0)) return true;
    switch (stmt.kind) {
      case "BlockStatement":
        if (bodyContainsRun(stmt.statements)) return true;
        break;
      case "IfStatement":
        if (bodyContainsRun([stmt.consequent])) return true;
        if (stmt.alternate && bodyContainsRun([stmt.alternate])) return true;
        break;
      case "WhileStatement":
        if (bodyContainsRun([stmt.body])) return true;
        break;
      case "ForStatement":
        if (bodyContainsRun([stmt.body])) return true;
        break;
      case "VariableStatement":
        if (exprHasRun(stmt.initializer)) return true;
        break;
      case "ExpressionStatement":
        if (exprHasRun(stmt.expression)) return true;
        break;
      case "ReturnStatement":
        if (exprHasRun(stmt.expression)) return true;
        break;
    }
  }
  return false;
}

function fileHasSymbolDecls(ast: SourceFile): boolean {
  return ast.statements.some((s) => s.kind === "SymbolDeclaration");
}

function emptyObjectType(text: string): boolean {
  return text.replace(/\s/g, "") === "{}";
}

function fileHasRunInThunk(ast: SourceFile): boolean {
  return walkHasRun(ast.statements);
}

function walkHasRun(stmts: Statement[]): boolean {
  return bodyContainsRun(stmts);
}

function exprHasRun(expr: Expression): boolean {
  switch (expr.kind) {
    case "RunExpression":
      return true;
    case "PipeExpression":
      return exprHasRun(expr.left) || exprHasRun(expr.right);
    case "ThunkExpression":
      return bodyContainsRun(expr.body);
    case "TsExpression":
      return expr.parts.some(
        (p) => p.kind === "embedded" && exprHasRun(p.expression),
      );
    case "Identifier":
      return false;
  }
}

/** Best-effort source text for pipe RHS splitting. */
function expressionText(expr: Expression): string {
  switch (expr.kind) {
    case "Identifier":
      return expr.name;
    case "TsExpression":
      return expr.text;
    case "PipeExpression":
      return `${expressionText(expr.left)} | ${expressionText(expr.right)}`;
    case "RunExpression":
      return `run ${expressionText(expr.expression)}`;
    case "ThunkExpression":
      return "thunk { … }";
  }
}

/**
 * If `text` is a call `callee(…)`, split callee and args (final paren pair).
 */
function splitTrailingCall(
  text: string,
): { callee: string; args: string } | null {
  const t = text.trim();
  if (!t.endsWith(")")) return null;
  let depth = 0;
  for (let i = t.length - 1; i >= 0; i--) {
    const c = t[i]!;
    if (c === ")") depth++;
    else if (c === "(") {
      depth--;
      if (depth === 0) {
        const callee = t.slice(0, i);
        const args = t.slice(i + 1, -1);
        if (!callee.trim()) return null;
        return { callee, args };
      }
    }
  }
  return null;
}

function fileNeedsTypesImport(ast: SourceFile): {
  thunk: boolean;
  requires: boolean;
  async: boolean;
} {
  let thunk = false;
  let requires = false;
  let async = false;
  for (const stmt of ast.statements) {
    if (stmt.kind === "VariableStatement" && stmt.typeAnnotation) {
      const { needsTypesImport, needsAsyncImport } = encodeThunkTypeAnnotation(
        stmt.typeAnnotation.baseText,
        stmt.typeAnnotation.protocols,
      );
      if (stmt.typeAnnotation.protocols.some((p) => p.name === "Requires")) {
        requires = true;
        thunk = true;
      }
      if (stmt.typeAnnotation.protocols.some((p) => p.name === "Async")) {
        async = true;
        thunk = true;
      }
      if (needsAsyncImport) async = true;
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
  return { thunk, requires, async };
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
