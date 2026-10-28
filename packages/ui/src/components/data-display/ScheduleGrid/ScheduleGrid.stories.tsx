import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, waitFor, within } from 'storybook/test';
import { useState } from 'react';

import { PT_BR_UI_LABELS } from '../../../pt-BR.labels';
import { EmptyState } from '../EmptyState/EmptyState';
import { ErrorState } from '../ErrorState';
import { ScheduleGrid } from './ScheduleGrid';
import type { ScheduleGridBlock, ScheduleGridCell, ScheduleGridColumn, ScheduleGridGroup } from './ScheduleGrid.types';

/**
 * A Turnos host, as the admin app plugs the grid in (FUT-3823, prototype D).
 * The people, hours and words are sample data — the real ones are the host's.
 */
interface Slot {
  id: string;
  who: string;
  day: number;
  from: string;
  to: string;
  note?: string;
  tone?: ScheduleGridBlock['tone'];
}

interface Person {
  id: string;
  name: string;
  area: 'Cozinha' | 'Salão' | 'Entregas';
  /** On shift right now with no slot today: an "Em turno" block on Monday. */
  since?: string;
  /** Days closed by an afastamento. */
  leave?: number[];
  leaveMeta?: string;
}

const DAYS = ['Seg 19/10', 'Ter 20/10', 'Qua 21/10', 'Qui 22/10', 'Sex 23/10', 'Sáb 24/10', 'Dom 25/10'];
const LIMIT = 40;

const TELA: Person[] = [
  { id: 'luiz', name: 'Luiz entrega', area: 'Entregas' },
  { id: 'anderson', name: 'Anderson Paiva', area: 'Entregas', since: '08:26' },
  { id: 'kelly', name: 'Kelly Fontoura', area: 'Entregas', since: '08:26' },
  { id: 'marcio', name: 'Márcio Delgado', area: 'Entregas', since: '08:26' },
  { id: 'talita', name: 'Talita Siqueira', area: 'Entregas', since: '08:26' },
  { id: 'rondinelli', name: 'Rondinelli Souza', area: 'Entregas', since: '08:26' },
];
const TELA_SLOTS: Slot[] = [
  { id: 's1', who: 'luiz', day: 0, from: '20:39', to: '00:00', note: 'Atrasado', tone: 'late' },
  { id: 's2', who: 'anderson', day: 1, from: '08:00', to: '14:00' },
  { id: 's3', who: 'kelly', day: 2, from: '11:00', to: '15:00', note: '↻ toda semana' },
  { id: 's4', who: 'talita', day: 1, from: '18:00', to: '22:00', note: 'Ausente', tone: 'away' },
];

const CHEIA: Person[] = [
  { id: 'bruno', name: 'Bruno Lima', area: 'Cozinha' },
  { id: 'carla', name: 'Carla Mendes', area: 'Cozinha' },
  { id: 'bia', name: 'Bia Souza', area: 'Cozinha', leave: [1, 2, 3, 4, 5, 6], leaveMeta: 'Afastamento · licença maternidade' },
  { id: 'maria', name: 'Maria Aparecida dos Santos Figueiredo', area: 'Cozinha' },
  { id: 'diego', name: 'Diego Rocha', area: 'Salão' },
  { id: 'joana', name: 'Joana Prado', area: 'Salão', since: '19:00' },
  { id: 'caio', name: 'Caio Nunes', area: 'Salão' },
  ...TELA.slice(0, 2),
  { id: 'marcio', name: 'Márcio Delgado', area: 'Entregas' },
];
const CHEIA_SLOTS: Slot[] = [
  { id: 'c1', who: 'bruno', day: 0, from: '17:00', to: '23:00' },
  { id: 'c2', who: 'bruno', day: 1, from: '17:00', to: '23:00', note: '↻ toda semana' },
  { id: 'c3', who: 'bruno', day: 3, from: '17:00', to: '23:00', note: '↻ toda semana' },
  { id: 'c4', who: 'carla', day: 0, from: '18:00', to: '22:00' },
  { id: 'c5', who: 'bia', day: 0, from: '21:00', to: '23:30', note: 'Sem ninguém', tone: 'uncovered' },
  { id: 'c6', who: 'maria', day: 3, from: '06:00', to: '14:00' },
  { id: 'c7', who: 'maria', day: 6, from: '08:00', to: '14:00', note: '↻ 1x por mês' },
  { id: 'c8', who: 'diego', day: 0, from: '18:00', to: '23:00', note: '↻ toda semana' },
  { id: 'c9', who: 'diego', day: 4, from: '18:00', to: '23:00', note: '↻ toda semana' },
  { id: 'c10', who: 'joana', day: 5, from: '11:00', to: '15:00' },
  { id: 'c11', who: 'joana', day: 5, from: '18:00', to: '23:00' },
  { id: 'c12', who: 'caio', day: 5, from: '11:00', to: '17:00', note: '↻ a cada 2 semanas' },
  { id: 'c13', who: 'luiz', day: 0, from: '20:39', to: '00:00', note: 'Atrasado', tone: 'late' },
  ...['08:00–20:00', '08:00–14:00', '', '08:00–20:00', '08:00–17:30'].flatMap((hours, day) => {
    const [from = '', to = ''] = hours.split('–');
    return hours ? [{ id: `a${day}`, who: 'anderson', day, from, to }] : [];
  }),
  { id: 'm0', who: 'marcio', day: 0, from: '08:00', to: '22:00' },
];

