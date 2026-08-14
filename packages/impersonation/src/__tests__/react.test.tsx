// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImpersonationBannerState } from '../core/types';
import { createWebImpersonation } from '../react/create-web-impersonation';
import { formatRemaining, remainingMs } from '../react/countdown';
import type { ImpersonationLabels } from '../react/labels';
import { notifyImpersonationChanged } from '../react/state';
import { ImpersonationHttpError, type ImpersonationTransport } from '../react/transport';

/**
 * The browser half.
 *
 * Every label below belongs to the same imaginary library the portability suite
 * uses, for the same reason: a suite asserting one product's sentences would put
 * that product's voice back into the package by the back door.
 */

const LABELS: ImpersonationLabels = {
  banner: {
    regionLabel: 'Desk session',
    actingAs: ({ subject, tenant }) =>
      tenant ? `At the desk as ${subject} (${tenant})` : `At the desk as ${subject}`,
    previewingRole: ({ role }) => `Looking as a ${role}`,
    previewingMember: ({ subject }) => `Looking as ${subject}`,
    unknownSubject: 'someone',
    readOnly: 'Look only',
    remaining: ({ formatted }) => `Closes in ${formatted}`,
    expired: 'The desk session has closed',
    timeUp: 'Time is up',
    unconfirmed: 'Could not confirm the desk session',
    exitFailed: 'Could not close it. Try again.',
    exit: 'Close the desk session',
  },
};

const BRANCH = { id: 'branch-north', slug: 'north', name: 'North Branch' };

/**
 * A fixed clock.
 *
 * The countdown derives everything from `expiresAt` and the clock, so a suite
 * that seeded a window off the wall clock would be asserting against a moving
 * target. `shouldAdvanceTime` keeps `waitFor` working while the system time
 * stays pinned.
 */
const NOW = Date.parse('2026-05-01T12:00:00.000Z');

function liveOperator(overrides: Partial<ImpersonationBannerState> = {}) {
  return {
    data: {
      active: true,
      kind: 'operator',
      readOnly: true,
      expiresAt: new Date(NOW + 90_000).toISOString(),
      previewRoleName: null,
      subject: { id: 'borrower', email: 'borrower@library.test', name: 'Ada' },
      tenant: BRANCH,
      ...overrides,
    },
  };
}

/** A transport whose answers a test scripts, recording what it was asked. */
function scriptedTransport(): {
  transport: ImpersonationTransport;
  calls: { path: string; method: string }[];
  answer: { get: unknown; failGet: boolean; failDelete: boolean };
} {
  const calls: { path: string; method: string }[] = [];
  const answer = { get: { data: { active: false } } as unknown, failGet: false, failDelete: false };
  return {
    calls,
    answer,
    transport: {
      async request(path, init) {
        const method = init?.method ?? 'GET';
        calls.push({ path, method });
        if (method === 'GET') {
          if (answer.failGet) throw new Error('offline');
          return answer.get;
        }
        if (method === 'DELETE' && answer.failDelete) {
          throw new ImpersonationHttpError(500, null);
        }
        return { data: { ended: true } };
      },
    },
  };
}

