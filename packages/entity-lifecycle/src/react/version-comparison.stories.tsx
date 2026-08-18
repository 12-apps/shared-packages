/**
 * The version-comparison panel (FUT-247), explorable with NO host.
 *
 * The panel is a pure function of a comparison payload, so most of these are
 * fixtures: one story per SHAPE the comparison can take, because the shapes are
 * the feature. Which columns exist is decided by how many versions surround the
 * selection, and each count collapses a different pair of roles into one column
 * — that is what these stories exist to show side by side.
 *
 * The last story is the whole dialog over a fake transport, so the CLICK that
 * opens the panel can be tried rather than described.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import type {
  ComparisonColumnWire,
  ComparisonRoleWire,
  ComparisonRowWire,
  VersionComparisonWire,
  VersionsWire,
} from './api';
import { createWebEntityLifecycle } from './create-web-entity-lifecycle';
import type { LifecycleResult, LifecycleTransport } from './transport';
import { VersionComparisonPanel } from './version-comparison-panel';

const meta: Meta = { title: 'Entity Lifecycle/Version comparison' };
export default meta;

const WHO = ['Ana Souza', 'Bruno Lima', 'Ana Souza', 'Carla Dias'];

function column(version: number, roles: ComparisonRoleWire[]): ComparisonColumnWire {
  return {
    version,
    roles,
    kind: version === 1 ? 'CREATE' : 'UPDATE',
    actorId: `u${version}`,
    actorName: WHO[version - 1] ?? 'Ana Souza',
    // A fixed date: a story that renders "now" is a story whose snapshot
    // differs every time anyone looks at it.
    createdAt: new Date(Date.UTC(2026, 7, 10 + version, 14, 30)).toISOString(),
  };
}

/** One row from `{ version: value }`, marking absent columns with `undefined`. */
function row(
  field: string,
  values: Record<number, string | number | boolean | null | undefined>,
): ComparisonRowWire {
  const cells = Object.entries(values).map(([version, value]) => ({
    version: Number(version),
    present: value !== undefined,
    value: value === undefined ? null : value,
  }));
  const [first, ...rest] = cells;
  const same = (a: typeof cells[number], b: typeof cells[number]): boolean =>
    a.present === b.present && (!a.present || a.value === b.value);
  return {
    field,
    cells,
    changed: first !== undefined && rest.some((cell) => !same(first, cell)),
  };
}

/** The catalog every story below reads from: a supplier edited four times. */
function comparison(
  selectedVersion: number,
  columns: ComparisonColumnWire[],
  rows: ComparisonRowWire[],
): VersionComparisonWire {
  return { selectedVersion, columns, rows };
}

const NAMES: Record<number, string> = { 1: 'Distribuidora Sul', 2: 'Distribuidora Sul', 3: 'Distribuidora Sul', 4: 'Distribuidora Sul' };
const NOTES: Record<number, string> = {
  1: 'Preço de lançamento',
  2: 'Promoção de julho',
  3: 'Preço normal',
  4: 'Promoção de agosto',
};

/** The everyday case: a middle version between its neighbours and current. */
export const FourRolesFourColumns: StoryObj = {
  name: 'Four roles, four columns (v2 of v1..v4)',
  render: () => (
    <VersionComparisonPanel
      comparison={comparison(
        2,
        [
          column(1, ['previous']),
          column(2, ['selected']),
          column(3, ['next']),
          column(4, ['current']),
        ],
        [
          row('name', NAMES),
          row('note', NOTES),
          row('contactName', { 1: 'Marina', 2: 'Marina', 3: 'Marina', 4: 'Rafael' }),
        ],
      )}
    />
  ),
};

/**
 * The collapse that a column-per-role design gets wrong: the version after the
 * selection IS the current record, so it is ONE column carrying both words.
 */
export const NextIsAlsoCurrent: StoryObj = {
  name: 'Next is also current (v3 of v1..v4)',
  render: () => (
    <VersionComparisonPanel
      comparison={comparison(
        3,
        [column(2, ['previous']), column(3, ['selected']), column(4, ['next', 'current'])],
        [row('note', { 2: NOTES[2], 3: NOTES[3], 4: NOTES[4] })],
      )}
    />
  ),
};

/** The newest version: nothing follows it, and it is what the record says now. */
export const NewestVersion: StoryObj = {
  name: 'Newest version — no next (v4 of v1..v4)',
  render: () => (
    <VersionComparisonPanel
      comparison={comparison(
        4,
        [column(3, ['previous']), column(4, ['selected', 'current'])],
        [row('note', { 3: NOTES[3], 4: NOTES[4] })],
      )}
    />
  ),
};

