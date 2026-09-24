// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { changeRequest } from '../__stories__/fixtures';
import type { ApprovalRequestWire, ApprovalStatusWire } from '../api';
import { createWebEntityLifecycle } from '../create-web-entity-lifecycle';
import { PT_BR_LIFECYCLE_WEB_COPY } from '../pt-BR';
import { LifecycleHttpError, type LifecycleResult, type LifecycleTransport } from '../transport';

/**
 * The inbox's two host hooks (FUT-2520), driven through the FACTORY's
 * `ApprovalsScreen` — so every case here also proves the factory forwards
 * the prop it exercises:
 *
 *  - `refreshSignal`: a change re-reads the current status in the background,
 *    with the rows left mounted, and a read answering for a status the user
 *    already left never lands;
 *  - `onDecided`: once per successful decision, never for a refused one, and
 *    a hook that throws cannot escape the click.
 *
 * A failed refresh keeps the rows (a 403 aside), and a signal that arrives
 * while the list is LOADING waits for the load instead of superseding it.
 */

afterEach(cleanup);

const API_BASE = '/api/admin/loja';

/**
 * A transport whose approvals answers the test sets per status, and whose
 * next read of a status can be HELD until the test releases it — the only way
 * to look at the screen while a background read is still in flight.
 */
function inboxTransport(writes: LifecycleResult<unknown>[] = []) {
  const answers: Record<ApprovalStatusWire, ApprovalRequestWire[]> = {
    PENDING: [],
    APPROVED: [],
    REJECTED: [],
  };
  const held = new Map<ApprovalStatusWire, Promise<void>>();
  const failing = new Map<ApprovalStatusWire, Error>();
  const reads: string[] = [];
  const sends: string[] = [];

  const transport: LifecycleTransport = {
    async get<T>(url: string): Promise<T> {
      reads.push(url);
      const status = /[?&]status=(\w+)/.exec(url)?.[1] as ApprovalStatusWire;
      const gate = held.get(status);
      const failure = failing.get(status);
      held.delete(status);
      failing.delete(status);
      if (gate) await gate;
      if (failure) throw failure;
      // Answer with the list as it stands WHEN the read resolves.
      return { data: { requests: answers[status] } } as T;
    },
    async send<T>(url: string): Promise<LifecycleResult<T>> {
      sends.push(url);
      return (writes.shift() ?? { ok: true, data: undefined }) as LifecycleResult<T>;
    },
  };

  /** Hold the next read of `status`; the returned function answers it. */
  function hold(status: ApprovalStatusWire): () => void {
    const openers: (() => void)[] = [];
    held.set(status, new Promise<void>((resolve) => openers.push(resolve)));
    return () => openers.forEach((open) => open());
  }

  /** Make the next read of `status` to START fail with `error`. */
  function fail(status: ApprovalStatusWire, error: Error): void {
    failing.set(status, error);
  }

  return { transport, answers, reads, sends, hold, fail };
}

/** The error state's title — the load failure a refresh must not surface. */
const LOAD_FAILED = PT_BR_LIFECYCLE_WEB_COPY.approvals.loadFailedTitle;

/** Let any read that just settled reach the screen. */
const flush = async (): Promise<void> => {
  await act(async () => undefined);
};

function screenOver(transport: LifecycleTransport) {
  return createWebEntityLifecycle({
    apiBase: API_BASE,
    copy: PT_BR_LIFECYCLE_WEB_COPY,
    transport,
  }).ApprovalsScreen;
}

