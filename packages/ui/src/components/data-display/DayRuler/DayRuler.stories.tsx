import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, waitFor, within } from 'storybook/test';
import { createTheme, ThemeProvider, useTheme } from '@mui/material/styles/index.js';
import type * as React from 'react';
import { useState } from 'react';

import { densityThemeOptions } from '../../../tokens/density';
import { Button } from '../../form/Button';
import { Chip } from '../Chip/Chip';
import { EmptyState } from '../EmptyState/EmptyState';
import { ErrorState } from '../ErrorState';
import { DayRuler } from './DayRuler';
import { DAY_RULER_LABELS } from './DayRuler.labels';
import { formatRange } from './day-ruler-model';
import type { DayRulerBlock, DayRulerFooterRow, DayRulerRow } from './DayRuler.types';

/**
 * A Turnos host's Dia view (FUT-3823, prototype D, frames d02 and the phone's
 * day list). People, hours and words are sample data — the host's in the app.
 */
interface Person {
  id: string;
  name: string;
  area: string;
  /** On shift since this hour (no slot), until now. */
  since?: number;
  chip?: string;
  late?: boolean;
  /** A tag beside the name ("Freela"). */
  tag?: string;
}

interface Slot {
  id: string;
  who: string;
  start: number;
  end: number;
  repeats?: boolean;
  tone?: DayRulerBlock['tone'];
  /** A meal break inside the turno, in hours. */
  pause?: [number, number];
}

const NOW = 20.75;

const PEOPLE: Person[] = [
  { id: 'luiz', name: 'Luiz entrega', area: 'Entregas', late: true },
  { id: 'anderson', name: 'Anderson Paiva', area: 'Entregas', since: 8.43 },
  { id: 'kelly', name: 'Kelly Fontoura', area: 'Entregas', since: 8.43 },
  { id: 'marcio', name: 'Márcio Delgado', area: 'Entregas', since: 8.43 },
  { id: 'talita', name: 'Talita Siqueira', area: 'Entregas', since: 8.43 },
  { id: 'rondinelli', name: 'Rondinelli Souza', area: 'Entregas', since: 8.43 },
];
const SLOTS: Slot[] = [{ id: 'l1', who: 'luiz', start: 20.65, end: 24, repeats: true, tone: 'late' }];

const KITCHEN: Person[] = [
  { id: 'bruno', name: 'Bruno Lima', area: 'Cozinha', since: 17.03, chip: 'Chapa' },
  { id: 'carla', name: 'Carla Mendes', area: 'Cozinha', since: 18, chip: 'Sem praça' },
  { id: 'bia', name: 'Bia Souza', area: 'Cozinha' },
  { id: 'diego', name: 'Diego Rocha', area: 'Salão', since: 18.5, chip: 'Varanda, Salão principal' },
];
const KITCHEN_SLOTS: Slot[] = [
  { id: 'k1', who: 'bruno', start: 17, end: 23 },
  { id: 'k2', who: 'carla', start: 18, end: 22 },
  { id: 'k3', who: 'bia', start: 21, end: 23.5, tone: 'uncovered' },
  { id: 'k4', who: 'diego', start: 18, end: 23 },
];

const hh = (h: number): string => formatRange(h, h).slice(0, 5);

interface DemoProps {
  people?: Person[];
  slots?: Slot[];
  readOnly?: boolean;
  loading?: boolean;
  error?: boolean;
  /** Draw it in a pane this wide (px) — the phone's day list is the same component in a narrow pane. */
  paneWidth?: number;
  /** Under each area: how busy it gets, who is on the escala and what the movement asks, short hours marked (FUT-3882). */
  footers?: boolean;
  /** With `footers`: no sales figures — only who is on the escala, short hours marked, and the run said (FUT-3882). */
  countsOnly?: boolean;
}

