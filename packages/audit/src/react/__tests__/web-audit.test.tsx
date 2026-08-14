/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-test-isolation --
   nothing here touches the filesystem: the rule fires on `path.includes(...)`
   inside the recording transport, where `path` is a URL string. And `paths` is a
   const array created inside each case's own transport — the isolation heuristic
   reads the name as shared. */
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AuditLogPageWire, AuditLogWire } from '../../core/types';
import { defineAuditVocabulary } from '../../core/vocabulary';
import { createWebAudit } from '../create-web-audit';
import type { AuditTransport } from '../transport';
import { AuditRequestError } from '../transport';

/**
 * The viewer, driven the way a host mounts it: ONE call to
 * `createWebAudit({ apiBase, vocabulary })`, no screen imported by name.
 *
 * The transport is substituted rather than `globalThis.fetch` stubbed, which is
 * the package's own seam — so what these cases assert is the URL the surface
 * actually builds and the row it renders from the body it actually receives.
 *
 * The vocabulary is a fixture in a domain this package was not extracted from,
 * and it is REQUIRED now: there is no default to fall back to, which is the
 * whole point of this release. A host's actions, its resources and its words
 * arrive together or the surface refuses to assemble.
 */
const VOCABULARY = defineAuditVocabulary({
  actions: {
    'lamp.extinguish': { label: 'Lamp extinguished' },
    'supply.deliver': { label: 'Supply run delivered' },
  },
  resources: {
    lamp: { label: 'Lamp', fields: ['state', 'lumens'] },
    supply: { label: 'Supply run', fields: ['crates'] },
  },
});
const entry = (overrides: Partial<AuditLogWire> = {}): AuditLogWire => ({
  id: 'a1',
  createdAt: '2026-08-01T15:04:00.000Z',
  actorUserId: 'u-real',
  actorName: 'Ada Keeper',
  actorRole: 'OWNER',
  scope: 'client-1',
  onBehalfOfUserId: null,
  onBehalfOfName: null,
  action: 'lamp.extinguish',
  resourceType: 'lamp',
  resourceId: 'lamp-1',
  before: { state: 'LIT' },
  after: { state: 'DARK' },
  requestId: null,
  ...overrides,
});

const pageOf = (entries: AuditLogWire[], total = entries.length): AuditLogPageWire => ({
  data: entries,
  pagination: {
    total,
    page: 1,
    pageSize: 20,
    pageCount: Math.max(1, Math.ceil(total / 20)),
    hasNextPage: total > 20,
  },
});

interface Harness {
  paths: string[];
  transport: AuditTransport;
}

/** A transport that records every path and answers from the given handlers. */
function harness(options: {
  entries?: AuditLogWire[];
  actors?: { id: string; label: string }[];
  listError?: AuditRequestError;
} = {}): Harness {
  const paths: string[] = [];
  const transport: AuditTransport = {
    get<T>(path: string): Promise<T> {
      paths.push(path);
      if (path.includes('/actors')) {
        return Promise.resolve({ data: options.actors ?? [] } as T);
      }
      if (options.listError) return Promise.reject(options.listError);
      return Promise.resolve(pageOf(options.entries ?? [entry()]) as T);
    },
  };
  return { paths, transport };
}

const mount = (h: Harness, config: Record<string, unknown> = {}) => {
  const { page: Page } = createWebAudit({
    apiBase: '/api/admin/beacon-authority',
    vocabulary: VOCABULARY,
    transport: h.transport,
    ...config,
  });
  return render(<Page />);
};

/** Mount against a bare transport, for the cases that build their own. */
function mountWith(transport: AuditTransport, apiBase = '/api/admin/beacon-authority') {
  const { page: Page } = createWebAudit({ apiBase, vocabulary: VOCABULARY, transport });
  return render(<Page />);
}

