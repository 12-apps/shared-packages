/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-test-isolation --
   nothing here touches the filesystem: the rule fires on `path.includes(...)`
   inside the recording transport, where `path` is a URL string. And `paths` is a
   const array created inside each case's own transport — the isolation heuristic
   reads the name as shared. */
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { DataViewsCopyProvider } from '@12-apps/ui/data-display/DataViews';
import { EN_US_DATA_VIEWS_COPY } from '@12-apps/ui/en-US';

import type { AuditLogPageWire, AuditLogWire } from '../../core/types';
import { defineAuditVocabulary } from '../../core/vocabulary';
import { createWebAudit } from '../create-web-audit';
import type { AuditTransport } from '../transport';
import { AuditRequestError } from '../transport';

/**
 * The screen, driven the way a host mounts it: ONE call to
 * `createWebAudit({ apiBase, vocabulary })`, no component imported by name.
 *
 * The transport is substituted rather than `globalThis.fetch` stubbed, which is
 * the package's own seam — so what these cases assert is the URL the surface
 * actually builds and the row it renders from the body it actually receives.
 *
 * The vocabulary is a fixture in a domain this package was not extracted from,
 * and it is REQUIRED: there is no default to fall back to. A host's actions, its
 * resources and its words arrive together or the surface refuses to assemble.
 *
 * The grid's OWN chrome is host copy too, which is why every mount here is
 * wrapped: `useDataViewsCopy` throws outside a provider rather than falling back
 * to some package's Portuguese, and a host mounting the trail beside its other
 * lists has already provided it once at its root.
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
function harness(
  options: {
    entries?: AuditLogWire[];
    actors?: { id: string; label: string }[];
    listError?: AuditRequestError;
  } = {},
): Harness {
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

/** The host's root provider, which every adopter mounts once. */
const Host = ({ children }: { children: ReactNode }): JSX.Element => (
  <DataViewsCopyProvider copy={EN_US_DATA_VIEWS_COPY}>{children}</DataViewsCopyProvider>
);

const mount = (h: Harness, config: Record<string, unknown> = {}) => {
  const { page: Page } = createWebAudit({
    apiBase: '/api/admin/beacon-authority',
    vocabulary: VOCABULARY,
    transport: h.transport,
    ...config,
  });
  return render(
    <Host>
      <Page />
    </Host>,
  );
};

/** Mount against a bare transport, for the cases that build their own. */
function mountWith(transport: AuditTransport, apiBase = '/api/admin/beacon-authority') {
  const { page: Page } = createWebAudit({ apiBase, vocabulary: VOCABULARY, transport });
  return render(
    <Host>
      <Page />
    </Host>,
  );
}

/** The last path the transport was asked for. */
const lastPath = (h: Harness): string => h.paths[h.paths.length - 1] ?? '';

/**
 * A wire day (`YYYY-MM-DD`) written in the order THIS field asks for.
 *
 * The mask and the placeholder are one string in `@12-apps/ui`, so reading the
 * order back off the element is reading the same source the parser uses — which
 * is what keeps this helper from ever disagreeing with the field, whichever
 * copy pack a host provides.
 */
function inMaskOrder(field: HTMLElement, iso: string): string {
  const mask = field.getAttribute('placeholder') ?? 'dd/mm/aaaa';
  const [year, month, day] = iso.split('-') as [string, string, string];
  const tokens = mask.split(/[^A-Za-z]+/).filter(Boolean);
  // A field announcing no order is one whose order nobody can know — including
  // this helper, which would otherwise type a string the mask rejects and let
  // the assertion below fail for the wrong reason.
  expect(tokens).toHaveLength(3);
  const separator = mask.replace(/[A-Za-z]/g, '').slice(0, 1) || '/';
  return tokens
    .map((token) => {
      const head = token.slice(0, 1).toLowerCase();
      if (head === 'y' || head === 'a') return year;
      return head === 'd' ? day : month;
    })
    .join(separator);
}

