import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, fn, waitFor, within } from 'storybook/test';

import { PT_BR_UI_LABELS } from '../../../pt-BR.labels';
import { DayRuler } from './DayRuler';

/**
 * The day ruler's gestures in a real browser (FUT-3825): the hour under the
 * pointer comes from the track's real box. The jsdom suite
 * (`__tests__/DayRuler.test.tsx`) holds the full matrix.
 */
const meta: Meta<typeof DayRuler> = {
  title: 'Data Display/DayRuler/Tests',
  component: DayRuler,
  parameters: { layout: 'fullscreen', chromatic: { disableSnapshot: false } },
  tags: ['autodocs', 'test', 'component:DayRuler'],
  args: {
    rows: [
      {
        id: 'bruno',
        label: 'Bruno Lima',
        nameAdornment: <span>Freela</span>,
        blocks: [
          { id: 'p1', start: 11, end: 19, label: '11:00–19:00', tone: 'plan', movable: true, resizable: true, breakSpan: { start: 14, end: 15 } },
        ],
      },
      { id: 'kelly', label: 'Kelly Fontoura', blocks: [] },
    ],
    now: 20.75,
    labels: PT_BR_UI_LABELS.dayRuler,
    'aria-label': 'Escala do dia',
    dataTestId: 'dr',
    onCreate: fn(),
    onMove: fn(),
    onResize: fn(),
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

/** The x of `hour` on a row's track (06:00 → 02:00). */
function xOf(track: HTMLElement, hour: number): number {
  const box = track.getBoundingClientRect();
  return box.left + ((hour - 6) / 20) * box.width;
}

const mouse = { pointerType: 'mouse', isPrimary: true } as const;

/** D-C1 + D-R1: a drag on Kelly's empty track creates from 10:00 to the pointer, snapped to 15 min. */
export const DragCreates: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const track = canvas.getByTestId('dr-track-kelly');
    fireEvent.pointerDown(track, { ...mouse, button: 0, clientX: xOf(track, 10) });
    await settle();
    fireEvent.pointerMove(window, { ...mouse, buttons: 1, clientX: xOf(track, 12.55) });
    await settle();
    await waitFor(() => expect(canvas.getByTestId('dr-preview')).toHaveTextContent('10:00–12:30'));
    fireEvent.pointerUp(window, mouse);
    await waitFor(() => expect(args.onCreate).toHaveBeenCalledWith('kelly', 10, 12.5));
  },
};

/** D-C3 + D-E10: the middle dragged +2h keeps its length, and its break travels with it. */
export const MoveCarriesTheBreak: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const track = canvas.getByTestId('dr-track-bruno');
    const block = canvas.getByTestId('dr-block-p1');
    fireEvent.pointerDown(block, { ...mouse, button: 0, clientX: xOf(track, 12) });
    await settle();
    fireEvent.pointerMove(window, { ...mouse, buttons: 1, clientX: xOf(track, 14) });
    await settle();
    await waitFor(() => expect(block).toHaveTextContent('13:00–21:00'));
    const band = canvas.getByTestId('dr-break-p1').getBoundingClientRect();
    await expect(Math.abs(band.left - xOf(track, 16))).toBeLessThan(3);
    fireEvent.pointerUp(window, mouse);
    await waitFor(() => expect(args.onMove).toHaveBeenCalledWith('p1', 13, 21));
  },
};

/** D-C4 + D-R2: the right handle dragged to 20:00 resizes the end. */
export const ResizeEnd: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const track = canvas.getByTestId('dr-track-bruno');
    fireEvent.pointerDown(canvas.getByTestId('dr-handle-r-p1'), { ...mouse, button: 0, clientX: xOf(track, 19) });
    await settle();
    fireEvent.pointerMove(window, { ...mouse, buttons: 1, clientX: xOf(track, 20) });
    await settle();
    fireEvent.pointerUp(window, mouse);
    await waitFor(() => expect(args.onResize).toHaveBeenCalledWith('p1', 11, 20));
  },
};

/** D-C8: Alt+→ moves by one snap, read aloud. */
export const KeyboardMove: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const block = canvas.getByTestId('dr-block-p1');
    await fireEvent.keyDown(block, { key: 'ArrowRight', altKey: true });
    await waitFor(() => expect(args.onMove).toHaveBeenCalledWith('p1', 11.25, 19.25));
    await waitFor(() => expect(canvas.getByTestId('dr-live')).toHaveTextContent('11:15–19:15'));
  },
};

/** D-E11: the adornment sits beside the name. */
export const Adornment: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const name = canvas.getByText('Bruno Lima').getBoundingClientRect();
    const tag = canvas.getByText('Freela').getBoundingClientRect();
    // Beside the name while the column has room; under it in a narrow one — never over it.
    await expect(tag.left >= name.right - 0.5 || tag.top >= name.bottom - 0.5).toBe(true);
  },
};