/** The oldest surviving version: nothing precedes it. */
export const OldestVersion: StoryObj = {
  name: 'Oldest version — no previous (v1 of v1..v4)',
  render: () => (
    <VersionComparisonPanel
      comparison={comparison(
        1,
        [column(1, ['selected']), column(2, ['next']), column(4, ['current'])],
        [row('note', { 1: NOTES[1], 2: NOTES[2], 4: NOTES[4] })],
      )}
    />
  ),
};

/**
 * A just-created record. One column means nothing to differ FROM, so the panel
 * says so and lists every field instead of filtering to none.
 */
export const OnlyOneVersion: StoryObj = {
  name: 'Only v1 exists — nothing to compare',
  render: () => (
    <VersionComparisonPanel
      comparison={comparison(
        1,
        [column(1, ['selected', 'current'])],
        [
          row('name', { 1: 'Distribuidora Sul' }),
          row('note', { 1: NOTES[1] }),
          row('contactName', { 1: 'Marina' }),
        ],
      )}
    />
  ),
};

/** Versions that genuinely agree get a line, not an empty table. */
export const NoDifferences: StoryObj = {
  render: () => (
    <VersionComparisonPanel
      comparison={comparison(
        2,
        [column(1, ['previous']), column(2, ['selected']), column(3, ['next', 'current'])],
        [row('name', NAMES), row('note', { 1: NOTES[1], 2: NOTES[1], 3: NOTES[1] })],
      )}
    />
  ),
};

/**
 * The distinction the table must not collapse: a field the version never
 * carried ("—") is not a field set to null ("vazio"), and neither is the empty
 * string. Also shows how a nested value renders.
 */
export const AbsentEmptyAndNested: StoryObj = {
  name: 'Absent vs empty vs nested values',
  render: () => (
    <VersionComparisonPanel
      comparison={comparison(
        2,
        [column(1, ['previous']), column(2, ['selected']), column(3, ['next', 'current'])],
        [
          // Added at v2: v1 never carried it.
          row('email', { 1: undefined, 2: 'compras@sul.com.br', 3: 'compras@sul.com.br' }),
          // Cleared at v3.
          row('phone', { 1: '11 5555-0001', 2: '11 5555-0001', 3: null }),
          // Emptied rather than cleared.
          row('contactName', { 1: 'Marina', 2: '', 3: '' }),
          // Removed at v3: the field is gone from the snapshot entirely.
          row('legalName', { 1: 'Sul Ltda', 2: 'Sul Ltda', 3: undefined }),
          // Booleans and numbers keep their own rendering.
          row('active', { 1: true, 2: true, 3: false }),
          row('creditDays', { 1: 30, 2: 30, 3: 0 }),
        ],
      )}
    />
  ),
};

// ---------------------------------------------------------------------------
// The whole dialog, so the click can be tried
// ---------------------------------------------------------------------------

const HISTORY: VersionsWire['versions'] = [4, 3, 2, 1].map((version) => ({
  version,
  kind: version === 1 ? 'CREATE' : 'UPDATE',
  actorId: `u${version}`,
  actorName: WHO[version - 1] ?? 'Ana Souza',
  createdAt: new Date(Date.UTC(2026, 7, 10 + version, 14, 30)).toISOString(),
  changedFields: version === 1 ? [] : ['note'],
  removedFields: [],
  restoredFromVersion: null,
}));

/** What each version compares to, keyed by the version the reader clicks. */
const BY_SELECTION: Record<number, VersionComparisonWire> = {
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

/**
 * A transport with no server behind it: the history read answers the list, and
 * a read carrying `?compare=N` answers that version's comparison.
 */
const storyTransport: LifecycleTransport = {
  async get<T>(url: string): Promise<T> {
    const asked = /compare=(\d+)/.exec(url)?.[1];
    const data: VersionsWire = {
      versions: HISTORY,
      publishedVersion: 4,
      ...(asked ? { comparison: BY_SELECTION[Number(asked)] ?? null } : {}),
    };
    return { data } as T;
  },
  async send<T>(): Promise<LifecycleResult<T>> {
    return { ok: false, error: 'Restaurar não faz nada nesta demonstração.' } as LifecycleResult<T>;
  },
};

const { VersionHistoryDialog } = createWebEntityLifecycle({
  apiBase: '/api/admin/minha-loja',
  transport: storyTransport,
});

/**
 * The dialog as an admin meets it. Click any row to open its comparison; click
 * the same row again to close it. Every version is wired, so the four shapes
 * above can be reached by clicking rather than by switching story.
 */
export const DialogWithClickableRows: StoryObj = {
  name: 'The dialog — click a row to compare',
  render: () => (
    <VersionHistoryDialog
      resourcePath="suppliers/s1"
      itemLabel="Distribuidora Sul"
      open
      onClose={() => undefined}
    />
  ),
};