/**
 * The grid once it holds a ROW — not merely once its node exists.
 *
 * `audit-log-grid` is in the document for the whole load, loading state
 * included, so waiting on the node alone returns while every cell still reads
 * the copy pack's "Loading…". Whatever the case asserted next then sampled
 * that instead of its own subject, which is why two consecutive CI runs of this
 * file failed on two DIFFERENT tests: the race is in the wait, so its victim is
 * whichever case the scheduler happens to starve. Locally it never lost, which
 * is what kept it invisible until the lane grew heavier.
 *
 * A row rather than the absence of the loading sentence, because that sentence
 * belongs to `DataStateCopy` — a different pack from the `DataViewsCopy` this
 * file provides — so a test asserting on it would be reaching across a seam it
 * does not control, and would go quietly green the day the string moved. Every
 * caller below renders at least one entry; the empty and error cases wait on
 * `audit-log-empty-reason` and `audit-log-error` instead, and are left alone.
 */
async function settledGrid(): Promise<HTMLElement> {
  return waitFor(() => {
    const grid = screen.getByTestId('audit-log-grid');
    expect(within(grid).getAllByTestId(/^audit-log-actor-/u).length).toBeGreaterThan(0);
    return grid;
  });
}

/** Open a filter pill and tick one of its options by label. */
async function pickOption(fieldId: string, optionLabel: string): Promise<void> {
  fireEvent.click(screen.getByTestId(`audit-log-filter-${fieldId}`));
  // By ROLE, not by text: an option's label is the same word the column it
  // filters renders in every row, so a bare text query matches the menu item
  // and the table at once.
  fireEvent.click(await screen.findByRole('menuitem', { name: optionLabel }));
}

describe('the trail', () => {
  it('renders an entry with its labelled action, resource and diff', async () => {
    const h = harness();

    mount(h);

    await settledGrid();
    const grid = screen.getByTestId('audit-log-grid');
    // The labels come from the VOCABULARY the backend half validates against, so
    // an action that exists is an action this screen can name.
    expect(grid.textContent).toContain('Lamp extinguished');
    expect(grid.textContent).toContain('Lamp');
    expect(grid.textContent).toContain('state: LIT → DARK');
    // "Who · under which role".
    expect(screen.getByTestId('audit-log-actor-a1').textContent).toBe('Ada Keeper · OWNER');
  });

  it('renders the impersonation PAIR, naming both people', async () => {
    // The regression that motivated the viewer this was ported from: its API
    // carried `onBehalfOfName` and the screen dropped it, so a support session
    // looked exactly like the account owner working alone. The grid moved the
    // rows onto shared machinery; it must not have moved this off them.
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

    await waitFor(() =>
      expect(screen.getByTestId('audit-log-empty-reason').textContent).toBe(
        'No entries recorded for the chosen filters.',
      ),
    );
  });

  it('does not call an unread trail empty', async () => {
    // A read that FAILED is not an empty trail, and neither is one still in
    // flight. The grid has no rows in either case, so the sentence under it is
    // the only thing that distinguishes "nothing happened here" from "we do not
    // know yet" — and stating the first over the second is a claim nobody made.
    const h = harness({ listError: new AuditRequestError(403, 'Forbidden.') });

    mount(h);

    await waitFor(() => expect(screen.getByTestId('audit-log-error')).toBeDefined());
    expect(screen.getByTestId('audit-log-empty-reason').textContent).toBe(
      'Could not load the audit trail',
    );
  });

  it('surfaces the server message on a denial, with a retry', async () => {
    const h = harness({ listError: new AuditRequestError(403, 'Você não tem permissão.') });

    mount(h);

    await waitFor(() => expect(screen.getByTestId('audit-log-error')).toBeDefined());
    expect(screen.getByTestId('audit-log-error').textContent).toContain('Você não tem permissão.');
    const before = h.paths.length;
    fireEvent.click(screen.getByTestId('audit-log-retry'));
    await waitFor(() => expect(h.paths.length).toBeGreaterThan(before));
  });
});

