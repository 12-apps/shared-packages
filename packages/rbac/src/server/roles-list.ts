import {
  paginationMeta,
  type PaginationMeta,
} from './context';
import { ROLE_SELECT, type RoleOrderBy, type RoleWhere } from './db';
import {
  toRoleRecord,
  type RoleListQuery,
  type RoleListRecord,
  type RolesStoreCtx,
} from './roles-store';

/**
 * THE ROLES LIST — the query behind Admin › Papéis, and the one place that
 * decides which roles a filter means.
 *
 * Split out of `./roles-store` because it stopped being a `findMany` with a
 * `where`. The grid's two word columns read the DISPLAYED pair — a seeded role
 * stored as `ADMIN` reads "Administrador" for a pt-BR reader — and those words
 * are composed per reader from the host's catalog, so the database has never
 * seen them and no `WHERE` or `ORDER BY` can express them. Search and sort
 * therefore happen where the words are, which is here.
 *
 * Everything that IS a column still happens at the database: the tenant scope,
 * the liveness predicate and the Tipo pill are all in {@link listWhere}, and the
 * base order is the database's too.
 */

/**
 * The structural half of the filter — tenant, liveness and the Tipo pill.
 *
 * The `q` term is NOT here, and that is what the screen's language cost. A
 * database `contains` over the stored columns answers a search box whose
 * contents the reader cannot see: they type the word in front of them and get
 * nothing. It is applied in {@link matchesTerm} instead, over the stored fields
 * AND the displayed ones, so either finds the row.
 */
function listWhere(tenantId: string, query: RoleListQuery): RoleWhere {
  return {
    clientId: tenantId,
    archivedAt: null,
    ...(query.kindIn && query.kindIn.length > 0 ? { kind: { in: [...query.kindIn] } } : {}),
  };
}

/**
 * How many of a tenant's roles one list call considers.
 *
 * The page is cut from the tenant's own rows rather than by `LIMIT/OFFSET`,
 * because the filter and the order are over words the database does not hold.
 * This is the bound on that read.
 *
 * A role catalog is small by construction and by hand: every tenant gets the
 * host's seeded templates and adds custom roles one at a time through a dialog.
 * A thousand is far past any real catalog and still one cheap indexed read on a
 * per-tenant column. A tenant beyond it would see the first thousand by stored
 * name; nothing in the product can produce one.
 */
const ROLE_LIST_SCAN_LIMIT = 1000;

/** Case-insensitive `contains`, on the words a reader can actually see. */
function matchesTerm(record: RoleListRecord, term: string): boolean {
  const needle = term.toLocaleLowerCase();
  return [record.name, record.description, record.displayName, record.displayDescription].some(
    (value) => value !== null && value !== undefined && value.toLocaleLowerCase().includes(needle),
  );
}

/**
 * Order by the words on screen.
 *
 * Only the `name` sort is re-ordered here: `createdAt` is a column, the database
 * already ordered by it, and a timestamp reads the same in every language. A
 * name does not — pt-BR's "Proprietário" sorts after "Gerente" where `OWNER`
 * sorts before `MANAGER` — so the column order is not the order the reader is
 * looking at. `localeCompare` with the reader's own tag is what puts accented
 * names where that reader expects them; `id` breaks a tie so a page boundary
 * cannot land inside an unordered group.
 */
function sortForReader(
  records: RoleListRecord[],
  query: RoleListQuery,
  locale: string | undefined,
): RoleListRecord[] {
  if (query.sort && query.sort.field === 'createdAt') return records;
  const direction = query.sort?.direction === 'desc' ? -1 : 1;
  return [...records].sort((left, right) => {
    const byName = left.displayName.localeCompare(right.displayName, locale);
    return (byName !== 0 ? byName : left.id.localeCompare(right.id)) * direction;
  });
}

/** One page of a tenant's roles, in the words and the order its reader sees. */
export async function listRolesPage(
  ctx: RolesStoreCtx,
  tenantId: string,
  query: RoleListQuery,
): Promise<{ data: RoleListRecord[]; pagination: PaginationMeta }> {
  const db = await ctx.db();
  // The base order, and the whole order when sorting by `createdAt`. Stated even
  // for the name sort so the scan is deterministic before it is re-ordered.
  const orderBy: RoleOrderBy =
    query.sort && query.sort.field === 'createdAt'
      ? { createdAt: query.sort.direction }
      : { name: query.sort?.direction ?? 'asc' };
  const rows = await db.role.findMany({
    where: listWhere(tenantId, query),
    orderBy,
    take: ROLE_LIST_SCAN_LIMIT,
    select: ROLE_SELECT,
  });
  const records = rows.map((row) => ({
    ...toRoleRecord(row),
    ...ctx.display(row),
    kind: row.kind,
    locked: row.locked,
  }));
  const term = query.q;
  const matched = term ? records.filter((record) => matchesTerm(record, term)) : records;
  const ordered = sortForReader(matched, query, ctx.locale);
  const start = (query.page - 1) * query.pageSize;
  return {
    data: ordered.slice(start, start + query.pageSize),
    pagination: paginationMeta(ordered.length, query.page, query.pageSize),
  };
}
