// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EN_US_REPORT_ENGINE_COPY } from '../../en-US';
import { PT_BR_REPORT_ENGINE_COPY } from '../../pt-BR';
import { PT_BR_BLANK_BLOCK_TEMPLATE_COPY } from '../../server/pt-BR';
import type { ReportBuilderCopy } from '../copy';
import { EN_US_REPORT_SCREENS_COPY } from '../en-US';
import { PT_BR_REPORT_SCREENS_COPY } from '../pt-BR';
import { ReportSettingsDialog } from '../report-settings-dialog';
import { httpTransport } from '../transport';
import { ReportBuilderProvider } from '../transport-context';
import type { ReportScreensCopy } from '../screens-copy';

/**
 * Adding scheduled delivery must not break a host whose copy pack predates it
 * (FUT-776): the new keys are optional, the package supplies its own words for
 * the pack's locale, and the three removed keys are accepted and ignored.
 */

/** A host-shaped pack as released before this feature: none of the new keys, the three old ones present. */
function legacyScreens(base: ReportScreensCopy): ReportScreensCopy {
  const { schedule: _schedule, ...settings } = base.settings;
  const { needsRecipient: _needs, ...editor } = base.editor;
  return {
    ...base,
    settings: {
      ...settings,
      scheduleLabel: 'Envio automático (antigo)',
      scheduleValue: 'ignorado',
      scheduleReason: 'ignorado',
    },
    editor,
  };
}

// The type-level proof: this assignment is what a host's own copy object does.
const hostCopyPt: ReportBuilderCopy = {
  engine: PT_BR_REPORT_ENGINE_COPY,
  blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY,
  screens: legacyScreens(PT_BR_REPORT_SCREENS_COPY),
};
const hostCopyEn: ReportBuilderCopy = { ...hostCopyPt, engine: EN_US_REPORT_ENGINE_COPY, screens: legacyScreens(EN_US_REPORT_SCREENS_COPY) };

afterEach(cleanup);

function mount(copy: ReportBuilderCopy): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReportBuilderProvider
        transport={httpTransport()}
        tenantSlug="acme"
        surface={{
          systemReports: [],
          systemDashboards: [],
          sections: [],
          blockTemplates: [],
          timeZone: 'America/Sao_Paulo',
          schedule: { recipients: () => Promise.resolve([]) },
        }}
        copy={copy}
      >
        <ReportSettingsDialog
          open
          tenantSlug="acme"
          value={{
            name: 'x',
            description: '',
            publish: { status: 'draft', visibility: 'private', visibilityRoles: [] },
            defaultRange: '30d',
            schedule: null,
          }}
          onChange={() => undefined}
          onClose={() => undefined}
        />
      </ReportBuilderProvider>
    </QueryClientProvider>,
  );
}

describe('a pack without the delivery words', () => {
  it('renders the package’s Portuguese for a pt pack, ignoring the removed keys', () => {
    mount(hostCopyPt);
    expect(screen.getByText('Envio automático')).toBeTruthy();
    expect(screen.queryAllByText('ignorado')).toEqual([]);
  });

  it('renders the package’s English for an en pack', () => {
    mount(hostCopyEn);
    expect(screen.getByText('Automatic delivery')).toBeTruthy();
  });
});
