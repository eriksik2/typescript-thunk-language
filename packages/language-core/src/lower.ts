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
import { encodeThunkTypeAnnotation, rewriteThunkSurfaceInText } from "./protocol-encode";
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
  | { kind: "succeedResume"; witnessIndex: number }
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
          this.setTerm(resumeB, {
            kind: "succeedResume",
            witnessIndex: run.witnessIndex,
          });
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
      case "TypeAliasDeclaration":
      case "FeatureDeclaration":
      case "FileDeclaration":
      case "TagsDeclaration":
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
  private needsInferLet = false;
  private needsSymbolType = false;
  private needsMatchHelpers = false;
  private needsTryError = false;
  private needsPedigreeHelpers = false;
  /** Effectful thunks get an async oracle + `__ascribeThunkYield`. */
  private needsOracle = false;
  /** When false, writeMapped writes text without source-map entries. */
  private emitMappings = true;
  private isTempId = 0;
  private initWitnessId = 0;
  /** Same-file symbol name → resolved associated type text. */
  private readonly symbolAssoc = new Map<string, string>();
  /** Same-file symbol decls by name (for parent brand chaining). */
  private readonly symbolDecls = new Map<string, SymbolDeclaration>();

  constructor(
    private readonly originalText: string,
    private readonly internalImportPath: string,
    private readonly typesImportPath: string,
    private readonly runtimeImportPath: string,
  ) {}

  emitFile(ast: SourceFile): LoweredFile {
    const typesNeeded = fileNeedsTypesImport(ast);
    this.needsThunkType = typesNeeded.thunk;
    this.needsRequiresType = typesNeeded.requires;
    this.needsAsyncType = typesNeeded.async;
    this.needsMakeSymbol = fileHasSymbolDecls(ast);
    this.needsThunkReturnType = fileHasRunInThunk(ast);
    this.needsOracle = this.needsThunkReturnType;
    this.needsInferLet = fileNeedsInferLet(ast);
    this.needsMatchHelpers = fileHasMatchHelpers(ast);
    if (this.needsMatchHelpers) this.needsSymbolType = true;
    this.needsTryError = fileHasTry(ast);
    this.needsPedigreeHelpers = fileHasPedigreeIs(ast) || this.needsTryError;
    if (this.needsPedigreeHelpers) {
      this.needsMatchHelpers = true;
      this.needsSymbolType = true;
    }
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
    if (this.needsOracle) {
      internalNames.push("__ascribeThunkYield", "__oracleRun");
    }
    if (this.needsMakeSymbol) {
      internalNames.push("__makeSymbol");
    }
    if (this.needsMatchHelpers) {
      internalNames.push(
        "symbolIs as __symbolIs",
        "symbolIsAny as __symbolIsAny",
        "__symbolPayload",
        "__exhaustive",
      );
    }
    if (this.needsTryError) {
      if (!this.needsMatchHelpers) {
        internalNames.push("symbolIsAny as __symbolIsAny");
      }
      internalNames.push("__excludeIsAny");
    }
    this.write(
      `import { ${internalNames.join(", ")} } from "${this.internalImportPath}";\n`,
    );

    if (this.needsTryError) {
      this.write(
        `import { Error as __ThunkError } from "${this.runtimeImportPath}";\n`,
      );
    }

    if (
      this.needsThunkType ||
      this.needsRequiresType ||
      this.needsAsyncType ||
      this.needsThunkReturnType ||
      this.needsInferLet ||
      this.needsSymbolType
    ) {
      const typeNames: string[] = [];
      if (this.needsThunkType) typeNames.push("Thunk");
      if (this.needsRequiresType) typeNames.push("Requires");
      if (this.needsAsyncType) typeNames.push("Async");
      if (this.needsThunkReturnType) typeNames.push("ThunkReturnType");
      if (this.needsInferLet) typeNames.push("InferLet");
      if (this.needsSymbolType) typeNames.push("SymbolType");
      this.write(
        `import type { ${typeNames.join(", ")} } from "${this.typesImportPath}";\n`,
      );
    }
    this.write("\n");

    const anfRest = normalizeAnf(rest, { allowTry: false });
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
      case "FeatureDeclaration":
      case "FileDeclaration":
      case "TagsDeclaration":
        // Navigation metadata only — erased from generated TS.
        return;
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
      case "TypeAliasDeclaration":
        this.writeMapped(stmt.text, stmt.range);
        if (!stmt.text.endsWith(";")) this.write(";");
        this.write("\n");
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
    const typeParams = decl.typeParams.trim();
    const typeParamList = typeParams ? `<${typeParams}>` : "";
    // First type param name for generic brand callable, or full assoc for monomorphic.
    const firstParam = typeParams
      ? typeParams.split(",")[0]!.trim().split(/\s+extends\s+/)[0]!.trim()
      : "";

    this.write(`declare const ${brand}: unique symbol;\n`);
    this.write("const ");
    this.writeMapped(name, decl.name.range);

    // Runtime identity
    if (typeParams) {
      this.write(" = __makeSymbol<any>(");
      this.write(`${JSON.stringify(name)}`);
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
        this.write("{ readonly key: symbol; readonly __assoc: any");
        this.write('; readonly __thunkSymbol?: "ThunkSymbol"; readonly __abstract: true');
        if (parentName) {
          this.write("; readonly __parent?: typeof ");
          this.writeMapped(parentName, decl.extendsName!.range);
        }
        this.write(" }");
      } else {
        this.write(`(<${typeParams}>(value: ${firstParam}) => ${name}${typeParamList})`);
        this.write(" & { readonly key: symbol; readonly __assoc: any }");
        if (parentName) {
          this.write(" & { readonly __parent?: typeof ");
          this.writeMapped(parentName, decl.extendsName!.range);
          this.write(" }");
        }
      }
      this.write(";\n");

      this.write("type ");
      this.writeMapped(name, decl.name.range);
      this.write(`${typeParamList} = `);
      // Opaque brand — not `assoc & brand` (that would assign to assoc).
      this.write(
        `{ readonly [${brand}]: typeof ${brand} } & { readonly __assoc: `,
      );
      this.writeMapped(assoc, assocRange);
      this.write(" }");
      if (!decl.isAbstract) {
        this.write(" & { readonly __symbolIdentity?: typeof ");
        this.writeMapped(name, decl.name.range);
        this.write(" }");
      }
      this.write(";\n");
      this.write("\n");
      return;
    }

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

    // Branded type — opaque (not assignable to assoc). Use Symbol.unwrap.
    // Associated type still merges parent fields for the payload shape.
    this.write("type ");
    this.writeMapped(name, decl.name.range);
    this.write(" = ");
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
      ann.failPayload,
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
    const normalized = normalizeAnf(expr.body, { allowTry: true });
    const prevMaps = this.emitMappings;
    // Nested thunks inside a machine still need oracle maps for hover.
    this.emitMappings = true;

    if (!bodyContainsRun(normalized)) {
      this.writeMapped("defer", thunkKeyword);
      this.write("(() => ");
      this.emitPureBody(normalized);
      this.write(")");
      this.emitMappings = prevMaps;
      return;
    }

    // Effectful thunk: typecheck via structure-preserving async oracle;
    // runtime via state machine. Yield T from oracle; protocols from machine.
    this.writeMapped("__ascribeThunkYield", thunkKeyword);
    this.write("(\n");
    this.write("async () => {\n");
    this.emitOracleBody(normalized);
    this.write("},\n");
    this.write("defer(() => ");
    this.emitMappings = false;
    this.emitStateMachine(normalized);
    this.emitMappings = true;
    this.write(")\n)");
    this.emitMappings = prevMaps;
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
    this.write('throw new globalThis.Error("invalid thunk state");\n');
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
        if (conditionUsesIsFlow(term.condition)) {
          this.emitConditionFlow(
            term.condition,
            /*bindMode*/ "assign",
            () => {
              this.write(`__state = ${term.thenTarget};\n`);
              this.write("continue;\n");
            },
            () => {
              this.write(`__state = ${term.elseTarget};\n`);
              this.write("continue;\n");
            },
          );
          return;
        }
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
        this.write(
          `return succeed(__resume as ThunkReturnType<NonNullable<typeof __t${term.witnessIndex}>>);\n`,
        );
        return;
      case "succeedVoid":
        this.write("return succeed(undefined as void);\n");
        return;
    }
  }

  private emitHoistedLocals(body: Statement[], runSites: RunSite[]): void {
    // Run bindings first — ANF temps (`__r0`) may appear in ordinary
    // initializers' InferLet witnesses below.
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

    const ordinary: VariableStatement[] = [];
    collectOrdinaryVars(body, ordinary);

    for (const stmt of ordinary) {
      if (!stmt.typeAnnotation) {
        // Infer a widened `let` type from the initializer via a dead witness
        // (same pattern as run bindings). Without this, bare `let x;` is
        // implicit any across the machine closure boundary (TS7034).
        const wit = this.initWitnessId++;
        this.write(`const __v${wit} = false ? (`);
        this.emitValueExpression(stmt.initializer);
        this.write(") : undefined;\n");
        this.write("let ");
        this.writeMapped(stmt.name.name, stmt.name.range);
        this.write(`: InferLet<NonNullable<typeof __v${wit}>>;\n`);
        continue;
      }
      this.write("let ");
      this.writeMapped(stmt.name.name, stmt.name.range);
      this.write(": ");
      this.emitTypeAnnotation(stmt.typeAnnotation);
      this.write(";\n");
    }

    // Pattern bindings from `if`/`while` `is` conditions (assigned on success).
    const isBinds = collectIsBindingsFromStmts(body);
    for (const b of isBinds) {
      this.write("let ");
      this.writeMapped(b.name, b.range);
      this.write(": any;\n");
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

  /**
   * Structure-preserving async body for typecheck. Same control-flow shape as
   * the surface (post-ANF); `run e` → `await __oracleRun(e)`; returns bare
   * yield values (not `succeed`).
   */
  private emitOracleBody(body: Statement[]): void {
    if (body.length === 0) {
      this.write("return;\n");
      return;
    }

    const last = body[body.length - 1]!;
    const before = body.slice(0, -1);

    for (const stmt of before) {
      this.emitOracleStatement(stmt);
    }

    if (last.kind === "ReturnStatement") {
      this.write("return ");
      this.emitOracleValue(last.expression);
      this.write(";\n");
      return;
    }

    this.emitOracleStatement(last);
    if (
      last.kind === "IfStatement" ||
      last.kind === "BlockStatement" ||
      last.kind === "WhileStatement" ||
      last.kind === "ForStatement"
    ) {
      this.write('throw new globalThis.Error("unreachable");\n');
    }
  }

  private emitOracleStatement(stmt: Statement): void {
    switch (stmt.kind) {
      case "VariableStatement": {
        this.write(`${stmt.declarationKind} `);
        this.writeMapped(stmt.name.name, stmt.name.range);
        if (stmt.typeAnnotation) {
          this.write(": ");
          this.emitTypeAnnotation(stmt.typeAnnotation);
        }
        this.write(" = ");
        this.emitOracleValue(stmt.initializer);
        this.write(";\n");
        return;
      }
      case "ExpressionStatement": {
        this.emitOracleValue(stmt.expression);
        this.write(";\n");
        return;
      }
      case "ReturnStatement":
        this.write("return ");
        this.emitOracleValue(stmt.expression);
        this.write(";\n");
        return;
      case "BlockStatement":
        this.write("{\n");
        for (const s of stmt.statements) this.emitOracleStatement(s);
        this.write("}\n");
        return;
      case "IfStatement":
        if (conditionUsesIsFlow(stmt.condition)) {
          this.write("{\n");
          this.emitConditionFlow(
            stmt.condition,
            "const",
            () => this.emitOracleStatement(stmt.consequent),
            () => {
              if (stmt.alternate) this.emitOracleStatement(stmt.alternate);
            },
          );
          this.write("}\n");
          return;
        }
        this.write("if (");
        this.emitValueExpression(stmt.condition);
        this.write(") ");
        this.emitOracleStatement(stmt.consequent);
        if (stmt.alternate) {
          this.write(" else ");
          this.emitOracleStatement(stmt.alternate);
        }
        return;
      case "WhileStatement":
        if (conditionUsesIsFlow(stmt.condition)) {
          this.write("while (true) {\n");
          this.emitConditionFlow(
            stmt.condition,
            "const",
            () => this.emitOracleStatement(stmt.body),
            () => {
              this.write("break;\n");
            },
          );
          this.write("}\n");
          return;
        }
        this.write("while (");
        this.emitValueExpression(stmt.condition);
        this.write(") ");
        this.emitOracleStatement(stmt.body);
        return;
      case "ForStatement": {
        this.write("for (");
        if (stmt.initializer) {
          if (stmt.initializer.kind === "VariableStatement") {
            const v = stmt.initializer;
            this.write(`${v.declarationKind} `);
            this.writeMapped(v.name.name, v.name.range);
            this.write(" = ");
            this.emitOracleValue(v.initializer);
          } else {
            this.emitOracleValue(stmt.initializer.expression);
          }
        }
        this.write("; ");
        if (stmt.condition) this.emitValueExpression(stmt.condition);
        this.write("; ");
        if (stmt.update) this.emitValueExpression(stmt.update);
        this.write(") ");
        this.emitOracleStatement(stmt.body);
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
      case "TypeAliasDeclaration":
      case "FeatureDeclaration":
      case "FileDeclaration":
      case "TagsDeclaration":
        throw new Error(`${stmt.kind} is only valid at top level`);
    }
  }

  /** Value emit for oracle: peels `run` via `await __oracleRun`. */
  private emitOracleValue(expr: Expression): void {
    if (expr.kind === "RunExpression") {
      this.write("await __oracleRun(");
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
        this.write('throw new globalThis.Error("unreachable");\n');
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
        if (conditionUsesIsFlow(stmt.condition)) {
          this.write("{\n");
          this.emitConditionFlow(
            stmt.condition,
            "const",
            () => this.emitPureStatement(stmt.consequent),
            () => {
              if (stmt.alternate) this.emitPureStatement(stmt.alternate);
            },
          );
          this.write("}\n");
          return;
        }
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
        if (conditionUsesIsFlow(stmt.condition)) {
          this.write("while (true) {\n");
          this.emitConditionFlow(
            stmt.condition,
            "const",
            () => this.emitPureStatement(stmt.body),
            () => {
              this.write("break;\n");
            },
          );
          this.write("}\n");
          return;
        }
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
      case "TypeAliasDeclaration":
      case "FeatureDeclaration":
      case "FileDeclaration":
      case "TagsDeclaration":
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
            const rewritten = rewriteThunkSurfaceInText(part.text);
            if (rewritten !== part.text) {
              if (/\[Requires\]/.test(rewritten)) this.needsRequiresType = true;
              if (/\[Async\]/.test(rewritten)) this.needsAsyncType = true;
              this.needsThunkType = true;
            }
            this.writeMapped(rewritten, part.range);
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
      case "MatchExpression":
        this.emitMatchExpression(expr);
        return;
      case "IsExpression":
        this.emitIsExpressionValue(expr);
        return;
      case "AndExpression":
        if (expressionHasIsBindings(expr)) {
          throw new Error(
            "`is` pattern bindings are only allowed in `if` / `while` conditions",
          );
        }
        this.write("(");
        this.emitValueExpression(expr.left);
        this.write(" && ");
        this.emitValueExpression(expr.right);
        this.write(")");
        return;
      case "TryExpression":
        throw new Error(
          "`try` is only allowed inside `thunk { … }` bodies (ANF should have desugared it)",
        );
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
   * Boolean `x is Pat` / `x is any Pat` in value position — no `infer` bindings.
   */
  private emitIsExpressionValue(expr: {
    readonly scrutinee: Expression;
    readonly pattern: MatchPatternLike;
    readonly pedigree: boolean;
  }): void {
    if (patternHasBindings(expr.pattern)) {
      throw new Error(
        "`is` pattern bindings are only allowed in `if` / `while` conditions",
      );
    }
    this.needsMatchHelpers = true;
    const testFn = expr.pedigree ? "__symbolIsAny" : "__symbolIs";
    const sym = expr.pattern.symbol;
    const ident = simpleIdentName(expr.scrutinee);
    if (ident) {
      this.write(`${testFn}(`);
      this.writeMapped(ident.name, ident.range);
      this.write(", ");
      this.writeMapped(sym.name, sym.range);
      this.write(")");
      return;
    }
    const tmp = `__is${this.isTempId++}`;
    this.write(`((${tmp}) => ${testFn}(${tmp}, `);
    this.writeMapped(sym.name, sym.range);
    this.write("))(");
    this.emitValueExpression(expr.scrutinee);
    this.write(")");
  }

  /**
   * Control-flow desugar for `is` / `&&` so bindings are in scope on success.
   * `bindMode`: `const` for pure if/while; `assign` for machine-hoisted lets.
   */
  private emitConditionFlow(
    cond: Expression,
    bindMode: "const" | "assign",
    onTrue: () => void,
    onFalse: () => void,
  ): void {
    if (cond.kind === "AndExpression") {
      this.emitConditionFlow(
        cond.left,
        bindMode,
        () => this.emitConditionFlow(cond.right, bindMode, onTrue, onFalse),
        onFalse,
      );
      return;
    }
    if (cond.kind === "IsExpression") {
      this.emitIsCondition(cond, bindMode, onTrue, onFalse);
      return;
    }
    this.write("if (");
    this.emitValueExpression(cond);
    this.write(") {\n");
    onTrue();
    this.write("} else {\n");
    onFalse();
    this.write("}\n");
  }

  private emitIsCondition(
    expr: {
      readonly scrutinee: Expression;
      readonly pattern: MatchPatternLike;
      readonly pedigree: boolean;
    },
    bindMode: "const" | "assign",
    onTrue: () => void,
    onFalse: () => void,
  ): void {
    this.needsMatchHelpers = true;
    this.needsSymbolType = true;
    const testFn = expr.pedigree ? "__symbolIsAny" : "__symbolIs";
    const sym = expr.pattern.symbol;
    let scrutineeName: string;
    const ident = simpleIdentName(expr.scrutinee);
    if (ident) {
      scrutineeName = ident.name;
      this.write(`if (${testFn}(`);
      this.writeMapped(ident.name, ident.range);
      this.write(", ");
      this.writeMapped(sym.name, sym.range);
      this.write(")) {\n");
    } else {
      scrutineeName = `__is${this.isTempId++}`;
      this.write(`const ${scrutineeName} = `);
      this.emitValueExpression(expr.scrutinee);
      this.write(";\n");
      this.write(`if (${testFn}(${scrutineeName}, `);
      this.writeMapped(sym.name, sym.range);
      this.write(")) {\n");
    }
    if (expr.pedigree) {
      // Type predicate on __symbolIsAny narrows the scrutinee (TS typeof-style).
      // Payload bindings use the narrowed value's associated type.
      this.emitPatternBindingsPedigree(expr.pattern, scrutineeName, bindMode);
    } else {
      this.write(
        `type __leaf = Extract<typeof ${scrutineeName}, { readonly __symbolIdentity?: typeof `,
      );
      this.writeMapped(sym.name, sym.range);
      this.write(" }>;\n");
      this.emitPatternBindings(expr.pattern, scrutineeName, bindMode);
    }
    onTrue();
    this.write("} else {\n");
    onFalse();
    this.write("}\n");
  }

  private emitPatternBindingsPedigree(
    pattern: MatchPatternLike,
    scrutineeName: string,
    bindMode: "const" | "assign",
  ): void {
    if (pattern.kind === "MatchSymbolPattern") {
      if (!pattern.binding) return;
      if (bindMode === "const") {
        this.write("const ");
        this.writeMapped(pattern.binding.name, pattern.binding.range);
        this.write(
          ` = __symbolPayload(${scrutineeName});\n`,
        );
      } else {
        this.writeMapped(pattern.binding.name, pattern.binding.range);
        this.write(
          ` = __symbolPayload(${scrutineeName});\n`,
        );
      }
      return;
    }
    this.write(
      `const __payload = __symbolPayload(${scrutineeName});\n`,
    );
    for (const field of pattern.fields) {
      if (bindMode === "const") {
        this.write("const ");
        this.writeMapped(field.binding.name, field.binding.range);
        this.write(" = __payload.");
        this.writeMapped(field.field.name, field.field.range);
        this.write(";\n");
      } else {
        this.writeMapped(field.binding.name, field.binding.range);
        this.write(" = __payload.");
        this.writeMapped(field.field.name, field.field.range);
        this.write(";\n");
      }
    }
  }

  private emitPatternBindings(
    pattern: MatchPatternLike,
    scrutineeName: string,
    bindMode: "const" | "assign",
  ): void {
    if (pattern.kind === "MatchSymbolPattern") {
      if (!pattern.binding) return;
      if (bindMode === "const") {
        this.write("const ");
        this.writeMapped(pattern.binding.name, pattern.binding.range);
        this.write(
          ` = __symbolPayload(${scrutineeName} as __leaf);\n`,
        );
      } else {
        this.writeMapped(pattern.binding.name, pattern.binding.range);
        this.write(
          ` = __symbolPayload(${scrutineeName} as __leaf);\n`,
        );
      }
      return;
    }
    this.write(
      `const __payload = __symbolPayload(${scrutineeName} as __leaf);\n`,
    );
    for (const field of pattern.fields) {
      if (bindMode === "const") {
        this.write("const ");
        this.writeMapped(field.binding.name, field.binding.range);
        this.write(" = __payload.");
        this.writeMapped(field.field.name, field.field.range);
        this.write(";\n");
      } else {
        this.writeMapped(field.binding.name, field.binding.range);
        this.write(" = __payload.");
        this.writeMapped(field.field.name, field.field.range);
        this.write(";\n");
      }
    }
  }

  /**
   * `match (scrutinee) { arms }` → IIFE of exact `Symbol.is` arms + `__exhaustive`.
   */
  private emitMatchExpression(expr: {
    readonly scrutinee: Expression;
    readonly arms: readonly {
      readonly pattern:
        | {
            readonly kind: "MatchSymbolPattern";
            readonly symbol: { readonly name: string; readonly range: Range };
            readonly binding?: {
              readonly name: string;
              readonly range: Range;
            };
          }
        | {
            readonly kind: "MatchObjectPattern";
            readonly symbol: { readonly name: string; readonly range: Range };
            readonly fields: readonly {
              readonly field: { readonly name: string; readonly range: Range };
              readonly binding: {
                readonly name: string;
                readonly range: Range;
              };
            }[];
          };
      readonly expression: Expression;
    }[];
  }): void {
    if (exprHasRunInArms(expr)) {
      throw new Error(
        "match v1 does not allow `run` inside arms (bind with statement `run` first)",
      );
    }
    this.needsMatchHelpers = true;
    this.needsSymbolType = true;
    this.write("((__match) => {\n");
    let first = true;
    for (const arm of expr.arms) {
      const sym = arm.pattern.symbol;
      if (first) {
        this.write("if (__symbolIs(__match, ");
        first = false;
      } else {
        this.write("else if (__symbolIs(__match, ");
      }
      this.writeMapped(sym.name, sym.range);
      this.write(")) {\n");
      // Narrow leaf via IdentityCarrier so Ok<number>|Err<E> → Ok<number>.
      this.write("type __leaf = Extract<typeof __match, { readonly __symbolIdentity?: typeof ");
      this.writeMapped(sym.name, sym.range);
      this.write(" }>;\n");
      if (arm.pattern.kind === "MatchSymbolPattern") {
        if (arm.pattern.binding) {
          this.write("const ");
          this.writeMapped(
            arm.pattern.binding.name,
            arm.pattern.binding.range,
          );
          this.write(
            " = __symbolPayload(__match as __leaf);\n",
          );
        }
      } else {
        this.write(
          "const __payload = __symbolPayload(__match as __leaf);\n",
        );
        for (const field of arm.pattern.fields) {
          this.write("const ");
          this.writeMapped(field.binding.name, field.binding.range);
          this.write(" = __payload.");
          this.writeMapped(field.field.name, field.field.range);
          this.write(";\n");
        }
      }
      this.write("return ");
      this.emitValueExpression(arm.expression);
      this.write(";\n");
      this.write("} ");
    }
    this.write("else {\n");
    this.write("return __exhaustive(__match);\n");
    this.write("}\n");
    this.write("})(");
    this.emitValueExpression(expr.scrutinee);
    this.write(")");
  }

  /**
   * `left | right` → `right(left)` or `callee(left, …args)` when right is a call.
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
    if (!this.emitMappings) {
      this.write(text);
      return;
    }
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

function fileHasMatchHelpers(ast: SourceFile): boolean {
  return walkHasMatchHelpers(ast.statements);
}

function walkHasMatchHelpers(stmts: readonly Statement[]): boolean {
  for (const stmt of stmts) {
    switch (stmt.kind) {
      case "VariableStatement":
        if (exprHasMatchHelpers(stmt.initializer)) return true;
        break;
      case "ExpressionStatement":
      case "ReturnStatement":
        if (exprHasMatchHelpers(stmt.expression)) return true;
        break;
      case "BlockStatement":
        if (walkHasMatchHelpers(stmt.statements)) return true;
        break;
      case "IfStatement":
        if (exprHasMatchHelpers(stmt.condition)) return true;
        if (walkHasMatchHelpers([stmt.consequent])) return true;
        if (stmt.alternate && walkHasMatchHelpers([stmt.alternate])) return true;
        break;
      case "WhileStatement":
        if (exprHasMatchHelpers(stmt.condition)) return true;
        if (walkHasMatchHelpers([stmt.body])) return true;
        break;
      case "ForStatement":
        if (stmt.condition && exprHasMatchHelpers(stmt.condition)) return true;
        if (stmt.update && exprHasMatchHelpers(stmt.update)) return true;
        if (walkHasMatchHelpers([stmt.body])) return true;
        break;
    }
  }
  return false;
}

function exprHasMatchHelpers(expr: Expression): boolean {
  switch (expr.kind) {
    case "MatchExpression":
    case "IsExpression":
      return true;
    case "PipeExpression":
    case "AndExpression":
      return exprHasMatchHelpers(expr.left) || exprHasMatchHelpers(expr.right);
    case "RunExpression":
    case "TryExpression":
      return exprHasMatchHelpers(expr.expression);
    case "ThunkExpression":
      return walkHasMatchHelpers(expr.body);
    case "TsExpression":
      return expr.parts.some(
        (p) => p.kind === "embedded" && exprHasMatchHelpers(p.expression),
      );
    case "Identifier":
      return false;
  }
}

type MatchPatternLike =
  | {
      readonly kind: "MatchSymbolPattern";
      readonly symbol: { readonly name: string; readonly range: Range };
      readonly binding?: { readonly name: string; readonly range: Range };
    }
  | {
      readonly kind: "MatchObjectPattern";
      readonly symbol: { readonly name: string; readonly range: Range };
      readonly fields: readonly {
        readonly field: { readonly name: string; readonly range: Range };
        readonly binding: { readonly name: string; readonly range: Range };
      }[];
    };

/** Identifier or single-token TsExpression name (hybrid primary path). */
function simpleIdentName(
  expr: Expression,
): { name: string; range: Range } | null {
  if (expr.kind === "Identifier") {
    return { name: expr.name, range: expr.range };
  }
  if (expr.kind === "TsExpression" && expr.parts.length === 1) {
    const part = expr.parts[0]!;
    if (part.kind === "text") {
      const name = part.text.trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        return { name, range: part.range };
      }
    }
  }
  return null;
}

function patternHasBindings(pattern: MatchPatternLike): boolean {
  if (pattern.kind === "MatchSymbolPattern") return !!pattern.binding;
  return pattern.fields.length > 0;
}

function expressionHasIsBindings(expr: Expression): boolean {
  switch (expr.kind) {
    case "IsExpression":
      return patternHasBindings(expr.pattern);
    case "AndExpression":
      return (
        expressionHasIsBindings(expr.left) ||
        expressionHasIsBindings(expr.right)
      );
    case "PipeExpression":
      return (
        expressionHasIsBindings(expr.left) ||
        expressionHasIsBindings(expr.right)
      );
    case "RunExpression":
    case "TryExpression":
      return expressionHasIsBindings(expr.expression);
    case "MatchExpression":
    case "ThunkExpression":
    case "TsExpression":
    case "Identifier":
      return false;
  }
}

/** True when if/while should desugar for `is` / binding flow (any `is`, or `&&`). */
function conditionUsesIsFlow(expr: Expression): boolean {
  switch (expr.kind) {
    case "IsExpression":
      return true;
    case "AndExpression":
      return (
        conditionUsesIsFlow(expr.left) || conditionUsesIsFlow(expr.right)
      );
    default:
      return false;
  }
}

function collectIsBindingsFromStmts(
  stmts: readonly Statement[],
): { name: string; range: Range }[] {
  const out: { name: string; range: Range }[] = [];
  const seen = new Set<string>();
  const add = (b: { name: string; range: Range }) => {
    if (seen.has(b.name)) return;
    seen.add(b.name);
    out.push(b);
  };
  const walkExpr = (expr: Expression) => {
    switch (expr.kind) {
      case "IsExpression":
        if (expr.pattern.kind === "MatchSymbolPattern" && expr.pattern.binding) {
          add(expr.pattern.binding);
        } else if (expr.pattern.kind === "MatchObjectPattern") {
          for (const f of expr.pattern.fields) add(f.binding);
        }
        walkExpr(expr.scrutinee);
        break;
      case "AndExpression":
      case "PipeExpression":
        walkExpr(expr.left);
        walkExpr(expr.right);
        break;
      case "RunExpression":
      case "TryExpression":
        walkExpr(expr.expression);
        break;
      case "MatchExpression":
        walkExpr(expr.scrutinee);
        break;
      case "TsExpression":
        for (const p of expr.parts) {
          if (p.kind === "embedded") walkExpr(p.expression);
        }
        break;
      case "ThunkExpression":
        walkStmts(expr.body);
        break;
      case "Identifier":
        break;
    }
  };
  const walkStmts = (ss: readonly Statement[]) => {
    for (const stmt of ss) {
      switch (stmt.kind) {
        case "IfStatement":
          walkExpr(stmt.condition);
          walkStmts([stmt.consequent]);
          if (stmt.alternate) walkStmts([stmt.alternate]);
          break;
        case "WhileStatement":
          walkExpr(stmt.condition);
          walkStmts([stmt.body]);
          break;
        case "ForStatement":
          if (stmt.condition) walkExpr(stmt.condition);
          walkStmts([stmt.body]);
          break;
        case "BlockStatement":
          walkStmts(stmt.statements);
          break;
        case "VariableStatement":
          walkExpr(stmt.initializer);
          break;
        case "ExpressionStatement":
        case "ReturnStatement":
          walkExpr(stmt.expression);
          break;
      }
    }
  };
  walkStmts(stmts);
  return out;
}

function exprHasRunInArms(expr: {
  readonly arms: readonly { readonly expression: Expression }[];
}): boolean {
  return expr.arms.some((a) => exprHasRun(a.expression));
}

function emptyObjectType(text: string): boolean {
  return text.replace(/\s/g, "") === "{}";
}

function fileHasRunInThunk(ast: SourceFile): boolean {
  return walkHasRun(ast.statements);
}

/**
 * True when a thunk with `run` hoists an ordinary `let`/`const` that has no
 * type annotation — those need `InferLet` witnesses to avoid TS7034.
 */
function fileNeedsInferLet(ast: SourceFile): boolean {
  const visitExpr = (expr: Expression): boolean => {
    switch (expr.kind) {
      case "ThunkExpression":
        if (!bodyContainsRun(expr.body)) return false;
        {
          const ordinary: VariableStatement[] = [];
          collectOrdinaryVars(expr.body, ordinary);
          if (ordinary.some((v) => !v.typeAnnotation)) return true;
        }
        return expr.body.some((s) => visitStmt(s));
      case "RunExpression":
      case "TryExpression":
        return visitExpr(expr.expression);
      case "PipeExpression":
      case "AndExpression":
        return visitExpr(expr.left) || visitExpr(expr.right);
      case "IsExpression":
        return visitExpr(expr.scrutinee);
      case "MatchExpression":
        return (
          visitExpr(expr.scrutinee) ||
          expr.arms.some((a) => visitExpr(a.expression))
        );
      case "TsExpression":
        return expr.parts.some(
          (p) => p.kind === "embedded" && visitExpr(p.expression),
        );
      default:
        return false;
    }
  };
  const visitStmt = (stmt: Statement): boolean => {
    switch (stmt.kind) {
      case "BlockStatement":
        return stmt.statements.some(visitStmt);
      case "IfStatement":
        return (
          visitExpr(stmt.condition) ||
          visitStmt(stmt.consequent) ||
          (stmt.alternate ? visitStmt(stmt.alternate) : false)
        );
      case "WhileStatement":
        return visitExpr(stmt.condition) || visitStmt(stmt.body);
      case "ForStatement":
        return (
          (stmt.initializer
            ? stmt.initializer.kind === "VariableStatement"
              ? visitStmt(stmt.initializer)
              : visitExpr(stmt.initializer.expression)
            : false) ||
          (stmt.condition ? visitExpr(stmt.condition) : false) ||
          (stmt.update ? visitExpr(stmt.update) : false) ||
          visitStmt(stmt.body)
        );
      case "VariableStatement":
        return visitExpr(stmt.initializer);
      case "ExpressionStatement":
      case "ReturnStatement":
        return visitExpr(stmt.expression);
      default:
        return false;
    }
  };
  return ast.statements.some(visitStmt);
}

function walkHasRun(stmts: Statement[]): boolean {
  return bodyContainsRun(stmts);
}

function exprHasRun(expr: Expression): boolean {
  switch (expr.kind) {
    case "RunExpression":
    case "TryExpression":
      return true;
    case "PipeExpression":
    case "AndExpression":
      return exprHasRun(expr.left) || exprHasRun(expr.right);
    case "IsExpression":
      return exprHasRun(expr.scrutinee);
    case "MatchExpression":
      return (
        exprHasRun(expr.scrutinee) ||
        expr.arms.some((a) => exprHasRun(a.expression))
      );
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
    case "AndExpression":
      return `${expressionText(expr.left)} && ${expressionText(expr.right)}`;
    case "IsExpression":
      return `${expressionText(expr.scrutinee)} is …`;
    case "RunExpression":
      return `run ${expressionText(expr.expression)}`;
    case "TryExpression":
      return `try ${expressionText(expr.expression)}`;
    case "MatchExpression":
      return `match (…) { … }`;
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
        stmt.typeAnnotation.failPayload,
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
      if (
        needsTypesImport ||
        /Thunk\s*</.test(stmt.typeAnnotation.baseText) ||
        !!stmt.typeAnnotation.failPayload
      ) {
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
  const runtimeImportPath =
    options?.runtimeImportPath ?? "@thunk/runtime";
  return new Emitter(
    ast.text,
    internalImportPath,
    typesImportPath,
    runtimeImportPath,
  ).emitFile(ast);
}

export function lowerThunkSource(
  text: string,
  fileName = "input.thunk",
  options?: LowerOptions,
): LoweredFile {
  return lowerSourceFile(parseThunkSource(text, fileName), options);
}

function fileHasTry(ast: SourceFile): boolean {
  return walkHasTry(ast.statements);
}

function fileHasPedigreeIs(ast: SourceFile): boolean {
  return walkHasPedigreeIs(ast.statements);
}

function walkHasTry(stmts: readonly Statement[]): boolean {
  for (const stmt of stmts) {
    if (stmtHasTry(stmt)) return true;
  }
  return false;
}

function stmtHasTry(stmt: Statement): boolean {
  switch (stmt.kind) {
    case "BlockStatement":
      return walkHasTry(stmt.statements);
    case "IfStatement":
      return (
        exprHasTry(stmt.condition) ||
        stmtHasTry(stmt.consequent) ||
        (stmt.alternate ? stmtHasTry(stmt.alternate) : false)
      );
    case "WhileStatement":
      return exprHasTry(stmt.condition) || stmtHasTry(stmt.body);
    case "ForStatement":
      return (
        (stmt.initializer ? stmtHasTry(stmt.initializer) : false) ||
        (stmt.condition ? exprHasTry(stmt.condition) : false) ||
        (stmt.update ? exprHasTry(stmt.update) : false) ||
        stmtHasTry(stmt.body)
      );
    case "VariableStatement":
      return exprHasTry(stmt.initializer);
    case "ExpressionStatement":
    case "ReturnStatement":
      return stmt.expression ? exprHasTry(stmt.expression) : false;
    default:
      return false;
  }
}

function exprHasTry(expr: Expression): boolean {
  switch (expr.kind) {
    case "TryExpression":
      return true;
    case "RunExpression":
      return exprHasTry(expr.expression);
    case "PipeExpression":
    case "AndExpression":
      return exprHasTry(expr.left) || exprHasTry(expr.right);
    case "IsExpression":
      return exprHasTry(expr.scrutinee);
    case "MatchExpression":
      return (
        exprHasTry(expr.scrutinee) ||
        expr.arms.some((a) => exprHasTry(a.expression))
      );
    case "ThunkExpression":
      return walkHasTry(expr.body);
    case "TsExpression":
      return expr.parts.some(
        (p) => p.kind === "embedded" && exprHasTry(p.expression),
      );
    case "Identifier":
      return false;
  }
}

function walkHasPedigreeIs(stmts: readonly Statement[]): boolean {
  for (const stmt of stmts) {
    if (stmtHasPedigreeIs(stmt)) return true;
  }
  return false;
}

function stmtHasPedigreeIs(stmt: Statement): boolean {
  switch (stmt.kind) {
    case "BlockStatement":
      return walkHasPedigreeIs(stmt.statements);
    case "IfStatement":
      return (
        exprHasPedigreeIs(stmt.condition) ||
        stmtHasPedigreeIs(stmt.consequent) ||
        (stmt.alternate ? stmtHasPedigreeIs(stmt.alternate) : false)
      );
    case "WhileStatement":
      return exprHasPedigreeIs(stmt.condition) || stmtHasPedigreeIs(stmt.body);
    case "ForStatement":
      return (
        (stmt.initializer ? stmtHasPedigreeIs(stmt.initializer) : false) ||
        (stmt.condition ? exprHasPedigreeIs(stmt.condition) : false) ||
        (stmt.update ? exprHasPedigreeIs(stmt.update) : false) ||
        stmtHasPedigreeIs(stmt.body)
      );
    case "VariableStatement":
      return exprHasPedigreeIs(stmt.initializer);
    case "ExpressionStatement":
    case "ReturnStatement":
      return stmt.expression ? exprHasPedigreeIs(stmt.expression) : false;
    default:
      return false;
  }
}

function exprHasPedigreeIs(expr: Expression): boolean {
  switch (expr.kind) {
    case "IsExpression":
      return expr.pedigree || exprHasPedigreeIs(expr.scrutinee);
    case "RunExpression":
    case "TryExpression":
      return exprHasPedigreeIs(expr.expression);
    case "PipeExpression":
    case "AndExpression":
      return exprHasPedigreeIs(expr.left) || exprHasPedigreeIs(expr.right);
    case "MatchExpression":
      return (
        exprHasPedigreeIs(expr.scrutinee) ||
        expr.arms.some((a) => exprHasPedigreeIs(a.expression))
      );
    case "ThunkExpression":
      return walkHasPedigreeIs(expr.body);
    case "TsExpression":
      return expr.parts.some(
        (p) => p.kind === "embedded" && exprHasPedigreeIs(p.expression),
      );
    case "Identifier":
      return false;
  }
}
