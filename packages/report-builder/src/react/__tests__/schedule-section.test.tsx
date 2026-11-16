// @vitest-environment jsdom
import { useState, type JSX } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PT_BR_REPORT_ENGINE_COPY } from '../../pt-BR';
import { PT_BR_BLANK_BLOCK_TEMPLATE_COPY } from '../../server/pt-BR';
import type { ScheduleDraft } from '../lib/schedule-draft';
import { PT_BR_REPORT_SCREENS_COPY } from '../pt-BR';
import type { ReportScheduleSurface, ScheduleRecipient } from '../schedule-surface';
import { ReportSettingsDialog } from '../report-settings-dialog';
import { httpTransport } from '../transport';
import { ReportBuilderProvider } from '../transport-context';

/**
 * The delivery section of "Ajustes do relatório" (FUT-776): off, each cadence,
 * a recipient the host refuses, a list that fails to load, and the locked state.
 */

const people = (): ScheduleRecipient[] => [
  { id: 'me', name: 'Você (Thom)', detail: 'quem salvou', canReceive: true, preselected: true },
  { id: 'ana', name: 'Marina', detail: 'Gerente', canReceive: true },
  { id: 'rafa', name: 'João', detail: 'Garçom', canReceive: false, reason: 'Garçom · sem acesso a vendas' },
];

const on = (): ScheduleDraft => ({
  enabled: true,
  cadence: 'weekly',
  weekday: 1,
  dayOfMonth: 1,
  time: '08:00',
  recipients: ['me'],
});

const realMatchMedia = window.matchMedia;

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  window.matchMedia = realMatchMedia;
});

function Harness({
  initial,
  schedule,
}: {
  initial: ScheduleDraft | null;
  schedule: ReportScheduleSurface | undefined;
}): JSX.Element {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [value, setValue] = useState<ScheduleDraft | null>(initial);
  return (
    <QueryClientProvider client={client}>
      <ReportBuilderProvider
        transport={httpTransport()}
        tenantSlug="acme"
        surface={{
          systemReports: [],
          systemDashboards: [],
          sections: [],
          blockTemplates: [],
          timeZone: 'America/Sao_Paulo',
          ...(schedule ? { schedule } : {}),
        }}
        copy={{
          engine: PT_BR_REPORT_ENGINE_COPY,
          blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY,
          screens: PT_BR_REPORT_SCREENS_COPY,
        }}
      >
        <ReportSettingsDialog
          open
          tenantSlug="acme"
          entities={['orders']}
          value={{
            name: 'Vendas',
            description: '',
            publish: { status: 'draft', visibility: 'private', visibilityRoles: [] },
            defaultRange: '30d',
            schedule: value,
          }}
          onChange={(next) => {
            setValue(next.schedule);
          }}
          onClose={() => undefined}
        />
      </ReportBuilderProvider>
      <pre data-testid="probe">{JSON.stringify(value)}</pre>
    </QueryClientProvider>
  );
}

function renderSection(
  initial: ScheduleDraft | null,
  recipients: ReportScheduleSurface['recipients'] = () => Promise.resolve(people()),
  extra: Partial<ReportScheduleSurface> = {},
): void {
  render(<Harness initial={initial} schedule={{ recipients, ...extra }} />);
}

/** The draft the dialog currently holds, as the page above it would. */
function held(): ScheduleDraft | null {
  return JSON.parse(screen.getByTestId('probe').textContent ?? 'null') as ScheduleDraft | null;
}