describe('the filters', () => {
  it('asks the backend for the resource-id keyword', async () => {
    const h = harness();

    mount(h);

    await settledGrid();
    const box = screen.getByTestId('audit-log-search-all');
    fireEvent.change(box, { target: { value: 'order-1' } });
    // Enter, not the debounce. The box waits 350ms after the last keystroke
    // before it queries, and that timer is `@12-apps/ui`'s own behaviour, tested
    // where it lives (`data-views-export.test.tsx`). Sleeping it out here bought
    // no coverage this suite doesn't already have and made the case the second
    // slowest in the file — 508ms, of which 350 was a wall-clock wait. What THIS
    // surface owes an assertion is that a keyword becomes `q=` on the wire, and
    // Enter commits immediately, ahead of the timer, by the field's own contract.
    fireEvent.keyDown(box, { key: 'Enter' });

    await waitFor(() => expect(h.paths.some((path) => path.includes('q=order-1'))).toBe(true));
  });

  /**
   * Split from its `toggles it off again` twin, which is not cosmetic.
   *
   * As one case this was five sequential `waitFor` round trips over a full
   * DataViews grid render — the heaviest in the file at ~530ms, and the one
   * that died 748ms over vitest's 5s default in a repo-wide run where this
   * file took 34s against 3.9s alone. Two cases do the same work under two
   * budgets instead of one, which is the difference between fitting and not
   * on a loaded runner. They also fail separately now: "the pill never
   * applied" and "the pill never came off" were one red line before.
   */
  it('turns an action pill into the action_in filter', async () => {
    const h = harness();

    mount(h);

    await settledGrid();
    await pickOption('action', 'Lamp extinguished');

    await waitFor(() => expect(lastPath(h)).toContain('action_in=lamp.extinguish'));
  });

  it('toggles that same action pill back off', async () => {
    const h = harness();

    mount(h);

    await settledGrid();
    await pickOption('action', 'Lamp extinguished');
    await waitFor(() => expect(lastPath(h)).toContain('action_in=lamp.extinguish'));

    // The menu stays open on a multi-select, so the same item is the toggle.
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Lamp extinguished' }));

    await waitFor(() => expect(lastPath(h)).not.toContain('action_in'));
  });

  it('offers every action the vocabulary declares, not the ones the page happens to hold', async () => {
    // #924's property, at the surface where it was visible. A page of twenty
    // rows knows about the actions it happens to contain, which is precisely
    // the wrong list to filter a trail by — twelve actions were unselectable
    // when this screen built its options from what it could name.
    const h = harness({ entries: [entry()] });

    mount(h);

    await settledGrid();
    fireEvent.click(screen.getByTestId('audit-log-filter-action'));
    // `supply.deliver` appears in no loaded row.
    expect(await screen.findByRole('menuitem', { name: 'Supply run delivered' })).toBeDefined();
  });

  it('sends the resource pill', async () => {
    const h = harness();

    mount(h);

    await settledGrid();
    await pickOption('resourceType', 'Lamp');

    await waitFor(() => expect(lastPath(h)).toContain('resourceType_in=lamp'));
  });

  it('sends the period pill as the endpoint inclusive day bounds', async () => {
    const h = harness();

    mount(h);

    await settledGrid();
    fireEvent.click(screen.getByTestId('audit-log-range-period'));
    const panel = await screen.findByTestId('audit-log-range-period-panel');
    // The grid's day inputs are MASKED text fields, for the same reason this
    // package's retired ones were: a native date input renders in the
    // BROWSER's locale rather than the surface's, and cannot take a date typed
    // as one continuous run of digits.
    //
    // The order is read off each field's own PLACEHOLDER rather than written
    // here, and that is the whole point: this suite mounts the en-US pack,
    // whose mask is `mm/dd/yyyy`, so a hardcoded `01/07/2026` is the 7th of
    // January and not the 1st of July. Typing one order into a field asking
    // for the other is precisely the defect `@12-apps/ui`'s day input was
    // fixed for — and a case that hardcoded it would be asserting that bug
    // rather than the day bounds.
    const bounds = within(panel).getAllByRole('textbox');
    // Named before use: a panel that rendered one field (or none) would
    // otherwise fail inside the mask helper, reporting the placeholder rather
    // than the missing bound.
    expect(bounds).toHaveLength(2);
    const [from, to] = bounds as [HTMLElement, HTMLElement];
    fireEvent.change(from, { target: { value: inMaskOrder(from, '2026-07-01') } });
    fireEvent.change(to, { target: { value: inMaskOrder(to, '2026-07-31') } });

    await waitFor(() => {
      expect(lastPath(h)).toContain('from=2026-07-01');
      expect(lastPath(h)).toContain('to=2026-07-31');
    });
  });

  it('offers the roster when the host wired one, and filters by the chosen actor', async () => {
    const h = harness({ actors: [{ id: 'u-real', label: 'Ada Keeper' }] });

    mount(h);

    await waitFor(() => expect(screen.getByTestId('audit-log-filter-actorUserId')).toBeDefined());
    await pickOption('actorUserId', 'Ada Keeper');

    await waitFor(() => expect(lastPath(h)).toContain('actorUserId=u-real'));
  });

  it('does not offer an actor pill with nothing in it', async () => {
    // A host with no directory answers an empty option list. A pill whose menu
    // is empty reads as a broken filter rather than an absent one; an operator
    // pasting an id out of another system still matches through the search box,
    // which is what that field was always doing.
    const h = harness();

    mount(h);

    // Both inside the same waitFor: the bar's shape settles when the (empty)
    // options answer arrives, so asserting the absence separately would read
    // the DOM before that resolved.
    await waitFor(() => {
      expect(screen.getByTestId('audit-log-grid')).toBeDefined();
      expect(screen.queryByTestId('audit-log-filter-actorUserId')).toBeNull();
    });
  });

  it('keeps a host fixedFilters pin on every request', async () => {
    // The embedded-trail case: one order's history inside its detail page.
    const h = harness();

    mount(h, { fixedFilters: { resourceId: 'order-1' } });

    await settledGrid();
    await pickOption('action', 'Lamp extinguished');

    await waitFor(() => {
      expect(lastPath(h)).toContain('resourceId=order-1');
      expect(lastPath(h)).toContain('action_in=lamp.extinguish');
    });
  });

  it('returns to page 1 whenever a filter changes', async () => {
    // Keeping page 5 while narrowing to three results shows an empty list that
    // looks exactly like a broken filter. The rule is the GRID's now — it emits
    // page 1 on any effective-query change — which is why nothing in this
    // package re-decides it.
    const h = harness();

    mount(h);
    await settledGrid();
    await pickOption('action', 'Lamp extinguished');

    await waitFor(() => expect(lastPath(h)).toContain('action_in'));
    expect(lastPath(h)).not.toContain('page=');
  });
});

