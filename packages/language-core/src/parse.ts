/**
 * Hand-written hybrid parser for Thunk source.
 *
 * Parses thunk / run structurally; captures ordinary TypeScript control flow
 * and expressions as opaque text spans.
 */

import type {
  Expression,
  Identifier,
  SourceFile,
  Statement,
  ThunkExpression,
  TsExpression,
  TsStatement,
} from "./ast";
import { offsetToPosition, type Range } from "./source-map";

export class ParseError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} (at offset ${offset})`);
  }
}

const CONTROL_FLOW = [
  "if",
  "for",
  "while",
  "switch",
  "try",
  "do",
] as const;

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
      const declarationKind = this.peekKeyword("const") ? "const" : "let";
      this.matchKeyword(declarationKind);
      this.skipTrivia();
      const name = this.parseIdentifier();
      this.skipTrivia();
      let typeAnnotation: string | undefined;
      if (this.peek() === ":") {
        this.pos++;
        typeAnnotation = this.consumeTypeAnnotation();
        this.skipTrivia();
      }
      this.expect("=");
      this.skipTrivia();
      const initializer = this.parseExpression();
      this.expectSemiOrNewline();
      return {
        kind: "VariableStatement",
        range: this.range(start, this.pos),
        declarationKind,
        name,
        typeAnnotation,
        initializer,
      };
    }

    if (
      this.peekKeyword("function") ||
      this.peekKeyword("async") ||
      this.peekKeyword("class") ||
      this.peek() === "{" ||
      CONTROL_FLOW.some((kw) => this.peekKeyword(kw))
    ) {
      return this.parseTsStatement();
    }

    const expression = this.parseExpression();
    this.expectSemiOrNewline();
    return {
      kind: "ExpressionStatement",
      range: this.range(start, this.pos),
      expression,
    };
  }

  private parseTsStatement(): TsStatement {
    const start = this.pos;
    this.consumeTsStatement();
    const end = this.pos;
    const text = this.text.slice(start, end).trimEnd();
    if (containsDisallowedRun(text)) {
      throw new ParseError(
        "`run` is not allowed inside control-flow / opaque TypeScript statements yet; keep `run` at thunk statement-list position",
        start,
      );
    }
    return {
      kind: "TsStatement",
      range: this.range(start, start + text.length),
      text,
    };
  }

  /** Consume one TypeScript statement (control flow, function, block, …). */
  private consumeTsStatement(): void {
    this.skipTrivia();

    if (this.peek() === "{") {
      this.consumeBalanced("{", "}");
      return;
    }

    if (this.peekKeyword("async")) {
      this.matchKeyword("async");
      this.skipTrivia();
    }

    if (this.peekKeyword("function")) {
      this.matchKeyword("function");
      this.skipTrivia();
      if (this.isIdentStart(this.peek())) this.parseIdentifier();
      this.skipTrivia();
      this.consumeBalanced("(", ")");
      this.skipTrivia();
      if (this.peek() === ":") {
        this.pos++;
        // Prototype: stop at the body `{` (object-literal return types not supported here).
        while (!this.eof() && this.peek() !== "{") {
          const c = this.peek();
          if (c === '"' || c === "'" || c === "`") {
            this.consumeString(c);
            continue;
          }
          if (c === "<") {
            this.consumeBalanced("<", ">");
            continue;
          }
          if (c === "(") {
            this.consumeBalanced("(", ")");
            continue;
          }
          if (c === "[") {
            this.consumeBalanced("[", "]");
            continue;
          }
          this.pos++;
        }
        this.skipTrivia();
      }
      this.consumeBalanced("{", "}");
      return;
    }

    if (this.peekKeyword("class")) {
      this.matchKeyword("class");
      this.skipTrivia();
      if (this.isIdentStart(this.peek())) this.parseIdentifier();
      this.skipTrivia();
      // optional heritage — consume until body
      while (!this.eof() && this.peek() !== "{") this.pos++;
      this.consumeBalanced("{", "}");
      return;
    }

    if (this.peekKeyword("if")) {
      this.matchKeyword("if");
      this.skipTrivia();
      this.consumeBalanced("(", ")");
      this.skipTrivia();
      this.consumeTsStatement();
      this.skipTrivia();
      if (this.peekKeyword("else")) {
        this.matchKeyword("else");
        this.skipTrivia();
        this.consumeTsStatement();
      }
      return;
    }

    if (this.peekKeyword("for")) {
      this.matchKeyword("for");
      this.skipTrivia();
      this.consumeBalanced("(", ")");
      this.skipTrivia();
      this.consumeTsStatement();
      return;
    }

    if (this.peekKeyword("while")) {
      this.matchKeyword("while");
      this.skipTrivia();
      this.consumeBalanced("(", ")");
      this.skipTrivia();
      this.consumeTsStatement();
      return;
    }

    if (this.peekKeyword("do")) {
      this.matchKeyword("do");
      this.skipTrivia();
      this.consumeTsStatement();
      this.skipTrivia();
      this.expectKeyword("while");
      this.skipTrivia();
      this.consumeBalanced("(", ")");
      this.expectSemiOrNewline();
      return;
    }

    if (this.peekKeyword("switch")) {
      this.matchKeyword("switch");
      this.skipTrivia();
      this.consumeBalanced("(", ")");
      this.skipTrivia();
      this.consumeBalanced("{", "}");
      return;
    }

    if (this.peekKeyword("try")) {
      this.matchKeyword("try");
      this.skipTrivia();
      this.consumeBalanced("{", "}");
      this.skipTrivia();
      while (this.peekKeyword("catch") || this.peekKeyword("finally")) {
        if (this.peekKeyword("catch")) {
          this.matchKeyword("catch");
          this.skipTrivia();
          if (this.peek() === "(") {
            this.consumeBalanced("(", ")");
            this.skipTrivia();
          }
          this.consumeBalanced("{", "}");
        } else {
          this.matchKeyword("finally");
          this.skipTrivia();
          this.consumeBalanced("{", "}");
        }
        this.skipTrivia();
      }
      return;
    }

    // Fallback: expression-like statement until ; or newline
    this.parseTsExpression();
    this.expectSemiOrNewline();
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

  private parseRunOperand(): Expression {
    this.skipTrivia();
    const start = this.pos;
    if (this.isIdentStart(this.peek())) {
      const ident = this.parseIdentifier();
      this.skipSpaces();
      if (this.peek() === "(") {
        const callText = this.consumeCallAfterIdent(start);
        return {
          kind: "TsExpression",
          range: this.range(start, this.pos),
          text: callText,
        };
      }
      return ident;
    }
    return this.parseTsExpression();
  }

  private consumeCallAfterIdent(start: number): string {
    this.expect("(");
    let depth = 1;
    while (!this.eof() && depth > 0) {
      const c = this.peek();
      if (c === "(") depth++;
      else if (c === ")") depth--;
      if (depth === 0) break;
      if (c === '"' || c === "'" || c === "`") {
        this.consumeString(c);
        continue;
      }
      this.pos++;
    }
    this.expect(")");
    return this.text.slice(start, this.pos);
  }

  private parseTsExpression(): TsExpression {
    this.skipTrivia();
    const start = this.pos;
    let depthParen = 0;
    let depthBrace = 0;
    let depthBracket = 0;

    while (!this.eof()) {
      const c = this.peek();
      if (depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
        if (c === ";" || c === "\n" || c === "}") break;
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

    const raw = this.text.slice(start, this.pos);
    const trimmed = raw.trimEnd();
    if (!trimmed) {
      throw new ParseError("expected expression", start);
    }
    const end = start + trimmed.length;
    this.pos = end;
    return {
      kind: "TsExpression",
      range: this.range(start, end),
      text: trimmed,
    };
  }

  /** Consume a type annotation after `:`, stopping before `=` (not `=>`). */
  private consumeTypeAnnotation(): string {
    this.skipTrivia();
    const start = this.pos;
    let depthParen = 0;
    let depthBrace = 0;
    let depthBracket = 0;
    let depthAngle = 0;

    while (!this.eof()) {
      const c = this.peek();
      if (
        depthParen === 0 &&
        depthBrace === 0 &&
        depthBracket === 0 &&
        depthAngle === 0 &&
        c === "=" &&
        this.text[this.pos + 1] !== ">"
      ) {
        break;
      }
      if (c === "(") depthParen++;
      else if (c === ")") depthParen--;
      else if (c === "{") depthBrace++;
      else if (c === "}") depthBrace--;
      else if (c === "[") depthBracket++;
      else if (c === "]") depthBracket--;
      else if (c === "<") depthAngle++;
      else if (c === ">") depthAngle--;
      else if (c === '"' || c === "'" || c === "`") {
        this.consumeString(c);
        continue;
      }
      this.pos++;
    }

    return this.text.slice(start, this.pos).trim();
  }

  private consumeBalanced(open: string, close: string): void {
    this.skipTrivia();
    if (this.peek() !== open) {
      throw new ParseError(`expected '${open}'`, this.pos);
    }
    this.pos++;
    let depth = 1;
    while (!this.eof() && depth > 0) {
      const c = this.peek();
      if (c === '"' || c === "'" || c === "`") {
        this.consumeString(c);
        continue;
      }
      if (c === open) depth++;
      else if (c === close) depth--;
      if (depth === 0) {
        this.pos++;
        return;
      }
      this.pos++;
    }
    throw new ParseError(`unbalanced '${open}${close}'`, this.pos);
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

  private expectKeyword(kw: string): void {
    if (!this.matchKeyword(kw)) {
      throw new ParseError(`expected '${kw}'`, this.pos);
    }
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
        while (!this.eof() && !(this.peek() === "*" && this.text[this.pos + 1] === "/")) {
          this.pos++;
        }
        this.pos += 2;
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

/** True if opaque TS text appears to contain a Thunk `run` keyword. */
function containsDisallowedRun(text: string): boolean {
  return /(^|[^.\w])run\b/.test(text);
}

export function parseThunkSource(
  text: string,
  fileName = "input.thunk",
): SourceFile {
  return new Parser(text, fileName).parse();
}
