import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, fn, waitFor, within } from 'storybook/test';

import { PT_BR_UI_LABELS } from '../../../pt-BR.labels';
import { ScheduleGrid } from './ScheduleGrid';
import type { ScheduleGridCell } from './ScheduleGrid.types';

/**
 * The week grid's gestures in a real browser (FUT-3825): real layout, real
 * pointer events. The jsdom suite (`__tests__/ScheduleGrid.test.tsx`) holds
 * the full matrix; these prove the same paths where boxes and hit-testing are
 * the browser's own.
 */
const COLUMNS = ['Seg 19/10', 'Ter 20/10', 'Qua 21/10', 'Qui 22/10', 'Sex 23/10', 'Sáb 24/10', 'Dom 25/10'].map((label, day) => ({
  label,
  today: day === 0,
}));

const CELLS: Record<string, ScheduleGridCell> = {
  'ana:2': {
    blocks: [
      {
        id: 'k1',
        label: '11:00–19:00',
        note: 'pausa 14:00–15:00',
        tone: 'plan',
        movable: true,
        copyable: true,
        breakSpan: { start: 0.375, end: 0.5 },
      },
    ],
  },
  'bia:1': { blocks: [], blocked: true, blockedLabel: 'Afastamento' },
};
const cell = (rowId: string, day: number): ScheduleGridCell => CELLS[`${rowId}:${day}`] ?? { blocks: [] };

const meta: Meta<typeof ScheduleGrid> = {
  title: 'Data Display/ScheduleGrid/Tests',
  component: ScheduleGrid,
  parameters: { layout: 'fullscreen', chromatic: { disableSnapshot: false } },
  tags: ['autodocs', 'test', 'component:ScheduleGrid'],
  args: {
    columns: COLUMNS,
    groups: [
      {
        title: 'Entregas',
        rows: [
          { id: 'ana', label: 'Ana Lima', total: '8h', nameAdornment: <span>Freela</span> },
          { id: 'bia', label: 'Bia Souza', meta: 'Afastamento · licença', total: '—' },
        ],
      },
    ],
    cell,
    totalLabel: 'horas',
    createPreview: () => '08:00–14:00',
    labels: PT_BR_UI_LABELS.scheduleGrid,
    'aria-label': 'Escala da semana',
    dataTestId: 'sg',
    onCreate: fn(),
    onCopy: fn(),
    onMove: fn(),
    onBlockClick: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A real gesture's events arrive in separate tasks, so React has committed the
 * press (and attached its window listeners) before the first move. A synthetic
 * gesture fired in one task must yield to React's microtask the same way.
 */
const settle = async (): Promise<void> => {
  await Promise.resolve();
};

const press = (el: Element): void => {
  fireEvent.pointerDown(el, { pointerType: 'mouse', button: 0, isPrimary: true });
};
const over = (el: Element): void => {
  fireEvent.pointerMove(el, { pointerType: 'mouse', isPrimary: true });
};
const lift = (el: Element): void => {
  fireEvent.pointerUp(el, { pointerType: 'mouse', isPrimary: true });
  fireEvent.click(el);
};

/** G-C2 + G-R1: a drag across Ana's row creates on each crossed open day, never on her taken Wednesday. */
export const DragCreatesAlongTheRow: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const plus = (day: number) => within(canvas.getByTestId(`sg-cell-ana-${day}`)).getByRole('button');
    press(plus(1));
    await settle();
    over(canvas.getByTestId('sg-cell-ana-2'));
    await settle();
    over(canvas.getByTestId('sg-cell-ana-3'));
    await settle();
    await waitFor(() => expect(canvas.getByTestId('sg-cell-ana-3')).toHaveTextContent('08:00–14:00'));
    lift(canvas.getByTestId('sg-cell-ana-3'));
    await waitFor(() => expect(args.onCreate).toHaveBeenCalledWith('ana', [1, 3]));
  },
};

/** G-C3 + G-R2: the right grip dragged to Friday copies to Thursday and Friday. */
export const GripCopies: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    press(canvas.getByTestId('sg-grip-r-k1'));
    await settle();
    over(canvas.getByTestId('sg-cell-ana-3'));
    await settle();
    over(canvas.getByTestId('sg-cell-ana-4'));
    await settle();
    lift(canvas.getByTestId('sg-cell-ana-4'));
    await waitFor(() => expect(args.onCopy).toHaveBeenCalledWith('k1', [3, 4]));
    await expect(args.onBlockClick).not.toHaveBeenCalled();
  },
};

/** G-C4 + G-R3: the middle dropped on Bia's afastamento does nothing; on an open day it moves. */
export const MoveRefusesABlockedDay: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    press(canvas.getByTestId('sg-block-k1'));
    await settle();
    over(canvas.getByTestId('sg-cell-bia-1'));
    await settle();
    lift(canvas.getByTestId('sg-cell-bia-1'));
    await waitFor(() => expect(args.onMove).not.toHaveBeenCalled());
    press(canvas.getByTestId('sg-block-k1'));
    await settle();
    over(canvas.getByTestId('sg-cell-bia-4'));
    await settle();
    lift(canvas.getByTestId('sg-cell-bia-4'));
    await waitFor(() => expect(args.onMove).toHaveBeenCalledWith('k1', 'bia', 4));
  },
};

/** G-C8: Shift+→ copies one day, read aloud. */
export const KeyboardCopy: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const block = canvas.getByTestId('sg-block-k1');
    await fireEvent.keyDown(block, { key: 'ArrowRight', shiftKey: true });
    await waitFor(() => expect(args.onCopy).toHaveBeenCalledWith('k1', [3]));
    await waitFor(() => expect(canvas.getByTestId('sg-live')).toHaveTextContent('11:00–19:00 copiado para Qui 22/10'));
  },
};

/** G-E14 + G-E15: the break band lies inside its block at its share; the adornment sits beside the name. */
export const BreakAndAdornment: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const block = canvas.getByTestId('sg-block-k1').getBoundingClientRect();
    const band = canvas.getByTestId('sg-break-k1').getBoundingClientRect();
    await expect(band.left).toBeGreaterThan(block.left);
    await expect(band.right).toBeLessThan(block.right);
    await expect(Math.abs(band.left - block.left - block.width * 0.375)).toBeLessThan(2);
    const name = canvas.getByText('Ana Lima').getBoundingClientRect();
    const tag = canvas.getByText('Freela').getBoundingClientRect();
    // Beside the name while the column has room; under it in a narrow one — never over it.
    await expect(tag.left >= name.right - 0.5 || tag.top >= name.bottom - 0.5).toBe(true);
  },
};

/** G-C10: touch never drags. */
export const TouchDoesNotDrag: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const plus = within(canvas.getByTestId('sg-cell-ana-0')).getByRole('button');
    fireEvent.pointerDown(plus, { pointerType: 'touch', button: 0, isPrimary: true });
    await settle();
    fireEvent.pointerMove(canvas.getByTestId('sg-cell-ana-1'), { pointerType: 'touch', isPrimary: true });
    await settle();
    fireEvent.pointerUp(canvas.getByTestId('sg-cell-ana-1'), { pointerType: 'touch', isPrimary: true });
    await waitFor(() => expect(args.onCreate).not.toHaveBeenCalled());
  },
};