describe('the request the surface builds', () => {
  it('asks the mount it was given, for both endpoints', async () => {
    const h = harness();

    mount(h);

    await waitFor(() => expect(h.paths).toHaveLength(2));
    expect(h.paths.slice().sort()).toEqual([
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

    await settledGrid();
    expect(screen.getByTestId('audit-log-actor-a1')).toBeDefined();
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

    await settledGrid();
    expect(screen.getByTestId('audit-log-grid').textContent).toContain('Ticket refunded');
    expect(screen.getAllByText('Ledger history').length).toBeGreaterThan(0);
  });

  it('formats the stamp with the host formatter', async () => {
    const h = harness();

    mount(h, { formatDate: (iso: string) => `at ${iso}` });

    await settledGrid();
    expect(screen.getByTestId('audit-log-grid').textContent).toContain(
      'at 2026-08-01T15:04:00.000Z',
    );
  });
});

describe('the page frame', () => {
  it('titles the page and closes the breadcrumb with its own name', async () => {
    // The host names the path it owns; the last crumb is the page's own title,
    // so nobody restates it in a second place and lets the two drift.
    const h = harness();
    const { page: Page } = createWebAudit({
      apiBase: '/api/admin/beacon-authority',
      vocabulary: VOCABULARY,
      transport: h.transport,
    });

    render(
      <Host>
        <Page breadcrumb={[{ label: 'Home', href: '/home' }]} />
      </Host>,
    );

    await settledGrid();
    const crumbs = screen.getByTestId('audit-log-dashboard-breadcrumb');
    expect(crumbs.textContent).toContain('Home');
    expect(crumbs.textContent).toContain('Audit trail');
  });

  it('paginates on the grid own pager, from the server answer', async () => {
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

    await waitFor(() => expect(screen.getByTestId('audit-log-pagination')).toBeDefined());
    const pager = screen.getByTestId('audit-log-pagination');
    fireEvent.click(within(pager).getByRole('button', { name: /2/ }));

    await waitFor(() => expect(paths.some((path) => path.includes('page=2'))).toBe(true));
  });
});

/**
 * The reader's tag has to reach the labels through the SCREEN, not only through
 * the embedded viewer.
 *
 * `createWebAudit` binds two entry points over one config, and they reach the
 * label readers by different routes: `Viewer` is handed `locale` where it is
 * bound, while `page` carries it through `AuditScreen` on the way. The screen's
 * render of `<AuditViewer/>` omitted it, so every vocabulary label on the whole
 * page resolved as "nobody said" and answered in the host resolver's default —
 * correct-looking output, in the one language that proves nothing.
 *
 * Both cases below fail on the frozen behaviour and pass on the threaded one,
 * and they read the two places a label actually surfaces: a row, and a pill's
 * options. A vocabulary of plain strings is unaffected either way, which is
 * exactly why no existing case here noticed.
 */
describe('the vocabulary follows the reader', () => {
  /** The same two ids, named per language, the way a host's pack would. */
  const BILINGUAL = defineAuditVocabulary({
    actions: {
      'lamp.extinguish': {
        label: ({ locale }) => (locale === 'en-US' ? 'Lamp extinguished' : 'Lampião apagado'),
      },
      'supply.deliver': {
        label: ({ locale }) => (locale === 'en-US' ? 'Supply run delivered' : 'Entrega realizada'),
      },
    },
    resources: {
      lamp: {
        label: ({ locale }) => (locale === 'en-US' ? 'Lamp' : 'Lampião'),
        fields: ['state', 'lumens'],
      },
      supply: { label: 'Supply run', fields: ['crates'] },
    },
  });

  const mountBilingual = (h: Harness, locale?: string) => {
    const { page: Page } = createWebAudit({
      apiBase: '/api/admin/beacon-authority',
      vocabulary: BILINGUAL,
      transport: h.transport,
      ...(locale === undefined ? {} : { locale }),
    });
    return render(
      <Host>
        <Page />
      </Host>,
    );
  };

  it("names a row's action and resource in the reader's language", async () => {
    mountBilingual(harness(), 'en-US');

    await settledGrid();
    const grid = screen.getByTestId('audit-log-grid');
    expect(grid.textContent).toContain('Lamp extinguished');
    // The pt-BR name for the same id is absent rather than alongside it: the
    // resolver picked, it did not merge.
    expect(grid.textContent).not.toContain('Lampião apagado');
  });

  it('answers the other reader from the SAME surface', async () => {
    mountBilingual(harness(), 'pt-BR');

    await settledGrid();
    const grid = screen.getByTestId('audit-log-grid');
    expect(grid.textContent).toContain('Lampião apagado');
    expect(grid.textContent).not.toContain('Lamp extinguished');
  });
});
