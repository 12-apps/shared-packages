/**
 * What every story in this package needs and none of them should restate: a
 * transport with no server behind it, and the wire records the screens read.
 *
 * It lives in `__stories__/` rather than beside the components because it is
 * neither shipped nor imported by them — the package's `files` list drops the
 * folder from the tarball, the same way it drops `__tests__/`.
 */
import { createWebEntityLifecycle, type WebEntityLifecycle } from '../create-web-entity-lifecycle';
import type {
  ApprovalRequestWire,
  ComparisonColumnWire,
  ComparisonRoleWire,
  ComparisonRowWire,
  DraftWire,
  RecycleBinEntryWire,
  VersionComparisonWire,
  VersionsWire,
} from '../api';
import { LifecycleHttpError, type LifecycleResult, type LifecycleTransport } from '../transport';

export const API_BASE = '/api/admin/minha-loja';

/** The host's own words for its collections — the package ships none. */
const LABELS = { product: 'Produto', category: 'Categoria', supplier: 'Fornecedor' };

/** A fixed instant: a story that renders "now" looks different every visit. */
const WHEN = new Date(Date.UTC(2026, 7, 14, 16, 45)).toISOString();

/**
 * A transport with no server behind it. `reads` is matched by URL PREFIX,
 * longest key first, so a story can answer `/approvals?status=PENDING` and
 * `/approvals?status=APPROVED` differently — which is what the inbox's filter
 * chips switch between. A {@link LifecycleHttpError} as the value is THROWN,
 * which is how the feature-off (403) states are staged.
 */
function fakeTransport(
  reads: Record<string, unknown>,
  writeResult: LifecycleResult<unknown> = { ok: true, data: undefined },
): LifecycleTransport {
  return {
    async get<T>(url: string): Promise<T> {
      const hit = Object.entries(reads)
        .sort(([a], [b]) => b.length - a.length)
        .find(([key]) => url.startsWith(key));
      if (!hit) throw new LifecycleHttpError(404, `Nada roteado para ${url}`);
      if (hit[1] instanceof LifecycleHttpError) throw hit[1];
      return { data: hit[1] } as T;
    },
    async send<T>(): Promise<LifecycleResult<T>> {
      return writeResult as LifecycleResult<T>;
    },
  };
}

/** The whole web surface, bound to a fake transport. */
export function surface(
  reads: Record<string, unknown> = {},
  writeResult?: LifecycleResult<unknown>,
): WebEntityLifecycle {
  return createWebEntityLifecycle({
    apiBase: API_BASE,
    transport: fakeTransport(reads, writeResult),
    entityTypeLabels: LABELS,
  });
}

export function binEntry(over: Partial<RecycleBinEntryWire> = {}): RecycleBinEntryWire {
  return {
    id: 'bin-1',
    entityType: 'product',
    entityId: 'p1',
    label: 'Coca-Cola Lata 350ml',
    deletedBy: 'u1',
    deletedByName: 'Ana Souza',
    deletedAt: WHEN,
    status: 'DELETED',
    children: [],
    ...over,
  };
}

export function changeRequest(over: Partial<ApprovalRequestWire> = {}): ApprovalRequestWire {
  return {
    id: 'cr-1',
    entityType: 'product',
    entityId: 'p1',
    action: 'UPDATE',
    label: 'Coca-Cola Lata 350ml',
    status: 'PENDING',
    requestedBy: 'u2',
    requestedByName: 'Bruno Lima',
    requestedAt: WHEN,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    ...over,
  };
}

export const DRAFT: DraftWire = {
  id: 'd1',
  entityId: 'p1',
  data: { name: 'Coca-Cola Lata 350ml', priceCents: 650 },
  status: 'OPEN',
  updatedAt: WHEN,
};

// ---------------------------------------------------------------------------
// Version history + comparison
// ---------------------------------------------------------------------------

/** Who edited at each version, so the columns are not all the same person. */
const WHO = ['Ana Souza', 'Bruno Lima', 'Ana Souza', 'Carla Dias'];

/** What the owner wrote in the note, one entry per version — the field that moves. */
export const NOTES: Record<number, string> = {
  1: 'Preço de lançamento',
  2: 'Promoção de julho',
  3: 'Preço normal',
  4: 'Promoção de agosto',
};

/** The name never moves: it is the evidence an untouched field stays out. */
export const NAMES: Record<number, string> = {
  1: 'Distribuidora Sul',
  2: 'Distribuidora Sul',
  3: 'Distribuidora Sul',
  4: 'Distribuidora Sul',
};

export function column(version: number, roles: ComparisonRoleWire[]): ComparisonColumnWire {
  return {
    version,
    roles,
    kind: version === 1 ? 'CREATE' : 'UPDATE',
    actorId: `u${version}`,
    actorName: WHO[version - 1] ?? 'Ana Souza',
    createdAt: new Date(Date.UTC(2026, 7, 10 + version, 14, 30)).toISOString(),
  };
}

/** One row from `{ version: value }`; `undefined` marks a column that lacks it. */
export function row(
  field: string,
  values: Record<number, string | number | boolean | null | undefined>,
): ComparisonRowWire {
  const cells = Object.entries(values).map(([version, value]) => ({
    version: Number(version),
    present: value !== undefined,
    value: value === undefined ? null : value,
  }));
  const [first, ...rest] = cells;
  const same = (a: (typeof cells)[number], b: (typeof cells)[number]): boolean =>
    a.present === b.present && (!a.present || a.value === b.value);
  return {
    field,
    cells,
    changed: first !== undefined && rest.some((cell) => !same(first, cell)),
  };
}

export function comparison(
  selectedVersion: number,
  columns: ComparisonColumnWire[],
  rows: ComparisonRowWire[],
): VersionComparisonWire {
  return { selectedVersion, columns, rows };
}

/** A v1..v4 history, newest first, as the dialog lists it. */
export const HISTORY: VersionsWire['versions'] = [4, 3, 2, 1].map((version) => ({
  version,
  kind: version === 1 ? ('CREATE' as const) : ('UPDATE' as const),
  actorId: `u${version}`,
  actorName: WHO[version - 1] ?? 'Ana Souza',
  createdAt: new Date(Date.UTC(2026, 7, 10 + version, 14, 30)).toISOString(),
  changedFields: version === 1 ? [] : ['note'],
  removedFields: [],
  restoredFromVersion: null,
}));

/** What each version compares to, keyed by the version a reader clicks. */
export const BY_SELECTION: Record<number, VersionComparisonWire> = {
  1: comparison(
    1,
    [column(1, ['selected']), column(2, ['next']), column(4, ['current'])],
    [row('note', { 1: NOTES[1], 2: NOTES[2], 4: NOTES[4] })],
  ),
  2: comparison(
    2,
    [column(1, ['previous']), column(2, ['selected']), column(3, ['next']), column(4, ['current'])],
    [row('name', NAMES), row('note', NOTES)],
  ),
  3: comparison(
    3,
    [column(2, ['previous']), column(3, ['selected']), column(4, ['next', 'current'])],
    [row('note', { 2: NOTES[2], 3: NOTES[3], 4: NOTES[4] })],
  ),
  4: comparison(
    4,
    [column(3, ['previous']), column(4, ['selected', 'current'])],
    [row('note', { 3: NOTES[3], 4: NOTES[4] })],
  ),
};