const minutes = (hhmm: string): number => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const lengthOf = (slot: Slot): number => {
  const span = minutes(slot.to) - minutes(slot.from);
  return span <= 0 ? span + 24 * 60 : span;
};
const hoursText = (total: number): string => {
  if (total === 0) return '—';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
};

interface DemoProps {
  people?: Person[];
  slots?: Slot[];
  readOnly?: boolean;
  loading?: boolean;
  error?: boolean;
  /** Draw it in a pane this wide (px), to see the grid fit a narrow container. */
  paneWidth?: number;
}

/** A host: holds the turnos, applies every gesture at once (the real one writes to the server and offers Desfazer). */
function Demo({ people = TELA, slots: initial = TELA_SLOTS, readOnly, loading, error, paneWidth }: DemoProps) {
  const [slots, setSlots] = useState<Slot[]>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [log, setLog] = useState('');
  let seq = slots.length;
  const nextId = (): string => `n${(seq += 1)}-${Date.now() % 100000}`;
  const lastHours = (who: string): [string, string] => {
    const mine = slots.filter((slot) => slot.who === who && !slot.tone);
    const last = mine[mine.length - 1];
    return last ? [last.from, last.to] : ['08:00', '14:00'];
  };
  const byId = new Map(slots.map((slot) => [slot.id, slot] as const));
  const onLeave = (who: string, day: number): boolean => Boolean(people.find((p) => p.id === who)?.leave?.includes(day));

  const cell = (who: string, day: number): ScheduleGridCell => {
    const person = people.find((p) => p.id === who);
    const mine = slots.filter((slot) => slot.who === who && slot.day === day);
    const blocks: ScheduleGridBlock[] = mine.map((slot) => ({
      id: slot.id,
      label: `${slot.from}–${slot.to}`,
      note: slot.note,
      tone: slot.tone ?? 'plan',
      movable: true,
      copyable: slot.tone !== 'away',
      selected: slot.id === selected,
    }));
    if (day === 0 && person?.since && mine.length === 0) {
      blocks.push({ id: `duty-${who}`, label: 'Em turno', note: `desde ${person.since}`, tone: 'onduty' });
    }
    const blocked = onLeave(who, day);
    const firstLeaveDay = person?.leave?.[0] === day;
    return { blocks, blocked, blockedLabel: blocked && firstLeaveDay ? 'Afastamento' : undefined };
  };

  const columns: ScheduleGridColumn[] = DAYS.map((label, day) => {
    const n = slots.filter((slot) => slot.day === day && slot.tone !== 'away').length;
    return { label: day === 0 ? `Hoje · ${label}` : label, shortLabel: label.split(' ')[1]?.slice(0, 2), sublabel: n === 0 ? 'ninguém' : `${n} ${n === 1 ? 'turno' : 'turnos'}`, today: day === 0 };
  });

  const areas = ['Cozinha', 'Salão', 'Entregas'] as const;
  const groups: ScheduleGridGroup[] = areas
    .map((area) => ({
      title: area,
      rows: people
        .filter((p) => p.area === area)
        .map((p) => {
          const total = slots.filter((slot) => slot.who === p.id && slot.tone !== 'away').reduce((sum, slot) => sum + lengthOf(slot), 0);
          const over = total > LIMIT * 60;
          return {
            id: p.id,
            label: p.name,
            meta: over ? `${hoursText(total)} na semana · acima de ${LIMIT}h` : p.leaveMeta,
            metaTone: over ? ('warning' as const) : ('default' as const),
            total: hoursText(total),
            labelAccessible: `${p.name}: horas e afastamento`,
            onLabelClick: () => setLog(`Abrir ${p.name}`),
          };
        }),
    }))
    .filter((group) => group.rows.length > 0);

  return (
    <Box sx={{ p: 4, width: paneWidth ? `${paneWidth}px` : undefined, maxWidth: '100%', boxSizing: 'border-box' }}>
      <ScheduleGrid
        columns={columns}
        groups={groups}
        cell={cell}
        totalLabel="horas"
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
        empty={<EmptyState title="Ninguém na equipe ainda" description="Convide alguém em Equipe para montar a escala." />}
        createPreview={(who) => lastHours(who).join('–')}
        onCreate={(who, days) => {
          const [from, to] = lastHours(who);
          setSlots((prev) => [...prev, ...days.map((day) => ({ id: nextId(), who, day, from, to }))]);
          setLog(`Agendado · ${people.find((p) => p.id === who)?.name}, ${days.map((d) => DAYS[d]).join(', ')}, ${from}–${to}`);
        }}
        onCopy={(id, days) => {
          const source = byId.get(id);
          if (!source) return;
          setSlots((prev) => [...prev, ...days.map((day) => ({ ...source, id: nextId(), day, tone: undefined }))]);
          setLog(`Copiado · ${days.map((d) => DAYS[d]).join(', ')}`);
        }}
        onMove={(id, who, day) => {
          setSlots((prev) => prev.map((slot) => (slot.id === id ? { ...slot, who, day } : slot)));
          setLog(`Movido · ${people.find((p) => p.id === who)?.name}, ${DAYS[day]}`);
        }}
        onBlockClick={(id) => {
          setSelected(id);
          setLog(`Abrir ${id}`);
        }}
        labels={PT_BR_UI_LABELS.scheduleGrid}
        aria-label="Escala da semana"
        dataTestId="grid"
      />
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }} data-testid="grid-log">
        {log}
      </Typography>
    </Box>
  );
}