describe('ApprovalsScreen refreshSignal', () => {
  it('re-reads the current status in the background, with the rows left mounted', async () => {
    const inbox = inboxTransport();
    inbox.answers.PENDING = [changeRequest({ id: 'cr-1' })];
    const Screen = screenOver(inbox.transport);
    const { rerender } = render(<Screen refreshSignal={0} />);
    await waitFor(() => expect(screen.getByTestId('approval-request-cr-1')).toBeTruthy());
    // The mount's own value reads nothing extra.
    expect(inbox.reads).toEqual([`${API_BASE}/approvals?status=PENDING`]);

    // A colleague parks a second request; the host bumps the signal.
    inbox.answers.PENDING = [
      changeRequest({ id: 'cr-2', label: 'Suco de laranja' }),
      changeRequest({ id: 'cr-1' }),
    ];
    const release = inbox.hold('PENDING');
    rerender(<Screen refreshSignal={1} />);

    // While that read is in flight, the old rows are still on screen and the
    // loading state never showed: nothing blanked.
    await waitFor(() => expect(inbox.reads).toHaveLength(2));
    expect(inbox.reads[1]).toBe(`${API_BASE}/approvals?status=PENDING`);
    expect(screen.getByTestId('approval-request-cr-1')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('approvals-loading')).toBeNull());

    await act(async () => release());
    await waitFor(() => expect(screen.getByTestId('approval-request-cr-2')).toBeTruthy());
    expect(screen.getByTestId('approval-request-cr-1')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('approvals-loading')).toBeNull());
  });

  it('re-reads again on every later change, and not on a re-render with the same value', async () => {
    const inbox = inboxTransport();
    inbox.answers.PENDING = [changeRequest({ id: 'cr-1' })];
    const Screen = screenOver(inbox.transport);
    const { rerender } = render(<Screen refreshSignal="a" />);
    await waitFor(() => expect(screen.getByTestId('approval-request-cr-1')).toBeTruthy());

    rerender(<Screen refreshSignal="a" />);
    rerender(<Screen refreshSignal="b" />);
    rerender(<Screen refreshSignal="c" />);
    await waitFor(() => expect(inbox.reads).toHaveLength(3));
    expect(screen.getByTestId('approval-request-cr-1')).toBeTruthy();
  });

  it('keeps blanking on a chip change, and drops a refresh answering for the old status', async () => {
    const inbox = inboxTransport();
    inbox.answers.PENDING = [changeRequest({ id: 'cr-1' })];
    inbox.answers.APPROVED = [changeRequest({ id: 'cr-9', status: 'APPROVED' })];
    const Screen = screenOver(inbox.transport);
    const { rerender } = render(<Screen refreshSignal={0} />);
    await waitFor(() => expect(screen.getByTestId('approval-request-cr-1')).toBeTruthy());

    // A background PENDING read goes out and stalls…
    const releasePending = inbox.hold('PENDING');
    rerender(<Screen refreshSignal={1} />);
    await waitFor(() => expect(inbox.reads).toHaveLength(2));

    // …the user switches to Aprovadas, whose read stalls too: the chip change
    // blanks the list exactly as before.
    const releaseApproved = inbox.hold('APPROVED');
    fireEvent.click(screen.getByTestId('approvals-filter-APPROVED'));
    await waitFor(() => expect(screen.getByTestId('approvals-loading')).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId('approval-request-cr-1')).toBeNull());

    // The stale PENDING answer lands first (the act flushes it) — and is
    // dropped: the list stays blank, still waiting on Aprovadas.
    await act(async () => releasePending());
    await waitFor(() => expect(screen.queryByTestId('approval-request-cr-1')).toBeNull());
    expect(screen.getByTestId('approvals-loading')).toBeTruthy();

    await act(async () => releaseApproved());
    await waitFor(() => expect(screen.getByTestId('approval-request-cr-9')).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId('approval-request-cr-1')).toBeNull());
  });
});

describe('ApprovalsScreen refreshSignal failures and overlaps', () => {
  it('keeps the rows when a refresh fails, with no error and no loading state', async () => {
    const inbox = inboxTransport();
    inbox.answers.PENDING = [changeRequest({ id: 'cr-1' })];
    const Screen = screenOver(inbox.transport);
    const { rerender } = render(<Screen refreshSignal={0} />);
    await waitFor(() => expect(screen.getByTestId('approval-request-cr-1')).toBeTruthy());

    inbox.fail('PENDING', new Error('Falha de rede.'));
    rerender(<Screen refreshSignal={1} />);
    await waitFor(() => expect(inbox.reads).toHaveLength(2));
    await flush();

    expect(screen.getByTestId('approval-request-cr-1')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(LOAD_FAILED)).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('approvals-loading')).toBeNull());
  });

  it('queues a signal that arrives mid-load, so a failed refresh cannot hide the load', async () => {
    // The page's own decision re-loads the list AND triggers the hint that
    // bumps the signal. The refresh must wait for the load, not supersede it.
    const inbox = inboxTransport();
    inbox.answers.PENDING = [changeRequest({ id: 'cr-1' })];
    const Screen = screenOver(inbox.transport);
    const releaseLoad = inbox.hold('PENDING');
    const { rerender } = render(<Screen refreshSignal={0} />);
    await waitFor(() => expect(screen.getByTestId('approvals-loading')).toBeTruthy());

    inbox.fail('PENDING', new Error('Falha de rede.'));
    rerender(<Screen refreshSignal={1} />);
    // Queued, not sent: only the load is in flight.
    expect(inbox.reads).toHaveLength(1);

    await act(async () => releaseLoad());
    await waitFor(() => expect(screen.getByTestId('approval-request-cr-1')).toBeTruthy());
    // …and then the ONE queued refresh ran, failed, and left the rows alone.
    await waitFor(() => expect(inbox.reads).toHaveLength(2));
    await flush();
    expect(screen.getByTestId('approval-request-cr-1')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(LOAD_FAILED)).toBeNull());
  });

  it('drops a FAILED refresh answering for a status the user already left', async () => {
    const inbox = inboxTransport();
    inbox.answers.PENDING = [changeRequest({ id: 'cr-1' })];
    inbox.answers.APPROVED = [changeRequest({ id: 'cr-9', status: 'APPROVED' })];
    const Screen = screenOver(inbox.transport);
    const { rerender } = render(<Screen refreshSignal={0} />);
    await waitFor(() => expect(screen.getByTestId('approval-request-cr-1')).toBeTruthy());

    const releasePending = inbox.hold('PENDING');
    inbox.fail('PENDING', new Error('Falha de rede.'));
    rerender(<Screen refreshSignal={1} />);
    await waitFor(() => expect(inbox.reads).toHaveLength(2));

    const releaseApproved = inbox.hold('APPROVED');
    fireEvent.click(screen.getByTestId('approvals-filter-APPROVED'));
    await waitFor(() => expect(screen.getByTestId('approvals-loading')).toBeTruthy());

    // The stale PENDING failure lands while Aprovadas is loading — dropped.
    await act(async () => releasePending());
    await flush();
    await waitFor(() => expect(screen.queryByText(LOAD_FAILED)).toBeNull());
    expect(screen.getByTestId('approvals-loading')).toBeTruthy();

    await act(async () => releaseApproved());
    await waitFor(() => expect(screen.getByTestId('approval-request-cr-9')).toBeTruthy());
  });

  it('lets a refresh answered 403 through: the feature was switched off', async () => {
    const inbox = inboxTransport();
    inbox.answers.PENDING = [changeRequest({ id: 'cr-1' })];
    const Screen = screenOver(inbox.transport);
    const { rerender } = render(<Screen refreshSignal={0} />);
    await waitFor(() => expect(screen.getByTestId('approval-request-cr-1')).toBeTruthy());

    inbox.fail('PENDING', new LifecycleHttpError(403, 'Recurso não está ativo.'));
    rerender(<Screen refreshSignal={1} />);

    await waitFor(() => expect(screen.getByTestId('approvals-feature-off')).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId('approval-request-cr-1')).toBeNull());
  });
});

