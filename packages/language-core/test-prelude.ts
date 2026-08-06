/** Prepend mandatory code-file prelude for unit-test snippets. */
export function withPrelude(src: string, feature = "Test"): string {
  const body = src.startsWith("\n") ? src.slice(1) : src;
  return `file Test of ${feature}\n${body}`;
}

/** Statements after the required feature/file / optional tags prelude. */
export function bodyStmts<T extends { kind: string }>(
  ast: { statements: readonly T[] },
): T[] {
  return ast.statements.filter(
    (s) =>
      s.kind !== "FeatureDeclaration" &&
      s.kind !== "FileDeclaration" &&
      s.kind !== "TagsDeclaration",
  );
}
