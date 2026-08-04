// @vitest-environment jsdom
// renderHook/waitFor from @testing-library/react (act()-wrapped) — the same
// choice as payments-frontend's context tests; no user-event, no jest-dom.
// The fake client reads a mutable state CONTAINER the test flips between
// assertions, so every phase holds until observed — asserting free-running
// 5ms transitions would race waitFor's sampling.
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useResearchRun } from '../use-research-run';
import { channelHarness, finishedEvent, settledEvent } from './fake-channel';
import { fakeClient, requestView, runView } from './fake-client';

const RUN_STAMP = { id: 'run-1', status: 'x', startedAt: null, finishedAt: null };

describe('useResearchRun', () => {
  it('walks queued → running → completed and then stops polling', async () => {
    const state = { runStatus: null as string | null, runCalls: 0 };
    const client = fakeClient({
      getRequest: () =>
        Promise.resolve(
          requestView(state.runStatus === null ? {} : { latestRun: RUN_STAMP }),
        ),
      getRun: () => {
        state.runCalls += 1;
        return Promise.resolve(runView({ status: state.runStatus ?? 'RUNNING' }));
      },
    });

    const { result } = renderHook(() => useResearchRun(client, 'req-1', { intervalMs: 5 }));

    await waitFor(() => expect(result.current.phase).toBe('queued'));
    state.runStatus = 'RUNNING';
    await waitFor(() => expect(result.current.phase).toBe('running'));
    state.runStatus = 'COMPLETED';
    await waitFor(() => expect(result.current.phase).toBe('completed'));
    expect(result.current.run?.offers).toHaveLength(1);

    // Terminal: the loop must stop rescheduling. Proving the ABSENCE of
    // further polls needs a bounded real-time window — eight 5ms intervals
    // fit inside it, so a still-live loop cannot slip through undetected.
    const settledRuns = state.runCalls;
    // eslint-disable-next-line test-flakiness/no-unconditional-wait -- absence-of-calls check; can only false-pass (never flake red) if timers stall
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(state.runCalls).toBe(settledRuns);
  });

  it('folds a transport failure into the error phase, and reload restarts', async () => {
    const state = { failing: true };
    const client = fakeClient({
      getRequest: () =>
        state.failing
          ? Promise.reject(new Error('rede fora'))
          : Promise.resolve(requestView({ latestRun: RUN_STAMP })),
      getRun: () => Promise.resolve(runView()),
    });

    const { result } = renderHook(() => useResearchRun(client, 'req-1', { intervalMs: 5 }));
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.error).toBe('rede fora');

    state.failing = false;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.phase).toBe('completed'));
  });
});

