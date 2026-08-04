/**
 * Minimal hand-written parser for M0 Thunk syntax.
 *
 * Hybrid strategy: Thunk-specific forms are parsed structurally;
 * ordinary expressions are captured as TsExpression text spans.
 */

import type {
  Expression,
  ExpressionStatement,
  Identifier,
  ImportDeclaration,
  ImportSpecifier,
  ProtocolClause,
  ProtocolDeclaration,
  ProtocolTypeFunction,
  SourceFile,
  Statement,
  SymbolDeclaration,
  ThunkExpression,
  TsExpression,
  TsExpressionPart,
  TypeAnnotation,
  VariableStatement,
} from "./ast";
import { offsetToPosition, positionToOffset, type Range } from "./source-map";

export class ParseError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} (at offset ${offset})`);
  }
}

class Parser {
  private pos = 0;

  constructor(
    private readonly text: string,
    private readonly fileName: string,
  ) {}

  parse(): SourceFile {
    this.skipTrivia();
    const statements: Statement[] = [];
    while (!this.eof()) {
      statements.push(this.parseStatement());
      this.skipTrivia();
    }
    return {
      kind: "SourceFile",
      fileName: this.fileName,
      text: this.text,
      statements,
    };
  }

  private parseStatement(): Statement {
    const start = this.pos;

    if (this.peekKeyword("import")) {
      return this.parseImportDeclaration(start);
    }

    if (this.peekKeyword("protocol")) {
      return this.parseProtocolDeclaration(start);
    }

    if (this.peekKeyword("abstract") || this.peekKeyword("symbol")) {
      return this.parseSymbolDeclaration(start);
    }

    if (this.peek() === "{") {
      return this.parseBlockStatement(start);
    }

    if (this.peekKeyword("if")) {
      return this.parseIfStatement(start);
    }

    if (this.peekKeyword("while")) {
      return this.parseWhileStatement(start);
    }

    if (this.peekKeyword("for")) {
      return this.parseForStatement(start);
    }

    if (this.peekKeyword("break")) {
      this.matchKeyword("break");
      this.expectSemiOrNewline();
      return {
        kind: "BreakStatement",
        range: this.range(start, this.pos),
      };
    }

    if (this.peekKeyword("continue")) {
      this.matchKeyword("continue");
      this.expectSemiOrNewline();
      return {
        kind: "ContinueStatement",
        range: this.range(start, this.pos),
      };
    }

    if (this.peekKeyword("return")) {
      this.matchKeyword("return");
      this.skipTrivia();
      const expression = this.parseExpression();
      this.expectSemiOrNewline();
      return {
        kind: "ReturnStatement",
        range: this.range(start, this.pos),
        expression,
      };
    }

    if (this.peekKeyword("const") || this.peekKeyword("let")) {
      return this.parseVariableStatement(start);
    }

    const expression = this.parseExpression();
    this.expectSemiOrNewline();
    return {
      kind: "ExpressionStatement",
      range: this.range(start, this.pos),
      expression,
    };
  }

  private parseBlockStatement(start: number): Statement {
    this.expect("{");
    this.skipTrivia();
    const statements: Statement[] = [];
    while (!this.eof() && this.peek() !== "}") {
      statements.push(this.parseStatement());
      this.skipTrivia();
    }
    this.expect("}");
    return {
      kind: "BlockStatement",
      range: this.range(start, this.pos),
      statements,
    };
  }

  private parseIfStatement(start: number): Statement {
    this.matchKeyword("if");
    this.skipTrivia();
    this.expect("(");
    this.skipTrivia();
    const condition = this.parseExpression();
    this.skipTrivia();
    this.expect(")");
    this.skipTrivia();
    const consequent = this.parseStatement();
    this.skipTrivia();
    let alternate: Statement | undefined;
    if (this.peekKeyword("else")) {
      this.matchKeyword("else");
      this.skipTrivia();
      alternate = this.parseStatement();
    }
    return {
      kind: "IfStatement",
      range: this.range(start, this.pos),
      condition,
      consequent,
      alternate,
    };
  }

  private parseWhileStatement(start: number): Statement {
    this.matchKeyword("while");
    this.skipTrivia();
    this.expect("(");
    this.skipTrivia();
    const condition = this.parseExpression();
    this.skipTrivia();
    this.expect(")");
    this.skipTrivia();
    const body = this.parseStatement();
    return {
      kind: "WhileStatement",
      range: this.range(start, this.pos),
      condition,
      body,
    };
  }

  private parseForStatement(start: number): Statement {
    this.matchKeyword("for");
    this.skipTrivia();
    this.expect("(");
    this.skipTrivia();

    let initializer: VariableStatement | ExpressionStatement | undefined;
    if (this.peek() !== ";") {
      if (this.peekKeyword("const") || this.peekKeyword("let")) {
        initializer = this.parseVariableStatement(this.pos, /*inFor*/ true);
      } else {
        const exprStart = this.pos;
        const expression = this.parseExpression();
        initializer = {
          kind: "ExpressionStatement",
          range: this.range(exprStart, this.pos),
          expression,
        };
      }
    }
    this.skipTrivia();
    this.expect(";");
    this.skipTrivia();

    let condition: Expression | undefined;
    if (this.peek() !== ";") {
      condition = this.parseExpression();
      this.skipTrivia();
    }
    this.expect(";");
    this.skipTrivia();

    let update: Expression | undefined;
    if (this.peek() !== ")") {
      update = this.parseExpression();
      this.skipTrivia();
    }
    this.expect(")");
    this.skipTrivia();
    const body = this.parseStatement();

    return {
      kind: "ForStatement",
      range: this.range(start, this.pos),
      initializer,
      condition,
      update,
      body,
    };
  }

  /** Variable statement; when `inFor`, stop after initializer (caller consumes `;`). */
  private parseVariableStatement(
    start: number,
    inFor = false,
  ): VariableStatement {
    const declarationKind = this.peekKeyword("const") ? "const" : "let";
    this.matchKeyword(declarationKind);
    this.skipTrivia();
    const name = this.parseIdentifier();
    this.skipTrivia();
    let typeAnnotation: TypeAnnotation | undefined;
    if (this.peek() === ":") {
      this.pos++;
      this.skipTrivia();
      typeAnnotation = this.parseTypeAnnotation();
      this.skipTrivia();
    }
    this.expect("=");
    this.skipTrivia();
    const initializer = this.parseExpression();
    if (!inFor) {
      this.expectSemiOrNewline();
    }
    return {
      kind: "VariableStatement",
      range: this.range(start, this.pos),
      declarationKind,
      name,
      typeAnnotation,
      initializer,
    };
  }

  /**
   * `import { a, type B as C } from "mod"`
   * `import type { A } from "mod"`
   */
  private parseImportDeclaration(start: number): ImportDeclaration {
    this.matchKeyword("import");
    this.skipTrivia();
    let isTypeOnly = false;
    if (this.peekKeyword("type")) {
      // Distinguish `import type {` from `import type` as a binding — only
      // `import type {` is type-only clause.
      const save = this.pos;
      this.matchKeyword("type");
      this.skipTrivia();
      if (this.peek() === "{") {
        isTypeOnly = true;
      } else {
        this.pos = save;
      }
    }
    this.expect("{");
    this.skipTrivia();
    const specifiers: ImportSpecifier[] = [];
    while (!this.eof() && this.peek() !== "}") {
      const specStart = this.pos;
      let specTypeOnly = false;
      if (this.peekKeyword("type")) {
        this.matchKeyword("type");
        this.skipTrivia();
        specTypeOnly = true;
      }
      const imported = this.parseIdentifier();
      this.skipTrivia();
      let local = imported.name;
      if (this.peekKeyword("as")) {
        this.matchKeyword("as");
        this.skipTrivia();
        local = this.parseIdentifier().name;
        this.skipTrivia();
      }
      specifiers.push({
        imported: imported.name,
        local,
        isTypeOnly: isTypeOnly || specTypeOnly,
        range: this.range(specStart, this.pos),
      });
      if (this.peek() === ",") {
        this.pos++;
        this.skipTrivia();
      }
    }
    this.expect("}");
    this.skipTrivia();
    if (!this.matchKeyword("from")) {
      throw new ParseError("expected 'from'", this.pos);
    }
    this.skipTrivia();
    const module = this.parseStringLiteral();
    this.expectSemiOrNewline();
    const end = this.pos;
    return {
      kind: "ImportDeclaration",
      isTypeOnly,
      specifiers,
      module,
      text: this.text.slice(start, end).trimEnd(),
      range: this.range(start, end),
    };
  }

  private parseStringLiteral(): string {
    this.skipTrivia();
    const q = this.peek();
    if (q !== '"' && q !== "'") {
      throw new ParseError("expected string literal", this.pos);
    }
    const start = this.pos;
    this.consumeString(q);
    const raw = this.text.slice(start, this.pos);
    return raw.slice(1, -1);
  }

  /**
   * Type annotation: base TS type + optional postfix `Requires(...)` / `Once`.
   */
  private parseTypeAnnotation(): TypeAnnotation {
    const start = this.pos;
    const baseText = this.consumeTypeBase();
    this.skipTrivia();
    const protocols: ProtocolClause[] = [];
    while (this.peekKeyword("Requires") || this.peekKeyword("Once")) {
      protocols.push(this.parseProtocolClause());
      this.skipTrivia();
    }
    const end = this.pos;
    return {
      baseText: baseText.trim(),
      protocols,
      range: this.range(start, end),
    };
  }

  /** Consume type text until postfix protocol keyword or `=` at depth 0. */
  private consumeTypeBase(): string {
    const start = this.pos;
    let depthParen = 0;
    let depthBrace = 0;
    let depthAngle = 0;
    let depthBracket = 0;

    while (!this.eof()) {
      this.skipSpaces();
      if (
        depthParen === 0 &&
        depthBrace === 0 &&
        depthAngle === 0 &&
        depthBracket === 0
      ) {
        if (this.peek() === "=") break;
        if (this.peek() === "\n") {
          // Look ahead: newline then Requires/Once continues annotation;
          // newline then = or other statement ends base (protocols parsed after).
          const save = this.pos;
          this.pos++;
          this.skipTrivia();
          if (this.peekKeyword("Requires") || this.peekKeyword("Once")) {
            this.pos = save;
            break;
          }
          if (this.peek() === "=") {
            this.pos = save;
            break;
          }
          this.pos = save;
        }
        if (this.peekKeyword("Requires") || this.peekKeyword("Once")) break;
      }

      const c = this.peek();
      if (c === "\n" && depthParen === 0 && depthBrace === 0 && depthAngle === 0) {
        // include newline in base only if continuing type (generics rarely span);
        // stop before postfix protocols (handled above)
        const save = this.pos;
        this.pos++;
        this.skipTrivia();
        if (this.peekKeyword("Requires") || this.peekKeyword("Once") || this.peek() === "=") {
          this.pos = save;
          break;
        }
        this.pos = save;
      }

      if (c === "(") depthParen++;
      else if (c === ")") {
        if (depthParen === 0) break;
        depthParen--;
      } else if (c === "{") depthBrace++;
      else if (c === "}") {
        if (depthBrace === 0) break;
        depthBrace--;
      } else if (c === "<") depthAngle++;
      else if (c === ">") {
        if (depthAngle === 0) break;
        depthAngle--;
      } else if (c === "[") depthBracket++;
      else if (c === "]") {
        if (depthBracket === 0) break;
        depthBracket--;
      } else if (c === '"' || c === "'" || c === "`") {
        this.consumeString(c);
        continue;
      } else if (c === ";" && depthParen === 0 && depthBrace === 0) {
        break;
      }
      this.pos++;
    }

    const raw = this.text.slice(start, this.pos);
    const trimmed = raw.trimEnd();
    if (!trimmed) {
      throw new ParseError("expected type", start);
    }
    this.pos = start + trimmed.length;
    return trimmed;
  }

  private parseProtocolClause(): ProtocolClause {
    const start = this.pos;
    if (this.matchKeyword("Requires")) {
      this.skipTrivia();
      this.expect("(");
      const payloadStart = this.pos;
      let depth = 1;
      while (!this.eof() && depth > 0) {
        const c = this.peek();
        if (c === "(") depth++;
        else if (c === ")") {
          depth--;
          if (depth === 0) break;
        } else if (c === '"' || c === "'" || c === "`") {
          this.consumeString(c);
          continue;
        }
        this.pos++;
      }
      const payload = this.text.slice(payloadStart, this.pos).trim();
      this.expect(")");
      return {
        name: "Requires",
        payload,
        range: this.range(start, this.pos),
      };
    }
    if (this.matchKeyword("Once")) {
      return {
        name: "Once",
        range: this.range(start, this.pos),
      };
    }
    throw new ParseError("expected protocol clause", this.pos);
  }

  private parseProtocolDeclaration(start: number): ProtocolDeclaration {
    this.matchKeyword("protocol");
    this.skipTrivia();
    const name = this.parseIdentifier();
    this.skipTrivia();
    let typeParams = "";
    if (this.peek() === "<") {
      typeParams = this.consumeBalanced("<", ">");
    }
    this.skipTrivia();
    this.expect("{");
    this.skipTrivia();
    const members: ProtocolTypeFunction[] = [];
    while (!this.eof() && this.peek() !== "}") {
      members.push(this.parseProtocolMember());
      this.skipTrivia();
    }
    this.expect("}");
    return {
      kind: "ProtocolDeclaration",
      range: this.range(start, this.pos),
      name,
      typeParams: typeParams.replace(/^</, "").replace(/>$/, "").trim(),
      members,
    };
  }

  /**
   * `symbol Name = Type;` / `symbol Name { ... }` /
   * `abstract symbol …` / `symbol Name extends Parent [{ … }]`
   * Not parsed in expression position (anonymous symbols deferred).
   */
  private parseSymbolDeclaration(start: number): SymbolDeclaration {
    const isAbstract = this.matchKeyword("abstract");
    this.skipTrivia();
    if (!this.matchKeyword("symbol")) {
      throw new ParseError("Expected 'symbol' after 'abstract'", this.pos);
    }
    this.skipTrivia();
    const name = this.parseIdentifier();
    this.skipTrivia();

    let extendsName: Identifier | undefined;
    if (this.matchKeyword("extends")) {
      this.skipTrivia();
      extendsName = this.parseIdentifier();
      this.skipTrivia();
    }

    if (this.peek() === "{") {
      const typeStart = this.pos;
      const braces = this.consumeBalanced("{", "}");
      this.expectSemiOrNewline();
      const emptyBody = braces.replace(/\s/g, "") === "{}";
      return {
        kind: "SymbolDeclaration",
        name,
        isAbstract,
        extendsName,
        associatedType:
          extendsName && emptyBody
            ? undefined
            : {
                form: "object",
                text: braces,
                range: this.range(typeStart, typeStart + braces.length),
              },
        range: this.range(start, this.pos),
      };
    }

    if (extendsName) {
      // `symbol Child extends Parent` — inherit associated type
      this.expectSemiOrNewline();
      return {
        kind: "SymbolDeclaration",
        name,
        isAbstract,
        extendsName,
        range: this.range(start, this.pos),
      };
    }

    this.expect("=");
    this.skipTrivia();
    const typeStart = this.pos;
    const aliasText = this.consumeAssociatedTypeAlias();
    this.expectSemiOrNewline();
    return {
      kind: "SymbolDeclaration",
      name,
      isAbstract,
      associatedType: {
        form: "alias",
        text: aliasText,
        range: this.range(typeStart, typeStart + aliasText.length),
      },
      range: this.range(start, this.pos),
    };
  }

  /**
   * Associated type after `symbol Name =` — stop at `;` or newline at depth 0
   * (unlike type annotations, which continue until `=`).
   */
  private consumeAssociatedTypeAlias(): string {
    const start = this.pos;
    let depthParen = 0;
    let depthBrace = 0;
    let depthAngle = 0;
    let depthBracket = 0;

    while (!this.eof()) {
      const c = this.peek();
      if (
        depthParen === 0 &&
        depthBrace === 0 &&
        depthAngle === 0 &&
        depthBracket === 0
      ) {
        if (c === ";" || c === "\n") break;
      }
      if (c === "(") depthParen++;
      else if (c === ")") {
        if (depthParen === 0) break;
        depthParen--;
      } else if (c === "{") depthBrace++;
      else if (c === "}") {
        if (depthBrace === 0) break;
        depthBrace--;
      } else if (c === "<") depthAngle++;
      else if (c === ">") {
        if (depthAngle === 0) break;
        depthAngle--;
      } else if (c === "[") depthBracket++;
      else if (c === "]") {
        if (depthBracket === 0) break;
        depthBracket--;
      } else if (c === '"' || c === "'" || c === "`") {
        this.consumeString(c);
        continue;
      }
      this.pos++;
    }

    const raw = this.text.slice(start, this.pos);
    const trimmed = raw.trimEnd();
    if (!trimmed) {
      throw new ParseError("expected type", start);
    }
    this.pos = start + trimmed.length;
    return trimmed;
  }

  private parseProtocolMember(): ProtocolTypeFunction {
    const start = this.pos;
    const name = this.parseIdentifier();
    this.skipTrivia();
    let typeParams = "";
    if (this.peek() === "<") {
      typeParams = this.consumeBalanced("<", ">");
    }
    this.skipTrivia();
    this.expect(":");
    this.skipTrivia();
    const resultStart = this.pos;
    // Result type until `;` or newline at depth 0
    let depthAngle = 0;
    let depthBrace = 0;
    let depthParen = 0;
    while (!this.eof()) {
      const c = this.peek();
      if (
        depthAngle === 0 &&
        depthBrace === 0 &&
        depthParen === 0 &&
        (c === ";" || c === "\n" || c === "}")
      ) {
        break;
      }
      if (c === "<") depthAngle++;
      else if (c === ">") depthAngle--;
      else if (c === "{") depthBrace++;
      else if (c === "}") {
        if (depthBrace === 0) break;
        depthBrace--;
      } else if (c === "(") depthParen++;
      else if (c === ")") depthParen--;
      else if (c === '"' || c === "'" || c === "`") {
        this.consumeString(c);
        continue;
      }
      this.pos++;
    }
    const resultType = this.text.slice(resultStart, this.pos).trim();
    this.skipSpaces();
    if (this.peek() === ";") this.pos++;
    return {
      name: name.name,
      typeParams,
      resultType,
      range: this.range(start, this.pos),
    };
  }

  private consumeBalanced(open: string, close: string): string {
    const start = this.pos;
    this.expect(open);
    let depth = 1;
    while (!this.eof() && depth > 0) {
      const c = this.peek();
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          this.pos++;
          break;
        }
      } else if (c === '"' || c === "'" || c === "`") {
        this.consumeString(c);
        continue;
      }
      if (depth > 0) this.pos++;
    }
    return this.text.slice(start, this.pos);
  }

  private parseExpression(): Expression {
    this.skipTrivia();
    const start = this.pos;

    if (this.matchKeyword("thunk")) {
      this.skipTrivia();
      this.expect("{");
      this.skipTrivia();
      const body: Statement[] = [];
      while (!this.eof() && this.peek() !== "}") {
        body.push(this.parseStatement());
        this.skipTrivia();
      }
      this.expect("}");
      const expr: ThunkExpression = {
        kind: "ThunkExpression",
        range: this.range(start, this.pos),
        body,
      };
      return expr;
    }

    if (this.matchKeyword("run")) {
      this.skipTrivia();
      const inner = this.parseRunOperand();
      return {
        kind: "RunExpression",
        range: this.range(start, this.pos),
        expression: inner,
      };
    }

    return this.parseTsExpression();
  }

  /**
   * Operand of `run`, like `await`: a full expression (member access, calls,
   * nested `thunk { … }`, nested `run`, …) — not only a bare identifier.
   */
  private parseRunOperand(): Expression {
    return this.parseExpression();
  }

  private parseTsExpression(): TsExpression {
    this.skipTrivia();
    const start = this.pos;
    let depthParen = 0;
    let depthBrace = 0;
    let depthBracket = 0;
    const parts: TsExpressionPart[] = [];
    let chunkStart = this.pos;

    const flush = () => {
      if (this.pos > chunkStart) {
        parts.push({
          kind: "text",
          text: this.text.slice(chunkStart, this.pos),
          range: this.range(chunkStart, this.pos),
        });
        chunkStart = this.pos;
      }
    };

    while (!this.eof()) {
      const c = this.peek();
      if (depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
        if (c === ";" || c === "\n" || c === "}") break;
      }

      if (
        this.tryEmbedThunkOrRun(parts, () => {
          flush();
        })
      ) {
        chunkStart = this.pos;
        continue;
      }

      if (c === "(") depthParen++;
      else if (c === ")") {
        if (depthParen === 0) break;
        depthParen--;
      } else if (c === "{") depthBrace++;
      else if (c === "}") {
        if (depthBrace === 0) break;
        depthBrace--;
      } else if (c === "[") depthBracket++;
      else if (c === "]") {
        if (depthBracket === 0) break;
        depthBracket--;
      } else if (c === '"' || c === "'" || c === "`") {
        this.consumeString(c);
        continue;
      }
      this.pos++;
    }

    flush();

    // Trim trailing whitespace (same contract as before).
    let end = this.pos;
    while (parts.length > 0) {
      const last = parts[parts.length - 1]!;
      if (last.kind !== "text") break;
      const trimmed = last.text.trimEnd();
      if (trimmed.length === last.text.length) break;
      if (trimmed.length === 0) {
        parts.pop();
        continue;
      }
      const partStart = positionToOffset(this.text, last.range.start);
      const newEnd = partStart + trimmed.length;
      parts[parts.length - 1] = {
        kind: "text",
        text: trimmed,
        range: this.range(partStart, newEnd),
      };
      end = newEnd;
      break;
    }
    if (parts.length > 0) {
      const last = parts[parts.length - 1]!;
      end =
        last.kind === "text"
          ? positionToOffset(this.text, last.range.end)
          : positionToOffset(this.text, last.expression.range.end);
    }

    this.pos = end;
    if (parts.length === 0) {
      throw new ParseError("expected expression", start);
    }
    const text = this.text.slice(start, end);
    if (!text) {
      throw new ParseError("expected expression", start);
    }
    return {
      kind: "TsExpression",
      range: this.range(start, end),
      text,
      parts: this.mergeAdjacentTextParts(parts),
    };
  }

  /**
   * If at `thunk { … }`, flush pending text, parse it, and push an embedded
   * part. Returns true when an embed was consumed.
   *
   * Nested `run` is not auto-detected here: `run` is too easy to confuse with
   * property access (`x.run`) inside opaque TypeScript.
   */
  private tryEmbedThunkOrRun(
    parts: TsExpressionPart[],
    onBeforeEmbed: () => void,
  ): boolean {
    if (!this.atIdentBoundary()) return false;

    if (this.peekKeyword("thunk")) {
      const save = this.pos;
      this.matchKeyword("thunk");
      this.skipTrivia();
      if (this.peek() === "{") {
        this.pos = save;
        onBeforeEmbed();
        parts.push({
          kind: "embedded",
          expression: this.parseExpression(),
        });
        return true;
      }
      this.pos = save;
    }

    return false;
  }

  private atIdentBoundary(): boolean {
    if (!this.isIdentStart(this.peek())) return false;
    if (this.pos > 0 && this.isIdentPart(this.text[this.pos - 1]!)) {
      return false;
    }
    return true;
  }

  private mergeAdjacentTextParts(
    parts: readonly TsExpressionPart[],
  ): TsExpressionPart[] {
    const out: TsExpressionPart[] = [];
    for (const part of parts) {
      const prev = out[out.length - 1];
      if (part.kind === "text" && prev?.kind === "text") {
        out[out.length - 1] = {
          kind: "text",
          text: prev.text + part.text,
          range: {
            start: prev.range.start,
            end: part.range.end,
          },
        };
      } else if (part.kind === "text" && part.text.length === 0) {
        continue;
      } else {
        out.push(part);
      }
    }
    return out;
  }

  private consumeString(quote: string): void {
    this.pos++;
    while (!this.eof()) {
      const c = this.peek();
      if (c === "\\") {
        this.pos += 2;
        continue;
      }
      if (c === quote) {
        this.pos++;
        return;
      }
      this.pos++;
    }
  }

  private parseIdentifier(): Identifier {
    this.skipTrivia();
    const start = this.pos;
    if (!this.isIdentStart(this.peek())) {
      throw new ParseError("expected identifier", this.pos);
    }
    this.pos++;
    while (!this.eof() && this.isIdentPart(this.peek())) this.pos++;
    return {
      kind: "Identifier",
      range: this.range(start, this.pos),
      name: this.text.slice(start, this.pos),
    };
  }

  private expectSemiOrNewline(): void {
    this.skipSpaces();
    if (this.peek() === ";") {
      this.pos++;
    }
  }

  private expect(ch: string): void {
    this.skipTrivia();
    if (this.peek() !== ch) {
      throw new ParseError(`expected '${ch}'`, this.pos);
    }
    this.pos++;
  }

  private peekKeyword(kw: string): boolean {
    this.skipTrivia();
    if (!this.text.startsWith(kw, this.pos)) return false;
    const after = this.pos + kw.length;
    if (after < this.text.length && this.isIdentPart(this.text[after]!)) {
      return false;
    }
    return true;
  }

  private matchKeyword(kw: string): boolean {
    if (!this.peekKeyword(kw)) return false;
    this.pos += kw.length;
    return true;
  }

  private skipTrivia(): void {
    while (!this.eof()) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        this.pos++;
        continue;
      }
      if (c === "/" && this.text[this.pos + 1] === "/") {
        this.pos += 2;
        while (!this.eof() && this.peek() !== "\n") this.pos++;
        continue;
      }
      if (c === "/" && this.text[this.pos + 1] === "*") {
        this.pos += 2;
        while (!this.eof()) {
          if (this.peek() === "*" && this.text[this.pos + 1] === "/") {
            this.pos += 2;
            break;
          }
          this.pos++;
        }
        continue;
      }
      break;
    }
  }

  private skipSpaces(): void {
    while (!this.eof()) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\r") this.pos++;
      else break;
    }
  }

  private peek(): string {
    return this.text[this.pos] ?? "";
  }

  private eof(): boolean {
    return this.pos >= this.text.length;
  }

  private isIdentStart(c: string): boolean {
    return /[A-Za-z_$]/.test(c);
  }

  private isIdentPart(c: string): boolean {
    return /[A-Za-z0-9_$]/.test(c);
  }

  private range(start: number, end: number): Range {
    return {
      start: offsetToPosition(this.text, start),
      end: offsetToPosition(this.text, end),
    };
  }
}

export function parseThunkSource(
  text: string,
  fileName = "input.thunk",
): SourceFile {
  return new Parser(text, fileName).parse();
}