describe('the trail', () => {
  it('renders an entry with its labelled action, resource and diff', async () => {
    const h = harness();

    mount(h);

    await waitFor(() => expect(screen.getByTestId('audit-log-grid')).toBeDefined());
    const row = screen.getByTestId('audit-log-row-a1');
    // The labels come from the VOCABULARY the backend half validates against, so
    // an action that exists is an action this screen can name.
    expect(row.textContent).toContain('Lamp extinguished');
    expect(row.textContent).toContain('Lamp');
    expect(row.textContent).toContain('state: LIT → DARK');
    // "Who · under which role".
    expect(screen.getByTestId('audit-log-actor-a1').textContent).toBe('Ada Keeper · OWNER');
  });

  it('renders the impersonation PAIR, naming both people', async () => {
    // The regression that motivated the viewer this was ported from: its API
    // carried `onBehalfOfName` and the screen dropped it, so a support session
    // looked exactly like the account owner working alone.
    const h = harness({
      entries: [
        entry({
          actorName: 'Ivy Relief',
          actorRole: 'SUPERADMIN',
          onBehalfOfUserId: 'u-target',
          onBehalfOfName: 'Ada Keeper',
        }),
      ],
    });

    mount(h);

    await waitFor(() => expect(screen.getByTestId('audit-log-actor-a1')).toBeDefined());
    expect(screen.getByTestId('audit-log-actor-a1').textContent).toBe('Ivy Relief · SUPERADMIN');
    expect(screen.getByTestId('audit-log-on-behalf-of-a1').textContent).toBe(
      'Ivy Relief on behalf of Ada Keeper',
    );
  });

  it('never invents an actor for a system entry', async () => {
    const h = harness({
      entries: [entry({ actorUserId: null, actorName: null, actorRole: null })],
    });

    mount(h);

    await waitFor(() => expect(screen.getByTestId('audit-log-actor-a1')).toBeDefined());
    expect(screen.getByTestId('audit-log-actor-a1').textContent).toBe('System');
  });

  it('labels an id the directory could not resolve, on both halves of the pair', async () => {
    const h = harness({
      entries: [
        entry({ actorName: null, actorRole: null, onBehalfOfUserId: 'u-gone', onBehalfOfName: null }),
      ],
    });

    mount(h);

    await waitFor(() => expect(screen.getByTestId('audit-log-actor-a1')).toBeDefined());
    expect(screen.getByTestId('audit-log-actor-a1').textContent).toBe('Deleted user');
    expect(screen.getByTestId('audit-log-on-behalf-of-a1').textContent).toBe(
      'Deleted user on behalf of Deleted user',
    );
  });

  it('shows the empty state for a page with no entries', async () => {
    const h = harness({ entries: [] });

    mount(h);

    await waitFor(() => expect(screen.getByTestId('audit-log-empty')).toBeDefined());
  });

  it('surfaces the server message on a denial, with a retry', async () => {
    const h = harness({ listError: new AuditRequestError(403, 'Você não tem permissão.') });

    mount(h);

    await waitFor(() => expect(screen.getByTestId('audit-log-error')).toBeDefined());
    expect(screen.getByTestId('audit-log-error').textContent).toContain(
      'Você não tem permissão.',
    );
    const before = h.paths.length;
    fireEvent.click(screen.getByTestId('audit-log-retry'));
    await waitFor(() => expect(h.paths.length).toBeGreaterThan(before));
  });
});

