/**
 * The SQL plumbing shared by the rbac-db delegate files (12-13): the runner
 * interface both PGlite and its transactions expose, the growing parameter
 * list, the string-filter translation and the P2002-shaped rethrow.
 */

/** The one query surface both PGlite and its transactions expose. */
export interface SqlRunner {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
}

/** A growing `$1, $2, …` parameter list. */
export class Params {
  values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** Translate the seam's closed string-filter shapes onto one column. */
export function stringPredicate(
  column: string,
  filter: string | { in: string[] } | { contains: string; mode: 'insensitive' },
  params: Params,
): string {
  if (typeof filter === 'string') return `${column} = ${params.add(filter)}`;
  if ('in' in filter) {
    if (filter.in.length === 0) return 'FALSE';
    return `${column} IN (${filter.in.map((value) => params.add(value)).join(', ')})`;
  }
  return `${column} ILIKE ${params.add(`%${filter.contains}%`)}`;
}

/** A P2002-shaped rethrow, so the package's 409 mapping fires as with Prisma. */
export function rethrowUnique(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/unique|duplicate key/i.test(message)) {
    throw Object.assign(new Error(message), { code: 'P2002' });
  }
  throw error;
}
