/**
 * The 0 / 1 / n rule, and the two properties that make it safe to adopt across
 * an estate of headers that already had suites pointing at their buttons.
 *
 * Every case here is about a COUNT changing what renders, which is the one
 * thing a JSX-composed header could not do — so these are the assertions that
 * would go quiet if someone "simplified" this back into a slot.
 */
import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HeaderActions } from '../HeaderActions';
import type { HeaderActionItem } from '../HeaderActions';

const MORE = 'Mais ações';

function action(id: string, text: string, overrides: Partial<HeaderActionItem> = {}): HeaderActionItem {
  return { id, text, icon: <AddIcon fontSize="small" />, ...overrides };
}

describe('HeaderActions — how many controls a count produces', () => {
  it('renders nothing at all for an empty list', () => {
    const { container } = render(<HeaderActions actions={[]} moreLabel={MORE} />);

    // Not an empty flex box either: a header that declares no actions must not
    // pay a gap for them.
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when every declared action is gated away', () => {
    const { container } = render(
      <HeaderActions actions={[action('a', 'A', { visible: false }), false, null]} moreLabel={MORE} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders a single action as a plain button, with no overflow trigger', () => {
    render(<HeaderActions actions={[action('new-product', 'Novo produto')]} moreLabel={MORE} />);

    expect(screen.getByRole('button', { name: 'Novo produto' })).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: MORE })).toEqual([]);
  });

  it('keeps the FIRST action as a button and folds the rest away', () => {
    render(
      <HeaderActions
        actions={[action('a', 'Novo produto'), action('b', 'Exportar'), action('c', 'Importar')]}
        moreLabel={MORE}
      />,
    );

    expect(screen.getByRole('button', { name: 'Novo produto' })).toBeTruthy();
    expect(screen.getByRole('button', { name: MORE })).toBeTruthy();
    // The other two are not on the bar — that IS the feature.
    expect(screen.queryAllByRole('button', { name: 'Exportar' })).toEqual([]);
    expect(screen.queryAllByRole('button', { name: 'Importar' })).toEqual([]);
  });

  it('promotes the next action to the button when the first is gated away', () => {
    render(
      <HeaderActions
        actions={[action('a', 'Novo produto', { visible: false }), action('b', 'Exportar')]}
        moreLabel={MORE}
      />,
    );

    // Two declared, one present ⇒ the single-action shape, not a lone menu.
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: MORE })).toEqual([]);
  });
});

describe('HeaderActions — the overflow menu', () => {
  it('opens on the trigger and runs the picked action', async () => {
    const onExport = vi.fn();
    render(
      <HeaderActions
        actions={[action('a', 'Novo produto'), { ...action('b', 'Exportar'), icon: <DownloadIcon />, onClick: onExport }]}
        moreLabel={MORE}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: MORE }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Exportar' }));

    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('closes the menu after a pick', async () => {
    render(
      <HeaderActions actions={[action('a', 'Novo'), action('b', 'Exportar')]} moreLabel={MORE} />,
    );

    fireEvent.click(screen.getByRole('button', { name: MORE }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Exportar' }));

    await waitFor(() => {
      expect(screen.queryAllByRole('menuitem', { name: 'Exportar' })).toEqual([]);
    });
  });

  it('carries a disabled overflow action through as disabled', async () => {
    const onImport = vi.fn();
    render(
      <HeaderActions
        actions={[
          action('a', 'Novo'),
          { ...action('b', 'Importar'), icon: <UploadIcon />, onClick: onImport, disabled: true },
        ]}
        moreLabel={MORE}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: MORE }));

    // Asserted on the ATTRIBUTE, not by clicking: MUI disables a MenuItem with
    // `pointer-events: none` plus `aria-disabled`, and `fireEvent` dispatches
    // straight at the node — so a click here would "pass" against a component
    // that had never disabled anything. The attribute is what a browser and a
    // screen reader both act on.
    const item = await screen.findByRole('menuitem', { name: 'Importar', hidden: true });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(onImport).not.toHaveBeenCalled();
  });

  it('marks the trigger as a menu button for assistive tech', () => {
    render(<HeaderActions actions={[action('a', 'Novo'), action('b', 'Exportar')]} moreLabel={MORE} />);

    const trigger = screen.getByRole('button', { name: MORE });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('HeaderActions — selectors survive the move', () => {
  it('keeps an action id on the button it renders as', () => {
    render(<HeaderActions actions={[action('new-product', 'Novo produto')]} moreLabel={MORE} />);

    expect(screen.getByTestId('new-product')).toBeTruthy();
  });

  it('keeps the SAME id when that action is pushed into the menu', async () => {
    render(
      <HeaderActions
        actions={[action('a', 'Novo'), action('export-sheet', 'Exportar', { dataTestId: 'export-catalog-sheet-button' })]}
        moreLabel={MORE}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: MORE }));

    // The element moved and changed role; the selector did not.
    expect(await screen.findByTestId('export-catalog-sheet-button')).toBeTruthy();
  });

  it('names the trigger and menu from testIdPrefix', async () => {
    render(
      <HeaderActions
        actions={[action('a', 'Novo'), action('b', 'Exportar')]}
        moreLabel={MORE}
        testIdPrefix="produtos"
      />,
    );

    fireEvent.click(screen.getByTestId('produtos-more-trigger'));

    expect(await screen.findByTestId('produtos-more-menu')).toBeTruthy();
  });
});