describe('the filters', () => {
  it('asks the backend for the resource-id keyword on Enter', async () => {
    const h = harness();

    mount(h);

    await waitFor(() => expect(screen.getByTestId('audit-log-grid')).toBeDefined());
    const search = screen.getByTestId('audit-log-search');
    fireEvent.change(search, { target: { value: 'order-1' } });
    fireEvent.keyDown(search, { key: 'Enter' });

    await waitFor(() =>
      expect(h.paths.some((path) => path.includes('q=order-1'))).toBe(true),
    );
  });

  it('turns an action pill into the action_in filter, and toggles it off again', async () => {
    const h = harness();

    mount(h);

    await waitFor(() => expect(screen.getByTestId('audit-log-grid')).toBeDefined());
    fireEvent.click(screen.getByTestId('audit-log-action-lamp.extinguish'));
    await waitFor(() =>
      expect(h.paths.some((path) => path.includes('action_in=lamp.extinguish'))).toBe(true),
    );

    const before = h.paths.length;
    fireEvent.click(screen.getByTestId('audit-log-action-lamp.extinguish'));
    await waitFor(() => expect(h.paths.length).toBeGreaterThan(before));
    expect(h.paths[h.paths.length - 1]).not.toContain('action_in');
  });

  it('sends the resource pill and the day bounds', async () => {
    const h = harness();

    mount(h);

    await waitFor(() => expect(screen.getByTestId('audit-log-grid')).toBeDefined());
    fireEvent.click(screen.getByTestId('audit-log-resource-lamp'));
    fireEvent.change(screen.getByTestId('audit-log-from'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByTestId('audit-log-to'), { target: { value: '2026-07-31' } });

    await waitFor(() => {
      const last = h.paths[h.paths.length - 1] ?? '';
      expect(last).toContain('resourceType_in=lamp');
      expect(last).toContain('from=2026-07-01');
      expect(last).toContain('to=2026-07-31');
    });
  });

  it('offers the roster when the host wired one, and filters by the chosen actor', async () => {
    const h = harness({ actors: [{ id: 'u-real', label: 'Ada Keeper' }] });

    mount(h);

    await waitFor(() => expect(screen.getByTestId('audit-log-actor-select')).toBeDefined());
    fireEvent.change(screen.getByTestId('audit-log-actor-select'), {
      target: { value: 'u-real' },
    });

    await waitFor(() =>
      expect(h.paths.some((path) => path.includes('actorUserId=u-real'))).toBe(true),
    );
  });

  it('falls back to a free-text actor id when there is no roster', async () => {
    // A host with no directory answers an empty option list; the filter degrades
    // rather than disappearing, because an operator pasting an id out of another
    // system is exactly who still needs it.
    const h = harness();

    mount(h);

    // Both inside the same waitFor: the picker's shape settles when the (empty)
    // options answer arrives, so asserting the absence separately would read the
    // DOM before that resolved.
    await waitFor(() => {
      expect(screen.getByTestId('audit-log-actor-id')).toBeDefined();
      expect(screen.queryByTestId('audit-log-actor-select')).toBeNull();
    });
  });

  it('clears every filter at once', async () => {
    const h = harness();

    mount(h);

    await waitFor(() => expect(screen.getByTestId('audit-log-grid')).toBeDefined());
    fireEvent.click(screen.getByTestId('audit-log-action-lamp.extinguish'));
    await waitFor(() =>
      expect(h.paths.some((path) => path.includes('action_in'))).toBe(true),
    );
    fireEvent.click(screen.getByTestId('audit-log-clear'));

    await waitFor(() =>
      expect(h.paths[h.paths.length - 1]).toBe('/api/admin/beacon-authority/audit-logs'),
    );
  });

  it('keeps a host fixedFilters pin on every request', async () => {
    // The embedded-trail case: one order's history inside its detail page.
    const h = harness();

    mount(h, { fixedFilters: { resourceId: 'order-1' } });

    await waitFor(() => expect(screen.getByTestId('audit-log-grid')).toBeDefined());
    fireEvent.click(screen.getByTestId('audit-log-action-lamp.extinguish'));

    await waitFor(() => {
      const last = h.paths[h.paths.length - 1] ?? '';
      expect(last).toContain('resourceId=order-1');
      expect(last).toContain('action_in=lamp.extinguish');
    });
  });

  it('returns to page 1 whenever a filter changes', async () => {
    // Keeping page 5 while narrowing to three results shows an empty list that
    // looks exactly like a broken filter.
    const h = harness({ entries: [entry()], actors: [] });

    const { paths } = h;
    mount(h);
    await waitFor(() => expect(screen.getByTestId('audit-log-grid')).toBeDefined());
    fireEvent.click(screen.getByTestId('audit-log-action-lamp.extinguish'));

    await waitFor(() => expect(paths[paths.length - 1]).toContain('action_in'));
    expect(paths[paths.length - 1]).not.toContain('page=');
  });
});

describe('the request the surface builds', () => {
  it('asks the mount it was given, for both endpoints', async () => {
    const h = harness();

    mount(h);

    await waitFor(() => expect(h.paths).toHaveLength(2));
    expect(h.paths.sort()).toEqual([
      '/api/admin/beacon-authority/audit-logs',
      '/api/admin/beacon-authority/audit-logs/actors',
    ]);
  });

  it('survives an actor-options failure without losing the trail', async () => {
    // The options are an affordance, not the data.
    const paths: string[] = [];
    const transport: AuditTransport = {
      get<T>(path: string): Promise<T> {
        paths.push(path);
        if (path.includes('/actors')) return Promise.reject(new Error('boom'));
        return Promise.resolve(pageOf([entry()]) as T);
      },
    };

    mountWith(transport);

    await waitFor(() => expect(screen.getByTestId('audit-log-grid')).toBeDefined());
    expect(screen.getByTestId('audit-log-actor-id')).toBeDefined();
  });

  it('takes a SECOND host vocabulary and labels rows from that one instead', async () => {
    // Two vocabularies in one process: the surface renders whichever it was
    // handed, and knows nothing that is not in it.
    const h = harness({
      entries: [entry({ action: 'ticket.refund', resourceType: 'ticket' })],
    });

    mount(h, {
      vocabulary: defineAuditVocabulary({
        actions: { 'ticket.refund': { label: 'Ticket refunded' } },
        resources: { ticket: { label: 'Ticket', fields: ['total'] } },
      }),
      labels: { title: 'Ledger history' },
    });

    await waitFor(() => expect(screen.getByTestId('audit-log-grid')).toBeDefined());
    expect(screen.getByTestId('audit-log-row-a1').textContent).toContain('Ticket refunded');
    expect(screen.getByText('Ledger history')).toBeDefined();
  });

  it('formats the stamp with the host formatter', async () => {
    const h = harness();

    mount(h, { formatDate: (iso: string) => `at ${iso}` });

    await waitFor(() => expect(screen.getByTestId('audit-log-row-a1')).toBeDefined());
    expect(screen.getByTestId('audit-log-row-a1').textContent).toContain(
      'at 2026-08-01T15:04:00.000Z',
    );
  });
});

describe('the paginated footer', () => {
  it('walks pages and reports where it is', async () => {
    const paths: string[] = [];
    const transport: AuditTransport = {
      get<T>(path: string): Promise<T> {
        paths.push(path);
        if (path.includes('/actors')) return Promise.resolve({ data: [] } as T);
        return Promise.resolve({
          data: [entry()],
          pagination: {
            total: 45,
            page: path.includes('page=2') ? 2 : 1,
            pageSize: 20,
            pageCount: 3,
            hasNextPage: true,
          },
        } as T);
      },
    };

    mountWith(transport, '/api/admin/loja');

    await waitFor(() => expect(screen.getByTestId('audit-log-page-status')).toBeDefined());
    expect(screen.getByTestId('audit-log-page-status').textContent).toBe(
      'Page 1 of 3 · 45 entries',
    );
    fireEvent.click(screen.getByTestId('audit-log-next'));
    await waitFor(() => expect(paths.some((path) => path.includes('page=2'))).toBe(true));
    // Vitest keeps the mock ordering, so the second page's status proves the state
    // came from the SERVER's answer rather than from a local counter.
    await waitFor(() =>
      expect(screen.getByTestId('audit-log-page-status').textContent).toBe(
        'Page 2 of 3 · 45 entries',
      ),
    );
  });
});