const meta: Meta<typeof Demo> = {
  title: 'Data Display/ScheduleGrid',
  component: Demo,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'People as rows, days as columns, blocks with a start and an end. Click an empty cell to create; drag across a row to create on each day; drag a block’s edge grip to copy it along its row; drag its middle to move it; click it to open it. Touch scrolls and never drags. Every gesture has a keyboard twin, read by a live region.',
      },
    },
  },
  tags: ['autodocs', 'component:ScheduleGrid'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const DESKTOP = { viewport: { value: 'lg', isRotated: false } };

/** d01 — the store's week: a late turno, "Em turno" today, an absence, a weekly turno. */
export const Semana: Story = { args: {}, globals: DESKTOP };

/** d11 — a full store: three areas, a long name, a split shift, an afastamento (a 4-day drag on Márcio's row is d13). */
export const LojaCheia: Story = { args: { people: CHEIA, slots: CHEIA_SLOTS }, globals: DESKTOP };

/** d16 — nobody scheduled: "+" everywhere, the "Em turno" blocks still shown. */
export const NinguemAgendado: Story = { args: { slots: [] }, globals: DESKTOP };

/** Without the schedule permission: no "+", no grips, no drag; a block still opens. */
export const SomenteLeitura: Story = { args: { readOnly: true }, globals: DESKTOP };

/** d17 — loading. */
export const Carregando: Story = { args: { loading: true }, globals: DESKTOP };

/** d18 — the host's error with "Tentar de novo". */
export const Erro: Story = { args: { error: true }, globals: DESKTOP };

/** A store with nobody in the team yet: the host's empty state. */
export const SemPessoas: Story = { args: { people: [] }, globals: DESKTOP };

/** The grid in a narrow pane (the mock never draws it there): it fits, names narrow, labels cut with an ellipsis. */
export const PainelEstreito: Story = { args: { paneWidth: 390 }, globals: DESKTOP };

/** Dark mode. */
export const Escuro: Story = { args: { people: CHEIA, slots: CHEIA_SLOTS }, globals: { ...DESKTOP, theme: 'dark' } };

/** d13 — Avisar: a five-day week puts Márcio at 70h — "70h na semana · acima de 40h" on his row. */
export const AcimaDoLimite: Story = {
  args: { people: CHEIA, slots: [...CHEIA_SLOTS, ...[1, 2, 3, 4].map((day) => ({ id: `m${day}`, who: 'marcio', day, from: '08:00', to: '22:00' }))] },
  globals: DESKTOP,
};

const gridIn = (canvasElement: HTMLElement) => within(canvasElement);

/** G-C1: a click on an empty cell schedules that day with the person's last hours. */
export const CliqueAgenda: Story = {
  args: {},
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const canvas = gridIn(canvasElement);
    await fireEvent.click(canvas.getByRole('button', { name: 'Agendar Anderson Paiva, Qua 21/10' }));
    await waitFor(() => expect(canvas.getByTestId('grid-cell-anderson-2')).toHaveTextContent('08:00–14:00'));
  },
};

/** G-C8: Shift+→ on Kelly's weekly turno copies it to Thursday, read aloud. */
export const TecladoCopia: Story = {
  args: {},
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const canvas = gridIn(canvasElement);
    await fireEvent.keyDown(canvas.getByTestId('grid-block-s3'), { key: 'ArrowRight', shiftKey: true });
    await waitFor(() => expect(canvas.getByTestId('grid-live')).toHaveTextContent('11:00–15:00 copiado para Qui 22/10'));
    await waitFor(() => expect(canvas.getByTestId('grid-cell-kelly-3')).toHaveTextContent('11:00–15:00'));
  },
};