/** Each area's average units per hour on the 06→02 ruler, and the people its movement asks for — a host's own figures. */
function footerOf(area: string | undefined, people: Person[], slots: Slot[], countsOnly = false): DayRulerFooterRow[] | undefined {
  if (!area) return undefined;
  const mine = people.filter((p) => p.area === area);
  const hourMid = (index: number): number => 6 + index + 0.5;
  const busy = Array.from({ length: 20 }, (_, index) => {
    const h = hourMid(index);
    return h < 11 || h > 24 ? null : Math.round(4 + 10 * Math.exp(-((h - 12.8) ** 2) / 1.6) + 16 * Math.exp(-((h - 20.8) ** 2) / 2.2));
  });
  const scheduled = Array.from({ length: 20 }, (_, index) =>
    mine.filter((p) => slots.some((slot) => slot.who === p.id && slot.tone !== 'away' && slot.start <= hourMid(index) && slot.end > hourMid(index))).length,
  );
  const need = busy.map((units) => (units === null ? 0 : Math.ceil(units / 8)));
  if (countsOnly) {
    const short = need.map((count, index) => count > (scheduled[index] ?? 0));
    const first = short.indexOf(true);
    const last = short.lastIndexOf(true);
    const missing = Math.max(0, ...need.map((count, index) => count - (scheduled[index] ?? 0)));
    return [
      {
        id: `${area}-have`,
        label: 'Na escala, por hora',
        cells: scheduled.map((count, index) => ({ text: count ? String(count) : '', marked: short[index] ?? false })),
      },
      ...(first >= 0 ? [{ id: `${area}-short`, label: '', note: `Faltam ${missing}, ${hh(6 + first)}–${hh(7 + last)}`, marked: true }] : []),
    ];
  }
  return [
    { id: `${area}-trend`, label: 'Média de pedidos/hora', trend: busy },
    { id: `${area}-have`, label: 'Na escala, por hora', cells: scheduled.map((count) => ({ text: count ? String(count) : '' })) },
    {
      id: `${area}-need`,
      label: 'O movimento pede',
      cells: need.map((count, index) => {
        const short = count > (scheduled[index] ?? 0);
        return { text: count ? String(count) : '', marked: short, ...(short ? { title: `${hh(6 + index)} · pede ${count}, tem ${scheduled[index] ?? 0}` } : {}) };
      }),
    },
  ];
}

