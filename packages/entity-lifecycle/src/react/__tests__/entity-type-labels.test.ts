/**
 * The entity-type labels are the HOST's, whole.
 *
 * This package used to ship one host's catalog (`table: 'Mesa'`,
 * `ingredient: 'Insumo'`, `'kitchen-station': 'Estação'`) and merge it as the
 * BASE layer under whatever the adopting host passed. The loud half of that was
 * shipping the catalog at all. The quiet half — the one worth a test rather
 * than a rename — is the merge order: a host supplying its own map got its
 * entries laid on top, and silently kept the other host's word for every key it
 * did not restate. Nothing about the API said so, because the host HAD
 * configured labels.
 *
 * So these cases assert an ABSENCE and a NON-merge, which is the pair that
 * regresses together: re-adding a shipped catalog is only harmful if something
 * also merges it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as reactEntry from '../index';
import { entityTypeLabel, type EntityTypeLabels } from '../labels';

const REACT_SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('entity-type labels', () => {
  it('exports no label catalog of its own', () => {
    // Read off the public entry rather than asserting one name is gone: a
    // catalog reintroduced under any other name fails this too.
    const exported = Object.entries(reactEntry as Record<string, unknown>);
    const catalogs = exported.filter(
      ([, value]) =>
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof value !== 'function' &&
        Object.values(value as Record<string, unknown>).some((v) => typeof v === 'string'),
    );
    expect(catalogs.map(([name]) => name)).toEqual([]);
  });

  it('renders an unlabelled type as its raw key, never another host’s noun', () => {
    const labels: EntityTypeLabels = {};
    // The zero-config behaviour: honest, and obviously unconfigured to whoever
    // sees it — where "Mesa" looked deliberate.
    expect(entityTypeLabel(labels, 'kitchen-station')).toBe('kitchen-station');
    expect(entityTypeLabel(labels, 'table')).toBe('table');
  });

  it('uses the host map verbatim, with nothing underneath it', () => {
    // A host whose `table` is a DATABASE table. Under the old base-layer merge
    // this returned 'Mesa' for `ingredient` — a key this host never mentioned —
    // while looking configured.
    const labels: EntityTypeLabels = { table: 'Table', dataset: 'Dataset' };
    expect(entityTypeLabel(labels, 'table')).toBe('Table');
    expect(entityTypeLabel(labels, 'ingredient')).toBe('ingredient');
    expect(entityTypeLabel(labels, 'loss-reason')).toBe('loss-reason');
  });

  it('does not merge a shipped map into the host’s at the factory', () => {
    /* eslint-disable test-flakiness/no-unmocked-fs --
       the factory's own source IS the subject. This asserts that the spread
       which caused the bug is gone; a mocked file system would assert that of
       the mock, and pass while the shipped factory merged whatever it liked. */
    const factory = readFileSync(join(REACT_SRC, 'create-web-entity-lifecycle.tsx'), 'utf8');
    /* eslint-enable test-flakiness/no-unmocked-fs */
    const assignment = factory
      .split('\n')
      .find((line) => line.includes('config.entityTypeLabels'));
    expect(assignment).toBeDefined();
    // No spread on that line: `{ ...SOMETHING, ...config.entityTypeLabels }` is
    // the exact shape being forbidden, whatever SOMETHING is called.
    expect(assignment).not.toMatch(/\.\.\./);
  });
});