describe('the delivery section', () => {
  it('is off by default: the switch alone, claiming nothing is being sent', () => {
    renderSection(null);
    expect(screen.getByTestId('report-settings-schedule-switch')).toBeTruthy();
    expect(screen.queryAllByText(/Enviar por e-mail/)).toEqual([]);
    expect(screen.queryAllByTestId('report-settings-frequency')).toEqual([]);
  });

  it('says what is chosen only while it is on, and the title is a label for the switch', () => {
    renderSection(on());
    expect(screen.getByText('Enviar por e-mail toda segunda, 8h')).toBeTruthy();
    expect(screen.getByText('Envio automático').closest('label')?.getAttribute('for')).toBe(
      screen.getByTestId('report-settings-schedule-switch').id,
    );
  });

  it('turning it on opens Semanal, Monday 08:00, and ticks the person who saved', async () => {
    const recipients = vi.fn(() => Promise.resolve(people()));
    renderSection(null, recipients);
    fireEvent.click(screen.getByTestId('report-settings-schedule-switch'));
    await waitFor(() => expect(held()?.recipients).toEqual(['me']));
    expect(held()).toMatchObject({ enabled: true, cadence: 'weekly', weekday: 1, time: '08:00' });
    expect(recipients).toHaveBeenCalledWith({ tenantSlug: 'acme', entities: ['orders'] });
  });

  it('offers the four frequencies as equal parts of one group', () => {
    renderSection(on());
    const group = screen.getByTestId('report-settings-frequency');
    const parts = within(group).getAllByRole('button');
    expect(parts.map((part) => part.textContent)).toEqual(['Diária', 'Semanal', 'Quinzenal', 'Mensal']);
    expect(parts[1]?.getAttribute('aria-pressed')).toBe('true');
  });

  it.each([
    ['Diária', 'daily', 'Enviar por e-mail todo dia, 8h', 'weekday'],
    ['Quinzenal', 'biweekly', 'Enviar por e-mail toda segunda, a cada 2 semanas, 8h', 'weekday'],
    ['Mensal', 'monthly', 'Enviar por e-mail todo dia 1, 8h', 'day-of-month'],
  ])('choosing %s changes the sentence and the day control', async (label, cadence, sentence, day) => {
    renderSection(on());
    fireEvent.click(within(screen.getByTestId('report-settings-frequency')).getByRole('button', { name: label }));
    await waitFor(() => expect(held()?.cadence).toBe(cadence));
    expect(screen.getByText(sentence)).toBeTruthy();
    const dayTestId = `report-settings-${day}`;
    if (cadence === 'daily') {
      expect(screen.queryAllByTestId('report-settings-weekday')).toEqual([]);
      expect(screen.queryAllByTestId('report-settings-day-of-month')).toEqual([]);
    } else {
      expect(screen.getByTestId(dayTestId)).toBeTruthy();
    }
  });

  it('says a late day of the month goes on the last day of shorter months', () => {
    renderSection({ ...on(), cadence: 'monthly', dayOfMonth: 31 });
    expect(screen.getByTestId('report-settings-month-end').textContent).toContain('último dia');
    cleanup();
    renderSection({ ...on(), cadence: 'monthly', dayOfMonth: 15 });
    expect(screen.queryAllByTestId('report-settings-month-end')).toEqual([]);
  });

  it('shows a person the host refuses disabled, with the reason', async () => {
    renderSection(on());
    const refused = await screen.findByTestId('report-settings-recipient-rafa');
    expect(refused.getAttribute('aria-disabled')).toBe('true');
    const reason = screen.getByTestId('report-settings-recipient-rafa-helper');
    expect(reason.textContent).toBe('Garçom · sem acesso a vendas');
    // The reason is tied to the checkbox it explains.
    const input = refused.querySelector('input');
    expect(input?.getAttribute('aria-describedby')).toBe(reason.id);
    expect(screen.getByTestId('report-settings-recipient-ana').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('opening a saved schedule changes nothing, even with a person the host now refuses', async () => {
    renderSection({ ...on(), recipients: ['me', 'rafa'] });
    await screen.findByTestId('report-settings-recipient-ana');
    expect(held()?.recipients).toEqual(['me', 'rafa']);
    // The next edit of the list drops them.
    fireEvent.click(screen.getByTestId('report-settings-recipient-ana'));
    await waitFor(() => expect(held()?.recipients).toEqual(['me', 'ana']));
  });

  it('opening an enabled schedule with nobody ticked does not tick anyone', async () => {
    renderSection({ ...on(), recipients: [] });
    await screen.findByTestId('report-settings-recipient-ana');
    expect(held()?.recipients).toEqual([]);
  });

  it('ticks and unticks people', async () => {
    renderSection(on());
    fireEvent.click(await screen.findByTestId('report-settings-recipient-ana'));
    await waitFor(() => expect(held()?.recipients).toEqual(['me', 'ana']));
    fireEvent.click(screen.getByTestId('report-settings-recipient-ana'));
    await waitFor(() => expect(held()?.recipients).toEqual(['me']));
  });

  it('asks for a recipient when nobody is ticked, and names the store zone', async () => {
    renderSection({ ...on(), recipients: [] }, () => Promise.resolve(people().map((p) => ({ ...p, preselected: false }))));
    await screen.findByTestId('report-settings-recipient-ana');
    expect(screen.getByTestId('report-settings-schedule-needs-recipient').textContent).toContain('Escolha quem recebe');
    expect(screen.getByText(/fuso da loja/)).toBeTruthy();
  });

  it('does not ask for a recipient while the list is still loading', () => {
    renderSection({ ...on(), recipients: [] }, () => new Promise(() => undefined));
    expect(screen.getByTestId('report-settings-recipients-loading')).toBeTruthy();
    expect(screen.queryAllByTestId('report-settings-schedule-needs-recipient')).toEqual([]);
  });

  it('says so, in its own words, when the people cannot be loaded, and offers to retry', async () => {
    const recipients = vi.fn(() => Promise.reject(new Error('boom')));
    renderSection(on(), recipients);
    expect((await screen.findByTestId('report-settings-recipients-error')).textContent).toContain('Não foi possível');
    fireEvent.click(screen.getByTestId('report-settings-recipients-retry'));
    await waitFor(() => expect(recipients).toHaveBeenCalledTimes(2));
  });

  it('names the store clock in words, never by its IANA id, unless the host words it', async () => {
    renderSection(on());
    const note = await screen.findByText(/fuso da loja/);
    expect(note.textContent).not.toContain('America/Sao_Paulo');
    expect(note.textContent).toMatch(/Brasília/);
    cleanup();
    renderSection(on(), () => Promise.resolve(people()), { timeZoneLabel: 'Horário de São Paulo' });
    expect((await screen.findByText(/fuso da loja/)).textContent).toContain('Horário de São Paulo (fuso da loja)');
  });

  it('says so when the store has nobody to choose', async () => {
    renderSection(on(), () => Promise.resolve([]));
    expect(await screen.findByTestId('report-settings-recipients-empty')).toBeTruthy();
  });

  it('renders locked, with the host reason reachable, when the plan excludes it', () => {
    renderSection(null, () => Promise.resolve([]), { lockedReason: 'Disponível no plano Max.' });
    const row = screen.getByTestId('report-settings-schedule');
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.matches('[tabindex="0"]')).toBe(true);
    expect(document.getElementById(row.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Disponível no plano Max.');
    expect(screen.queryAllByTestId('report-settings-schedule-switch')).toEqual([]);
  });
});
