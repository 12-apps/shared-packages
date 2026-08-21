// @vitest-environment jsdom
// fireEvent/render from @testing-library/react — no user-event, no jest-dom.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PT_BR_RESEARCH_MESSAGES } from '../pt-BR';
import { describe, expect, it, vi } from 'vitest';

import { ResearchForm } from '../research-form';
import { fakeClient } from './fake-client';

describe('ResearchForm', () => {
  it('rejects a too-short term before touching the client', async () => {
    const onStarted = vi.fn();
    render(<ResearchForm messages={PT_BR_RESEARCH_MESSAGES} client={fakeClient()} onStarted={onStarted} />);

    fireEvent.change(screen.getByTestId('research-term'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('research-submit'));

    await waitFor(() => expect(screen.queryByTestId('research-form-error')).not.toBeNull());
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('submits the trimmed query and hands the requestId to the host', async () => {
    const seen: unknown[] = [];
    const client = fakeClient({
      startResearch: (query) => {
        seen.push(query);
        return Promise.resolve({ requestId: 'req-9' });
      },
    });
    const onStarted = vi.fn();
    render(<ResearchForm messages={PT_BR_RESEARCH_MESSAGES} client={client} onStarted={onStarted} defaultRegion="01310-200" />);

    fireEvent.change(screen.getByTestId('research-term'), {
      target: { value: '  Guaraná 1L  ' },
    });
    fireEvent.change(screen.getByTestId('research-quantity'), { target: { value: '6' } });
    fireEvent.click(screen.getByTestId('research-submit'));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('req-9'));
    expect(seen).toEqual([
      { term: 'Guaraná 1L', brand: undefined, quantity: 6, region: '01310-200' },
    ]);
  });

  it('shows the client failure and re-enables the submit', async () => {
    const client = fakeClient({
      startResearch: () => Promise.reject(new Error('sem permissão')),
    });
    render(<ResearchForm messages={PT_BR_RESEARCH_MESSAGES} client={client} onStarted={vi.fn()} />);

    fireEvent.change(screen.getByTestId('research-term'), { target: { value: 'Café' } });
    fireEvent.click(screen.getByTestId('research-submit'));

    await waitFor(() => expect(screen.queryByTestId('research-form-error')).not.toBeNull());
    expect(screen.getByTestId('research-form-error').textContent).toContain('sem permissão');
    expect((screen.getByTestId('research-submit') as HTMLButtonElement).disabled).toBe(false);
  });
});