function mount(transport: ImpersonationTransport, onEnd?: () => void) {
  return createWebImpersonation({
    platformPath: '/desk/session',
    tenantPath: (slug) => `/branches/${slug}/desk/session`,
    transport,
    labels: LABELS,
    onEnd,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the countdown is derived, never decremented', () => {
  it('clamps at zero and survives an unparseable timestamp', () => {
    expect(remainingMs('2026-05-01T12:01:00.000Z', NOW)).toBe(60_000);
    expect(remainingMs('2026-05-01T11:59:00.000Z', NOW)).toBe(0);
    expect(remainingMs('not a date', NOW)).toBe(0);
  });

  it('rounds UP, so a session still authorizing never reads as over', () => {
    expect(formatRemaining(400)).toBe('0:01');
    expect(formatRemaining(59_400)).toBe('1:00');
    expect(formatRemaining(3_600_000)).toBe('1:00:00');
  });
});

describe('the banner', () => {
  it('renders nothing at all when nobody is wearing anybody', async () => {
    const { transport } = scriptedTransport();
    const { banner: Banner } = mount(transport);
    render(<Banner />);
    await waitFor(() => expect(screen.queryByTestId('impersonation-banner')).toBeNull());
  });

  it('names the person, the tenant and the countdown in the host\'s own words', async () => {
    const scripted = scriptedTransport();
    scripted.answer.get = liveOperator();
    const { banner: Banner } = mount(scripted.transport);
    render(<Banner />);

    await waitFor(() =>
      expect(screen.getByTestId('impersonation-banner-title').textContent).toBe(
        'At the desk as Ada (North Branch)',
      ),
    );
    expect(screen.getByTestId('impersonation-banner-readonly').textContent).toBe('Look only');
    expect(screen.getByTestId('impersonation-banner-remaining').textContent).toMatch(
      /^Closes in \d+:\d{2}$/,
    );
    expect(screen.getByTestId('impersonation-banner').dataset.impersonationKind).toBe(
      'operator',
    );
  });

  it('states the tenant separately for a preview, whose headline does not name it', async () => {
    const scripted = scriptedTransport();
    scripted.answer.get = liveOperator({
      kind: 'preview',
      readOnly: false,
      previewRoleName: 'PAGE',
    });
    const { banner: Banner } = mount(scripted.transport);
    render(<Banner />);

    await waitFor(() =>
      expect(screen.getByTestId('impersonation-banner-title').textContent).toBe(
        'Looking as a PAGE',
      ),
    );
    expect(screen.getByTestId('impersonation-banner-tenant').textContent).toBe('North Branch');
    // A role preview substitutes nobody, so it may write — and must not claim
    // otherwise.
    await waitFor(() =>
      expect(screen.queryByTestId('impersonation-banner-readonly')).toBeNull(),
    );
  });

  it('treats an unparseable answer as NO session rather than a half-drawn bar', async () => {
    const scripted = scriptedTransport();
    scripted.answer.get = { data: { active: true, kind: 'operator' } };
    const { banner: Banner } = mount(scripted.transport);
    render(<Banner />);
    await waitFor(() => expect(screen.queryByTestId('impersonation-banner')).toBeNull());
  });

  it('A FAILED READ NEVER CLEARS A KNOWN SESSION — it says it could not confirm', async () => {
    const scripted = scriptedTransport();
    scripted.answer.get = liveOperator();
    const { banner: Banner } = mount(scripted.transport);
    render(<Banner />);
    await waitFor(() => expect(screen.getByTestId('impersonation-banner')).toBeTruthy());

    scripted.answer.failGet = true;
    await act(async () => {
      notifyImpersonationChanged();
    });

    await waitFor(() =>
      expect(screen.getByTestId('impersonation-banner-unconfirmed').textContent).toBe(
        'Could not confirm the desk session',
      ),
    );
    // Still standing. That is the whole point.
    expect(screen.getByTestId('impersonation-banner')).toBeTruthy();
  });

  it('only a SUCCESSFUL read saying "no session" takes it down', async () => {
    const scripted = scriptedTransport();
    scripted.answer.get = liveOperator();
    const { banner: Banner } = mount(scripted.transport);
    render(<Banner />);
    await waitFor(() => expect(screen.getByTestId('impersonation-banner')).toBeTruthy());

    scripted.answer.get = { data: { active: false } };
    await act(async () => {
      notifyImpersonationChanged();
    });
    await waitFor(() => expect(screen.queryByTestId('impersonation-banner')).toBeNull());
  });
});

describe('leaving', () => {
  it('exits a PREVIEW through the tenant mount, so the entry is tenant-scoped', async () => {
    const scripted = scriptedTransport();
    scripted.answer.get = liveOperator({ kind: 'preview', previewRoleName: 'PAGE' });
    const onEnd = vi.fn();
    const { banner: Banner } = mount(scripted.transport, onEnd);
    render(<Banner />);
    await waitFor(() => expect(screen.getByTestId('impersonation-banner-exit')).toBeTruthy());

    scripted.answer.get = { data: { active: false } };
    await act(async () => {
      fireEvent.click(screen.getByTestId('impersonation-banner-exit'));
    });

    await waitFor(() =>
      expect(scripted.calls).toContainEqual({
        path: '/branches/north/desk/session',
        method: 'DELETE',
      }),
    );
    await waitFor(() => expect(onEnd).toHaveBeenCalled());
  });

  it('exits an OPERATOR session through the platform mount', async () => {
    const scripted = scriptedTransport();
    scripted.answer.get = liveOperator();
    const { banner: Banner } = mount(scripted.transport);
    render(<Banner />);
    await waitFor(() => expect(screen.getByTestId('impersonation-banner-exit')).toBeTruthy());

    scripted.answer.get = { data: { active: false } };
    await act(async () => {
      fireEvent.click(screen.getByTestId('impersonation-banner-exit'));
    });

    await waitFor(() =>
      expect(scripted.calls).toContainEqual({ path: '/desk/session', method: 'DELETE' }),
    );
  });

  it('leaves everything standing when the exit fails, and says so', async () => {
    const scripted = scriptedTransport();
    scripted.answer.get = liveOperator();
    scripted.answer.failDelete = true;
    const onEnd = vi.fn();
    const { banner: Banner } = mount(scripted.transport, onEnd);
    render(<Banner />);
    await waitFor(() => expect(screen.getByTestId('impersonation-banner-exit')).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByTestId('impersonation-banner-exit'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('impersonation-banner-error').textContent).toBe(
        'Could not close it. Try again.',
      ),
    );
    // Nothing is half-done: the bar is up, and the host's cache was not dropped.
    expect(screen.getByTestId('impersonation-banner')).toBeTruthy();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('restores the actor\'s own view however the session ended, not only on the button', async () => {
    const scripted = scriptedTransport();
    scripted.answer.get = liveOperator();
    const onEnd = vi.fn();
    const { banner: Banner } = mount(scripted.transport, onEnd);
    render(<Banner />);
    await waitFor(() => expect(screen.getByTestId('impersonation-banner')).toBeTruthy());

    // Another tab ended it. Nothing local ran; only the observed transition sees
    // this.
    scripted.answer.get = { data: { active: false } };
    await act(async () => {
      notifyImpersonationChanged();
    });
    await waitFor(() => expect(onEnd).toHaveBeenCalledOnce());
  });
});

describe('an expired session', () => {
  it('says the time is up and drops the dead cookie', async () => {
    const scripted = scriptedTransport();
    scripted.answer.get = {
      data: { ...liveOperator().data, expiresAt: new Date(NOW - 1000).toISOString() },
    };
    const { banner: Banner } = mount(scripted.transport);
    render(<Banner />);

    await waitFor(() =>
      expect(screen.getByTestId('impersonation-banner-title').textContent).toBe(
        'The desk session has closed',
      ),
    );
    expect(screen.getByTestId('impersonation-banner-remaining').textContent).toBe('Time is up');
    await waitFor(() =>
      expect(scripted.calls.some((call) => call.method === 'DELETE')).toBe(true),
    );
  });
});

describe('the dialog is optional', () => {
  it('is null for an app that only ever WEARS sessions', () => {
    const { transport } = scriptedTransport();
    expect(mount(transport).dialog).toBeNull();
  });
});