describe('ApprovalsScreen onDecided', () => {
  it('fires once per successful approve or reject, and not for a refused one', async () => {
    const inbox = inboxTransport([
      { ok: true, data: { applied: true, entityId: 'p1', requestId: null } },
      { ok: true, data: undefined },
      { ok: false, error: 'Esta solicitação já foi decidida.' },
    ]);
    inbox.answers.PENDING = [
      changeRequest({ id: 'cr-1' }),
      changeRequest({ id: 'cr-2', label: 'Suco de laranja' }),
    ];
    const onDecided = vi.fn();
    const Screen = screenOver(inbox.transport);
    render(<Screen onDecided={onDecided} />);
    await waitFor(() => expect(screen.getByTestId('approval-approve-cr-1')).toBeTruthy());

    fireEvent.click(screen.getByTestId('approval-approve-cr-1'));
    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(screen.getByTestId('approval-reject-cr-2')).toBeTruthy());
    fireEvent.click(screen.getByTestId('approval-reject-cr-2'));
    fireEvent.click(await screen.findByTestId('approval-reject-confirm'));
    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(2));

    await waitFor(() => expect(screen.getByTestId('approval-approve-cr-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('approval-approve-cr-1'));
    await waitFor(() => expect(screen.getByTestId('approvals-error')).toBeTruthy());
    expect(onDecided).toHaveBeenCalledTimes(2);
    expect(inbox.sends).toEqual([
      `${API_BASE}/approvals/cr-1/approve`,
      `${API_BASE}/approvals/cr-2/reject`,
      `${API_BASE}/approvals/cr-1/approve`,
    ]);
  });

  it('absorbs a throwing or rejecting hook: the decision stands, the list re-reads', async () => {
    // Plain functions, not `vi.fn`: the spy would attach its own handler to a
    // returned promise and hide the unhandled rejection this case catches
    // (vitest fails the run on one).
    const heard: string[] = [];
    const hooks = [
      () => {
        heard.push('sync');
        throw new Error('badge down');
      },
      async () => {
        heard.push('async');
        throw new Error('badge down');
      },
    ];
    for (const hook of hooks) {
      const inbox = inboxTransport();
      inbox.answers.PENDING = [changeRequest({ id: 'cr-1' })];
      const Screen = screenOver(inbox.transport);
      const { unmount } = render(<Screen onDecided={hook} />);
      await waitFor(() => expect(screen.getByTestId('approval-approve-cr-1')).toBeTruthy());

      fireEvent.click(screen.getByTestId('approval-approve-cr-1'));
      await waitFor(() => expect(inbox.reads).toHaveLength(2));
      await waitFor(() => expect(screen.getByTestId('approval-request-cr-1')).toBeTruthy());
      await waitFor(() => expect(screen.queryByTestId('approvals-error')).toBeNull());
      unmount();
    }
    expect(heard).toEqual(['sync', 'async']);
  });
});
