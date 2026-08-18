/**
 * The comparison panel (FUT-247): one version of a record read side by side
 * with its previous, its next and the current one.
 *
 * The panel is a pure function of a comparison payload, so these are fixtures —
 * one story per SHAPE, because the shapes ARE the feature. Which columns exist
 * is decided by how many versions surround the selection, and each count
 * collapses a different pair of roles into a single column.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { column, comparison, NAMES, NOTES, row } from './__stories__/fixtures';
import { VersionComparisonPanel } from './version-comparison-panel';

const meta: Meta = { title: 'Comparison panel' };
export default meta;

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
 * The collapse a column-per-role design gets wrong: the version after the
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
          row('name', { 1: NAMES[1] }),
          row('note', { 1: NOTES[1] }),
          row('contactName', { 1: 'Marina' }),
        ],
      )}
    />
  ),
};

/** Versions that genuinely agree get a line, not an empty table. */
export const NoDifferences: StoryObj = {
  name: 'Versions that agree on everything',
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
 * string. Also shows how booleans, numbers and nested values render.
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
          // Removed at v3: gone from the snapshot entirely.
          row('legalName', { 1: 'Sul Ltda', 2: 'Sul Ltda', 3: undefined }),
          row('active', { 1: true, 2: true, 3: false }),
          row('creditDays', { 1: 30, 2: 30, 3: 0 }),
        ],
      )}
    />
  ),
};