describe('useResearchRun with a realtime channel (FUT-439)', () => {
  /** RUNNING run, counting getRun calls; the giant interval means every poll
   * tick in these tests is one WE caused (mount, connect, disconnect,
   * run-finished) — never the timer, so call-count asserts are exact. */
  const streamingHarness = () => {
    const container = { runStatus: 'RUNNING', runCalls: 0 };
    const harnessClient = fakeClient({
      getRequest: () => Promise.resolve(requestView({ latestRun: RUN_STAMP })),
      getRun: () => {
        container.runCalls += 1;
        return Promise.resolve(
          runView({ status: container.runStatus, sourceStats: [], offers: [] }),
        );
      },
    });
    return { state: container, client: harnessClient, channel: channelHarness() };
  };

  it('resolves per-source stats from events without a poll tick, then re-reads on run-finished', async () => {
    const { state, client, channel } = streamingHarness();
    const { result } = renderHook(() =>
      useResearchRun(client, 'req-1', { intervalMs: 60_000, channel: channel.useChannel }),
    );
    await waitFor(() => expect(result.current.phase).toBe('running'));

    act(() => channel.setConnected(true));
    // The connect transition re-reads once (events before the subscription
    // are gone forever); everything after this count is event-driven.
    await waitFor(() => expect(state.runCalls).toBe(2));

    act(() => channel.emit(settledEvent({ sourceId: 'src-a', offerCount: 12 })));
    expect(result.current.sourceStats).toMatchObject([
      { sourceId: 'src-a', status: 'OK', offerCount: 12 },
    ]);
    act(() => channel.emit(settledEvent({ sourceId: 'src-b', status: 'FAILED', offerCount: 0 })));
    expect(result.current.sourceStats).toHaveLength(2);
    // Both statuses were already on screen SYNCHRONOUSLY, straight off the
    // events — no poll resolved them. The single extra read that follows is
    // FUT-519's offer pull for the source that actually reported offers; the
    // failed one costs nothing.
    await waitFor(() => expect(state.runCalls).toBe(3));
    expect(result.current.phase).toBe('running');

    state.runStatus = 'COMPLETED';
    act(() => channel.emit(finishedEvent()));
    // The terminal event is a hint to re-read — the API stays the truth.
    await waitFor(() => expect(result.current.phase).toBe('completed'));
    expect(state.runCalls).toBe(4);
  });

  /**
   * FUT-519: a source that settled WITH offers has already persisted them, so
   * the settled event doubles as the hint to pull the partial table in. One
   * extra read per contributing source — not a resumed poll.
   */
  it('re-reads once for a source that reported offers, and not for one that did not', async () => {
    const { state, client, channel } = streamingHarness();
    const { result } = renderHook(() =>
      useResearchRun(client, 'req-1', { intervalMs: 60_000, channel: channel.useChannel }),
    );
    await waitFor(() => expect(result.current.phase).toBe('running'));
    act(() => channel.setConnected(true));
    await waitFor(() => expect(state.runCalls).toBe(2));

    act(() => channel.emit(settledEvent({ sourceId: 'src-a', offerCount: 12 })));
    await waitFor(() => expect(state.runCalls).toBe(3));

    // A source with nothing to show costs no read: its status still lands,
    // straight off the event, and the run endpoint is left alone.
    act(() => channel.emit(settledEvent({ sourceId: 'src-b', status: 'FAILED', offerCount: 0 })));
    await waitFor(() => expect(result.current.sourceStats).toHaveLength(2));
    expect(state.runCalls).toBe(3);
    expect(result.current.phase).toBe('running');
  });

  it('ignores events from a run it is not watching', async () => {
    const { state, client, channel } = streamingHarness();
    const { result } = renderHook(() =>
      useResearchRun(client, 'req-1', { intervalMs: 60_000, channel: channel.useChannel }),
    );
    await waitFor(() => expect(result.current.phase).toBe('running'));
    act(() => channel.setConnected(true));
    // Let the connect-transition re-read settle before pushing events.
    await waitFor(() => expect(state.runCalls).toBe(2));

    act(() => channel.emit(settledEvent({ sourceId: 'src-x' }, 'run-OTHER')));
    expect(result.current.sourceStats).toEqual([]);
  });

  it('keeps polling exactly as before while the channel is not connected', async () => {
    const state = { runStatus: 'RUNNING', runCalls: 0 };
    const client = fakeClient({
      getRequest: () => Promise.resolve(requestView({ latestRun: RUN_STAMP })),
      getRun: () => {
        state.runCalls += 1;
        return Promise.resolve(runView({ status: state.runStatus, offers: [] }));
      },
    });
    const channel = channelHarness(); // never connected
    const { result } = renderHook(() =>
      useResearchRun(client, 'req-1', { intervalMs: 5, channel: channel.useChannel }),
    );

    await waitFor(() => expect(result.current.phase).toBe('running'));
    // The loop is alive: the run keeps being re-read on the interval.
    await waitFor(() => expect(state.runCalls).toBeGreaterThan(2));
    state.runStatus = 'COMPLETED';
    await waitFor(() => expect(result.current.phase).toBe('completed'));
  });

  it('resumes the polling loop the moment the channel drops', async () => {
    const { state, client, channel } = streamingHarness();
    const { result } = renderHook(() =>
      useResearchRun(client, 'req-1', { intervalMs: 5, channel: channel.useChannel }),
    );
    await waitFor(() => expect(result.current.phase).toBe('running'));
    act(() => channel.setConnected(true));

    // Drop the channel; polling must pick the terminal status up by itself.
    state.runStatus = 'COMPLETED';
    act(() => channel.setConnected(false));
    await waitFor(() => expect(result.current.phase).toBe('completed'));
  });
});
