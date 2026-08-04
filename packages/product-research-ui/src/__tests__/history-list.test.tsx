// @vitest-environment jsdom
// fireEvent/render from @testing-library/react — no user-event, no jest-dom.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResearchHistoryList } from '../history-list';
import { DEFAULT_MESSAGES } from '../messages';
import { RESEARCH_RUN_STALE_AFTER_MS } from '../repeat-guard';
import { requestView } from './fake-client';

/**
 * Pesquisas recentes (FUT-494): the two host seams. Both actions are optional
 * props — the package must render the block unchanged for a host that passes
 * neither, offer them for a host that does, and never repeat a research whose
 * run is still in flight — unless that run has been in flight so long it is
 * presumed abandoned (FUT-494 follow-up).
 */

const DONE = { id: 'run-1', status: 'COMPLETED', startedAt: null, finishedAt: null };
const RUNNING = { id: 'run-1', status: 'RUNNING', startedAt: null, finishedAt: null };
const FAILED = { id: 'run-1', status: 'FAILED', startedAt: null, finishedAt: null };

const settled = requestView({ id: 'req-1', latestRun: DONE });

/** A fixed "now", so a run's age is arithmetic rather than wall-clock luck. */
const NOW = new Date('2026-07-30T12:00:00.000Z');

/** A RUNNING run that started `ageMs` before {@link NOW}. */
function runningSince(ageMs: number): { id: string; status: string; startedAt: string; finishedAt: null } {
  return {
    id: 'run-live',
    status: 'RUNNING',
    startedAt: new Date(NOW.getTime() - ageMs).toISOString(),
    finishedAt: null,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ResearchHistoryList — repeat', () => {
  it('renders no repeat action when the host passes no callback', async () => {
    render(<ResearchHistoryList requests={[settled]} onOpen={vi.fn()} />);

    // The existing affordance is untouched, and no repeat joins it.
    expect(screen.getByTestId('research-history-open-req-1')).not.toBeNull();
    await waitFor(() =>
      expect(screen.queryByTestId('research-history-repeat-req-1')).toBeNull(),
    );
  });

  it('hands the whole request back so the host can re-send its query', () => {
    const onRepeat = vi.fn();
    render(<ResearchHistoryList requests={[settled]} onOpen={vi.fn()} onRepeat={onRepeat} />);

    fireEvent.click(screen.getByTestId('research-history-repeat-req-1'));

    expect(onRepeat).toHaveBeenCalledTimes(1);
    expect(onRepeat).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'req-1', term: settled.term, quantity: settled.quantity }),
    );
  });

  it('offers the repeat on a FAILED research too — retrying is the point', () => {
    const onRepeat = vi.fn();
    render(
      <ResearchHistoryList
        requests={[requestView({ id: 'req-2', latestRun: FAILED })]}
        onOpen={vi.fn()}
        onRepeat={onRepeat}
      />,
    );

    const button = screen.getByTestId('research-history-repeat-req-2') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onRepeat).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['still running', RUNNING],
    ['queued with no run yet', null],
  ])('disables the repeat while the run is %s', (_label, latestRun) => {
    const onRepeat = vi.fn();
    render(
      <ResearchHistoryList
        requests={[requestView({ id: 'req-3', latestRun })]}
        onOpen={vi.fn()}
        onRepeat={onRepeat}
      />,
    );

    const button = screen.getByTestId('research-history-repeat-req-3') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe(DEFAULT_MESSAGES.historyRepeatRunningHint);
    fireEvent.click(button);
    expect(onRepeat).not.toHaveBeenCalled();
  });

  it('keeps the repeat disabled while a fresh run is genuinely in flight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const onRepeat = vi.fn();
    render(
      <ResearchHistoryList
        requests={[
          requestView({ id: 'req-4', latestRun: runningSince(RESEARCH_RUN_STALE_AFTER_MS - 60_000) }),
        ]}
        onOpen={vi.fn()}
        onRepeat={onRepeat}
      />,
    );

    const button = screen.getByTestId('research-history-repeat-req-4') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe(DEFAULT_MESSAGES.historyRepeatRunningHint);
  });

  it('offers the repeat once a run has been in flight past the stale horizon', () => {
    // The dead end this closes: a worker killed mid-run leaves the row RUNNING
    // forever, and nothing server-side reaps it.
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const onRepeat = vi.fn();
    render(
      <ResearchHistoryList
        requests={[
          requestView({ id: 'req-5', latestRun: runningSince(RESEARCH_RUN_STALE_AFTER_MS + 60_000) }),
        ]}
        onOpen={vi.fn()}
        onRepeat={onRepeat}
      />,
    );

    const button = screen.getByTestId('research-history-repeat-req-5') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.title).toBe('');
    fireEvent.click(button);
    expect(onRepeat).toHaveBeenCalledTimes(1);
  });

  it('still shows the in-flight chip for a stale run — the UI never restates the run', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    render(
      <ResearchHistoryList
        requests={[
          requestView({ id: 'req-6', latestRun: runningSince(RESEARCH_RUN_STALE_AFTER_MS + 60_000) }),
        ]}
        onOpen={vi.fn()}
        onRepeat={vi.fn()}
      />,
    );

    expect(screen.getByTestId('research-history-req-6').textContent).toContain(
      DEFAULT_MESSAGES.historyStatusRunning,
    );
  });

  it('takes the repeat label from the messages layer', () => {
    render(
      <ResearchHistoryList
        requests={[settled]}
        onOpen={vi.fn()}
        onRepeat={vi.fn()}
        messages={{ historyRepeat: 'Buscar de novo' }}
      />,
    );

    expect(screen.getByTestId('research-history-repeat-req-1').textContent).toBe('Buscar de novo');
  });
});

describe('ResearchHistoryList — ver todas', () => {
  it('renders no link when the host has no history page', async () => {
    render(<ResearchHistoryList requests={[settled]} onOpen={vi.fn()} />);

    expect(screen.getByTestId('research-history')).not.toBeNull();
    await waitFor(() => expect(screen.queryByTestId('research-history-view-all')).toBeNull());
  });

  it('calls the host navigation once clicked', () => {
    const onViewAll = vi.fn();
    render(<ResearchHistoryList requests={[]} onOpen={vi.fn()} onViewAll={onViewAll} />);

    const link = screen.getByTestId('research-history-view-all');
    expect(link.textContent).toBe(DEFAULT_MESSAGES.historyViewAll);
    fireEvent.click(link);

    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it('stays visible on an empty block — the page explains the emptiness', () => {
    render(<ResearchHistoryList requests={[]} onOpen={vi.fn()} onViewAll={vi.fn()} />);

    expect(screen.getByTestId('research-history-empty')).not.toBeNull();
    expect(screen.getByTestId('research-history-view-all')).not.toBeNull();
  });
});
