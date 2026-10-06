/**
 * A tab's inline count: said after the label, inside the tab — part of its
 * accessible name, so "Itens 2" reads as one control — and toned by what it
 * asks for.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Tabs } from './Tabs';

afterEach(cleanup);

function renderTabs(): void {
  render(
    <Tabs
      closeTabLabel="Fechar"
      value="items"
      onChange={() => undefined}
      variant="underline"
      items={[
        { id: 'items', label: 'Itens', count: { value: 2 }, content: <p>itens</p> },
        { id: 'payment', label: 'Pagamento', count: { value: '!', tone: 'warning' }, content: <p>pagamento</p> },
        { id: 'chat', label: 'Conversa', count: { value: '1 nova', tone: 'danger' }, content: <p>conversa</p> },
        { id: 'plain', label: 'Sem contagem', content: <p>nada</p> },
      ]}
    />,
  );
}

describe('Tabs count', () => {
  it('says the count inside the tab, after its label', () => {
    renderTabs();
    expect(screen.getByRole('tab', { name: 'Itens 2' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pagamento !' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sem contagem' })).toBeInTheDocument();
  });

  it('tones each count, neutral by default', () => {
    renderTabs();
    const tone = (name: string): string | null =>
      screen.getByRole('tab', { name }).querySelector('[data-tone]')?.getAttribute('data-tone') ?? null;
    expect(tone('Itens 2')).toBe('neutral');
    expect(tone('Pagamento !')).toBe('warning');
    expect(tone('Conversa 1 nova')).toBe('danger');
  });
});
