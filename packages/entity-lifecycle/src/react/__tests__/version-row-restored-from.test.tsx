// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EN_US_LIFECYCLE_WEB_COPY } from '../en-US';
import { PT_BR_LIFECYCLE_WEB_COPY } from '../pt-BR';
import { VersionRow } from '../version-row';

/**
 * A version that a restore produced names the version it came from. That
 * badge was a Portuguese literal in the row itself, so an en-US host showed
 * "a partir da v2" beside its English history; it is now the pack's.
 */

afterEach(cleanup);

const RESTORED = {
  version: 3,
  kind: 'RESTORE' as const,
  actorId: 'u1',
  actorName: 'Ana',
  createdAt: new Date('2026-08-01T12:00:00Z').toISOString(),
  changedFields: [],
  removedFields: [],
  restoredFromVersion: 2,
};

function renderRow(copy: typeof PT_BR_LIFECYCLE_WEB_COPY): void {
  render(
    <VersionRow
      entry={RESTORED}
      copy={copy.versionHistory}
      systemActor={copy.systemActor}
      isCurrent={false}
      isSelected={false}
      onSelect={() => undefined}
      onRestore={() => undefined}
    />,
  );
}

describe('a restored version row', () => {
  it("names its source version in the pt-BR pack's words", () => {
    renderRow(PT_BR_LIFECYCLE_WEB_COPY);
    expect(screen.getByText('a partir da v2')).toBeTruthy();
  });

  it("names its source version in the en-US pack's words", () => {
    renderRow(EN_US_LIFECYCLE_WEB_COPY);
    expect(screen.getByText('from v2')).toBeTruthy();
  });
});
