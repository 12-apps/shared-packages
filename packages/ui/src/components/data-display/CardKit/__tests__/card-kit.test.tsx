import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type JSX } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CardActionsProvider, useCardActions } from '../card-actions-context';
import { CardKebab } from '../CardKebab';
import { rowActionsToMenuItems } from '../row-actions-to-menu';
import { TagList } from '../list-card-parts';
import { useRemoveConfirm } from '../use-remove-confirm';
import { useRowConfirm } from '../use-row-confirm';

/**
 * The kit's behavioural contract — the parts a consumer would otherwise
 * re-invent per entity, and therefore re-break per entity.
 *
 * The layout parts (`DetailColumns`, `Fact`, `Ledger`, `BodyHeading`) are
 * covered by their stories rather than here: they take `ReactNode` and place
 * it, so a test would assert the `sx` object back at itself. `TagList` is the
 * exception, because it has a BRANCH — the empty run is the case that matters.
 */

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  active: boolean;
}

const ROW: Row = { id: 'r1', name: 'First', active: true };

describe('the kebab', () => {
  it('K1: announces the name the consumer gave it', () => {
    render(<CardKebab menuLabel="Row actions" items={[]} />);
    expect(screen.getByRole('button', { name: 'Row actions' })).toBeInTheDocument();
  });

  it('K2: opens the items it was handed', async () => {
    const onClick = vi.fn();
    render(
      <CardKebab menuLabel="Row actions" items={[{ id: 'edit', label: 'Edit', onClick }]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
    fireEvent.click(await screen.findByText('Edit'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('one action list, two surfaces', () => {
  it('K3: fires the row action with THIS row, so the kebab and the grid agree', () => {
    const onSelect = vi.fn();
    const items = rowActionsToMenuItems<Row>([{ id: 'edit', label: 'Edit', onSelect }], ROW);
    items[0]?.onClick?.();
    expect(onSelect).toHaveBeenCalledWith([ROW]);
  });

  it('K4: applies `isVisible` per row rather than showing a disabled entry', () => {
    const items = rowActionsToMenuItems<Row>(
      [
        { id: 'edit', label: 'Edit', onSelect: vi.fn() },
        { id: 'activate', label: 'Activate', isVisible: (row) => !row.active, onSelect: vi.fn() },
      ],
      ROW,
    );
    expect(items.map((item) => item.id)).toEqual(['edit']);
  });

  it('K5: prefers a per-row label over the collective one', () => {
    const items = rowActionsToMenuItems<Row>(
      [{ id: 'toggle', label: 'Toggle', rowLabel: (row) => `Disable ${row.name}`, onSelect: vi.fn() }],
      ROW,
    );
    expect(items[0]?.label).toBe('Disable First');
  });
});

describe('an empty run of tags', () => {
  it('K6: says the consumer’s sentence rather than rendering nothing', () => {
    render(<TagList items={[]} empty="No products" />);
    expect(screen.getByText('No products')).toBeInTheDocument();
  });
});

describe('the ambient wiring', () => {
  function Consumer(): JSX.Element {
    const { tenantSlug } = useCardActions();
    return <span>{tenantSlug}</span>;
  }

  it('K7: hands a menu the tenant it is acting inside', () => {
    render(
      <CardActionsProvider tenantSlug="acme" onRefresh={vi.fn()} errorTitle="Action failed">
        <Consumer />
      </CardActionsProvider>,
    );
    expect(screen.getByText('acme')).toBeInTheDocument();
  });

  it('K8: THROWS outside a provider instead of answering a silent no-op', () => {
    // A menu whose `onRefresh` quietly did nothing would leave the operator
    // looking at a stale row after a delete that worked — which reads as the
    // delete having failed. Failing at mount says where the provider is missing.
    const noise = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(/CardActionsProvider/);
    noise.mockRestore();
  });
});

/** A self-contained menu, as a real kind menu is written. */
function RemoveMenu({ result }: { result: { ok: boolean; error?: string } }): JSX.Element {
  const remove = useRemoveConfirm({
    write: () => Promise.resolve(result),
    title: 'Delete it?',
    entityName: ROW.name,
    description: 'It leaves the list.',
    confirmText: 'Delete',
    fallbackError: 'Could not delete.',
    dataTestId: 'remove-confirm',
  });
  return (
    <>
      <button type="button" onClick={remove.request}>
        Open
      </button>
      {remove.dialog}
    </>
  );
}

describe('confirm before removing, from a menu', () => {
  it('K9: writes NOTHING until the operator confirms', async () => {
    const onRefresh = vi.fn();
    render(
      <CardActionsProvider tenantSlug="acme" onRefresh={onRefresh} errorTitle="Action failed">
        <RemoveMenu result={{ ok: true }} />
      </CardActionsProvider>,
    );
    fireEvent.click(screen.getByText('Open'));
    expect(onRefresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('K10: keeps the popup OPEN on a refusal, carrying the server’s sentence', async () => {
    render(
      <CardActionsProvider tenantSlug="acme" onRefresh={vi.fn()} errorTitle="Action failed">
        <RemoveMenu result={{ ok: false, error: 'Still in use.' }} />
      </CardActionsProvider>,
    );
    fireEvent.click(screen.getByText('Open'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    // Open, and saying why. A popup that closed here would look like a delete
    // that happened. Addressed by the dialog's OWN error slot rather than by
    // text: the same sentence is deliberately on screen twice, and a text query
    // would match both and fail as ambiguous.
    expect(await screen.findByTestId('remove-confirm-error')).toHaveTextContent('Still in use.');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('K11: also reports the refusal in the provider’s shared snackbar', async () => {
    render(
      <CardActionsProvider tenantSlug="acme" onRefresh={vi.fn()} errorTitle="Action failed">
        <RemoveMenu result={{ ok: false, error: 'Still in use.' }} />
      </CardActionsProvider>,
    );
    fireEvent.click(screen.getByText('Open'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    // The second of the two surfaces: this is what REMAINS once the operator
    // dismisses the popup, which is why the refusal is reported twice.
    expect(await screen.findByTestId('card-action-error')).toHaveTextContent('Still in use.');
  });
});

/** A grid-shaped selection, driven by `useRowConfirm`. */
function SelectionHarness({ rows }: { rows: Row[] }): JSX.Element {
  const [written, setWritten] = useState<string>('');
  const confirm = useRowConfirm<Row>({
    write: (selected) => {
      setWritten(selected.map((row) => row.name).join(','));
      return Promise.resolve();
    },
    describe: (selected) => ({
      title: selected.length === 1 ? 'Delete it?' : `Delete ${selected.length}?`,
      description: 'It leaves the list.',
      confirmText: 'Delete',
    }),
    dataTestId: 'row-confirm',
  });
  return (
    <>
      <button type="button" onClick={() => confirm.request(rows)}>
        Ask
      </button>
      <span data-testid="written">{written}</span>
      {confirm.dialog}
    </>
  );
}

describe('confirm a selection, from a grid', () => {
  it('K12: describes the popup from the SELECTION, not from one row', async () => {
    render(<SelectionHarness rows={[ROW, { ...ROW, id: 'r2', name: 'Second' }]} />);
    fireEvent.click(screen.getByText('Ask'));
    expect(await screen.findByText('Delete 2?')).toBeInTheDocument();
  });

  it('K13: writes the rows the operator was LOOKING at when asked', async () => {
    render(<SelectionHarness rows={[ROW, { ...ROW, id: 'r2', name: 'Second' }]} />);
    fireEvent.click(screen.getByText('Ask'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByTestId('written')).toHaveTextContent('First,Second'));
  });

  it('K14: opens nothing for an empty selection', async () => {
    render(<SelectionHarness rows={[]} />);
    fireEvent.click(screen.getByText('Ask'));
    // A popup about nothing, confirmed, writes nothing — so it must not open.
    await waitFor(() => expect(screen.queryByText('Delete it?')).not.toBeInTheDocument());
  });
});