function Demo({ people = PEOPLE, slots: initial = SLOTS, readOnly, loading, error, paneWidth, footers, countsOnly }: DemoProps) {
  const [slots, setSlots] = useState<Slot[]>(initial);
  const [log, setLog] = useState('');
  const compact = paneWidth !== undefined && paneWidth < 600;
  const rows: DayRulerRow[] = people.map((p) => {
    const mine = slots.filter((slot) => slot.who === p.id);
    const working = p.since !== undefined;
    const meta = working
      ? `em turno desde ${hh(p.since ?? 0)}${mine.length ? '' : ' · sem escala'}`
      : p.late && mine[0]
        ? `atrasado · era ${hh(mine[0].start)}`
        : mine.length
          ? 'escala'
          : 'livre';
    return {
      id: p.id,
      label: p.name,
      meta,
      group: p.area,
      chips: p.chip ? <Chip label={p.chip} size="sm" variant="outlined" /> : undefined,
      nameAdornment: p.tag ? <Chip label={p.tag} size="sm" variant="outlined" /> : undefined,
      actions: working ? (
        <Button variant="outline" color="primary" size="md" onClick={() => setLog(`Encerrar ${p.name}`)}>
          {compact ? 'Encerrar' : 'Encerrar turno'}
        </Button>
      ) : p.late ? (
        <Button variant="outline" color="primary" size="md" onClick={() => setLog(`Iniciar ${p.name}`)}>
          Iniciar agora
        </Button>
      ) : undefined,
      blocks: mine.map((slot) => ({
        id: slot.id,
        start: slot.start,
        end: slot.end,
        label: `${slot.repeats ? '↻ ' : ''}${formatRange(slot.start, slot.end)}`,
        shortLabel: hh(slot.start),
        tone: slot.tone ?? 'plan',
        movable: true,
        resizable: true,
        title: `${p.name}, ${formatRange(slot.start, slot.end)}${slot.pause ? ` · pausa ${formatRange(slot.pause[0], slot.pause[1])}` : ''}`,
        breakSpan: slot.pause ? { start: slot.pause[0], end: slot.pause[1] } : undefined,
      })),
      actual: working ? { start: p.since ?? 0, end: NOW } : undefined,
      actualLabel: working && mine.length === 0 ? `sem escala · desde ${hh(p.since ?? 0)}` : undefined,
      labelAccessible: `${p.name}: horas e afastamento`,
      onLabelClick: () => setLog(`Abrir ${p.name}`),
    };
  });
  const coverage = Array.from({ length: 20 }, (_, index) => {
    const mid = 6 + index + 0.5;
    return people.filter((p) => {
      const inSlot = slots.some((slot) => slot.who === p.id && slot.tone !== 'away' && slot.start <= mid && slot.end > mid);
      const onShift = p.since !== undefined && p.since <= mid && NOW > mid;
      return inSlot || onShift;
    }).length;
  });
  const set = (id: string, start: number, end: number): void =>
    setSlots((prev) => prev.map((slot) => (slot.id === id ? { ...slot, start, end } : slot)));
  return (
    <Box sx={{ p: compact ? 2 : 4, width: paneWidth ? `${paneWidth}px` : undefined, maxWidth: '100%', boxSizing: 'border-box' }}>
      <DayRuler
        rows={rows}
        now={NOW}
        coverage={coverage}
        coverageLabel="Na escala, por hora"
        {...(footers ? { groupFooter: (area: string | undefined) => footerOf(area, people, slots, countsOnly) } : {})}
        readOnly={readOnly}
        loading={loading}
        error={
          error ? (
            <ErrorState
              title="Não foi possível carregar a escala"
              message="Verifique a conexão e tente de novo."
              retryLabel="Tentar de novo"
              onRetry={() => setLog('Tentar de novo')}
            />
          ) : undefined
        }
        empty={<EmptyState title="Ninguém na escala neste dia." />}
        onCreate={(who, start, end) => {
          setSlots((prev) => [...prev, { id: `n${prev.length + 1}`, who, start, end }]);
          setLog(`Agendado · ${people.find((p) => p.id === who)?.name}, ${formatRange(start, end)}`);
        }}
        onMove={(id, start, end) => {
          set(id, start, end);
          setLog(`Horário: ${formatRange(start, end)}`);
        }}
        onResize={(id, start, end) => {
          set(id, start, end);
          setLog(`Horário: ${formatRange(start, end)}`);
        }}
        onBlockClick={(id) => setLog(`Abrir ${id}`)}
        labels={DAY_RULER_LABELS['pt-BR']}
        aria-label="Escala do dia"
        dataTestId="ruler"
      />
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }} data-testid="ruler-log">
        {log}
      </Typography>
    </Box>
  );
}

/**
 * The same story at the compact density (`densityThemeOptions('compact')`,
 * what `createUiTheme({ density: 'compact' })` feeds MUI): every length the
 * component reads through `rem` follows the density's root size.
 */
function CompactDensity({ children }: { children: React.ReactNode }) {
  const outer = useTheme();
  const theme = createTheme({
    palette: { mode: outer.palette.mode, primary: { main: outer.palette.primary.main } },
    ...densityThemeOptions('compact'),
  });
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}

