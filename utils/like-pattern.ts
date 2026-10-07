/**
 * `%`, `_` and `\` in a user's search text are text, not wildcards.
 *
 * Escape the text before wrapping it in a pattern (`${escapeLike(term)}%`), with
 * PostgreSQL's default escape character. Unescaped, a typed `_` matches any
 * character and a typed `%` matches everything.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}