const meta: Meta<typeof Demo> = {
  title: 'Data Display/DayRuler',
  component: Demo,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'One day as an hour ruler per row: the escala as blocks, the real shift as a bar under them, the now line, people per hour above. Drag on an empty stretch to create (a click alone is 4h), drag a block to move it, drag its ends to change them — snapped to 15 minutes. In a narrow pane each row stacks and the blocks are tap-only.',
      },
    },
  },
  tags: ['autodocs', 'component:DayRuler'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const DESKTOP = { viewport: { value: 'lg', isRotated: false } };
const PHONE = { viewport: { value: 'xs', isRotated: false } };

/** d02 — Dia: the 06→02 ruler, people per hour, the late escala block, the real shifts, the now line, row actions. */
export const Day: Story = { args: {}, globals: DESKTOP };

/** Day at the compact density. */
export const DayCompact: Story = {
  args: {},
  globals: DESKTOP,
  decorators: [(Story) => (
    <CompactDensity>
      <Story />
    </CompactDensity>
  )],
};

/** A kitchen and a salão: dashed escala blocks over the real shift, chips, an uncovered turno. */
export const Kitchen: Story = { args: { people: KITCHEN, slots: KITCHEN_SLOTS }, globals: DESKTOP };

/** d01/d11 phone — the same rows in a narrow pane: stacked, 30px bars, a narrow block says only its start. */
export const Phone: Story = { args: { people: KITCHEN, slots: KITCHEN_SLOTS, paneWidth: 390 }, globals: PHONE };

/** Without the schedule permission: nothing creates, moves or resizes; a block still opens. */
export const ReadOnly: Story = { args: { readOnly: true, people: KITCHEN, slots: KITCHEN_SLOTS }, globals: DESKTOP };

export const Loading: Story = { args: { loading: true }, globals: DESKTOP };

export const LoadError: Story = { args: { error: true }, globals: DESKTOP };

/** Nobody on the day: the host's empty sentence. */
export const Empty: Story = { args: { people: [] }, globals: DESKTOP };

export const Dark: Story = { args: { people: KITCHEN, slots: KITCHEN_SLOTS }, globals: { ...DESKTOP, theme: 'dark' } };

/** D-C8: Enter on Kelly's empty track creates 4h from now; Alt+→ on Luiz's block moves it 15 minutes. */
export const Keyboard: Story = {
  args: {},
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await fireEvent.keyDown(canvas.getByTestId('ruler-block-l1'), { key: 'ArrowRight', altKey: true });
    await waitFor(() => expect(canvas.getByTestId('ruler-live')).toHaveTextContent('↻ 20:39–00:00 agora 20:54–00:15'));
  },
};

const PAUSA: Person[] = [
  { id: 'bruno', name: 'Bruno Lima', area: 'Cozinha' },
  { id: 'carla', name: 'Carla Mendes', area: 'Cozinha', chip: 'Chapa' },
  { id: 'kelly', name: 'Kelly Fontoura', area: 'Entregas', tag: 'Freela' },
];
const PAUSA_SLOTS: Slot[] = [
  { id: 'p1', who: 'bruno', start: 11, end: 19, pause: [14, 15] },
  { id: 'p2', who: 'carla', start: 10, end: 21.5, pause: [15, 16] },
  { id: 'p3', who: 'kelly', start: 18, end: 23 },
];

/** The slots a later story fills (FUT-3881): a "Freela" tag beside a name and the meal break as a hatched gap inside a block — it moves with the block. */
export const BreakAndMarkers: Story = { args: { people: PAUSA, slots: PAUSA_SLOTS }, globals: DESKTOP };

/** The same on a phone. */
export const BreakAndMarkersPhone: Story = { args: { people: PAUSA, slots: PAUSA_SLOTS, paneWidth: 390 }, globals: PHONE };

/** FUT-3882: under each area its trend ("Média de pedidos/hora"), who is on the escala and what the movement asks, short hours outlined. */
export const GroupFooters: Story = { args: { footers: true }, globals: DESKTOP };

/** The same in the dark theme. */
export const GroupFootersDark: Story = { args: { footers: true }, globals: { ...DESKTOP, theme: 'dark' } };

/** FUT-3882, a reader without sales: only who is on the escala, the short hours outlined, and the run said in the warning ink. */
export const GroupFootersCountsOnly: Story = { args: { footers: true, countsOnly: true }, globals: DESKTOP };
