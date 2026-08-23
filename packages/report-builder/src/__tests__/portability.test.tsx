// @vitest-environment jsdom
import { PT_BR_REPORT_ENGINE_COPY } from '../pt-BR';
import { PT_BR_REPORT_SERVER_MESSAGES, PT_BR_BLANK_BLOCK_TEMPLATE_COPY } from '../server/pt-BR';
import { PT_BR_REPORT_SCREENS_COPY } from '../react/pt-BR';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import { defineCatalog } from '../catalog';
import { createMemoryDataSource } from '../memory';
import { reportSpecSchema, type ReportSpecInput } from '../spec';
import { createWebReportBuilder } from '../react';
import type { ReportBuilderSurface } from '../react';
import { reportBuilderRouter } from '../hono';
import { createApiReportBuilder, systemReportParams } from '../server';
import type {
  ReportActor,
  ReportBuilderServerConfig,
  SavedReportDb,
  SystemReportDef,
} from '../server';

/**
 * PORTABILITY — the whole package mounted, both halves, by a host that shares
 * no word with the application it was extracted from.
 *
 * This suite exists because of how the same defect was missed twice. The
 * consumer harness and every fixture in this package spoke the origin host's
 * vocabulary — `orders`, `Pedidos`, `reports:sales:read`, `America/Sao_Paulo` —
 * so a value the package DEFAULTED and a value the host STATED produced
 * identical output, and the axis with surviving defaults was the axis nothing
 * varied. `@12-apps/rbac` shipped a portability test that never mounted the
 * server, and its server defaults survived the refactor untouched.
 *
 * So: a municipal library. It lends books, it charges fines, it keeps a
 * Portugal clock. Nothing it names appears anywhere in this package, which is
 * what makes {@link FOREIGN_WORDS} a real assertion rather than a spell-check —
 * every one of those words was, until this branch, hardcoded somewhere in the
 * files this suite exercises.
 */

/** The library's own permission ids. Not one of them is a host id of ours. */
const LENDING = 'library:lending:read';
const FINES = 'library:fines:read';
/** This package's own id, the one authoring is gated on by default. */
const AUTHOR = 'reports:manage';

/** Portugal, which unlike São Paulo still observes DST. */
const LISBON = 'Europe/Lisbon';

const TENANT = 'biblioteca-central';

const CATALOG = defineCatalog({
  entities: {
    loans: {
      label: 'Empréstimos',
      fields: {
        borrowedAt: { label: 'Data de empréstimo', type: 'date', role: 'dimension' },
        shelfCode: { label: 'Estante', type: 'string', role: 'dimension' },
        titleName: { label: 'Obra', type: 'string', role: 'dimension' },
        loanDays: { label: 'Dias emprestado', type: 'number', role: 'measure' },
      },
    },
    fines: {
      label: 'Multas',
      fields: {
        issuedAt: { label: 'Data da multa', type: 'date', role: 'dimension' },
        branchName: { label: 'Polo', type: 'string', role: 'dimension' },
        fineCents: { label: 'Valor da multa', type: 'money', role: 'measure' },
      },
    },
  },
});

/** The host's entity → permission map. Required; nothing defaults it. */
const ENTITY_PERMISSION = { loans: LENDING, fines: FINES };

const LOANS_BY_SHELF: ReportSpecInput = {
  entity: 'loans',
  dimensions: [{ field: 'shelfCode' }],
  measures: [{ field: 'loanDays' }],
  presentation: { kind: 'table' },
};

const FINES_BY_BRANCH: ReportSpecInput = {
  entity: 'fines',
  dimensions: [{ field: 'branchName' }],
  measures: [{ field: 'fineCents' }],
  presentation: { kind: 'table' },
};

const SYSTEM_REPORTS: SystemReportDef[] = [
  {
    key: 'emprestimos-por-estante',
    title: 'Empréstimos por estante',
    description: 'Dias de empréstimo acumulados em cada estante.',
    permission: LENDING,
    section: 'circulacao',
    supportsGrain: false,
    presentation: 'table',
    build: () => LOANS_BY_SHELF,
  },
  {
    key: 'multas-por-polo',
    title: 'Multas por polo',
    description: 'Quanto cada polo cobrou em multas.',
    permission: FINES,
    section: 'multas',
    supportsGrain: false,
    presentation: 'table',
    build: () => FINES_BY_BRANCH,
  },
];

const SURFACE: ReportBuilderSurface = {
  systemReports: SYSTEM_REPORTS.map((report) => ({
    key: report.key,
    title: report.title,
    description: report.description,
    permission: report.permission,
    section: report.section,
    supportsGrain: report.supportsGrain,
  })),
  systemDashboards: [
    {
      key: 'painel-da-circulacao',
      title: 'Painel da circulação',
      description: 'Como a biblioteca circulou no período.',
      permission: LENDING,
      section: 'circulacao',
      blocks: [{ reportKey: 'emprestimos-por-estante', span: 12 }],
    },
  ],
  sections: [
    { key: 'circulacao', label: 'Circulação', path: 'circulacao' },
    { key: 'multas', label: 'Multas', path: 'financeiro/multas' },
  ],
  blockTemplates: [],
  timeZone: LISBON,
};

const ROWS = {
  loans: [
    { borrowedAt: new Date('2026-07-14T10:00:00Z'), shelfCode: 'H-12', titleName: 'Os Maias', loanDays: 7 },
  ],
  fines: [{ issuedAt: new Date('2026-07-14T10:00:00Z'), branchName: 'Alvalade', fineCents: 250 }],
};

const SAVED_ROW = {
  id: 'rel-1',
  name: 'Circulação da semana',
  description: null,
  spec: reportSpecSchema.parse(LOANS_BY_SHELF),
  status: 'published',
  visibility: 'tenant',
  visibilityRoles: [],
  defaultRange: null,
  createdBy: 'bibliotecario-1',
  createdAt: new Date('2026-07-01T00:00:00Z'),
  updatedAt: new Date('2026-07-01T00:00:00Z'),
};

/** A saved-report store with one document in it, through the structural seam. */
function savedReportDb(): SavedReportDb {
  const rows = [SAVED_ROW];
  return {
    savedReport: {
      findMany: () => Promise.resolve(rows.slice()),
      findFirst: ({ where }: { where: { id?: string } }) =>
        Promise.resolve(rows.find((row) => row.id === where.id) ?? null),
      create: ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...SAVED_ROW, ...data, id: 'rel-2' }),
      updateMany: () => Promise.resolve({ count: 1 }),
      deleteMany: () => Promise.resolve({ count: 1 }),
    },
  } as unknown as SavedReportDb;
}

function config(overrides: Partial<ReportBuilderServerConfig> = {}): ReportBuilderServerConfig {
  return {
    catalog: CATALOG,
    adapter: () => createMemoryDataSource(ROWS, PT_BR_REPORT_ENGINE_COPY.labels.othersBucket),
    copy: PT_BR_REPORT_ENGINE_COPY,
    messages: PT_BR_REPORT_SERVER_MESSAGES,
    db: () => Promise.resolve(savedReportDb()),
    timeZone: LISBON,
    entityPermission: ENTITY_PERMISSION,
    systemReports: SYSTEM_REPORTS,
    starters: {
      loans: reportSpecSchema.parse(LOANS_BY_SHELF),
      fines: reportSpecSchema.parse(FINES_BY_BRANCH),
    },
    // 22:00 on 14 July in Lisbon — and 18:00 the same day in São Paulo, so the
    // two clocks agree on the DATE and disagree on the window, which is what
    // makes the range assertion below able to tell them apart.
    now: () => new Date('2026-07-14T21:00:00Z'),
    ...overrides,
  };
}

function actor(permissions: string[] = [LENDING, FINES, AUTHOR]): ReportActor {
  return {
    clientId: 'tenant-lisboa',
    userId: 'bibliotecario-1',
    roleIds: [],
    isAdmin: false,
    permissions,
  };
}

/** The REAL router, over real HTTP semantics, in process. */
function router(permissions?: string[]) {
  return reportBuilderRouter({ ...config(), resolveActor: () => actor(permissions) });
}

async function get(path: string, permissions?: string[]): Promise<{ status: number; body: unknown }> {
  const response = await router(permissions).request(`http://library.test${path}`);
  const text = await response.text();
  return { status: response.status, body: text === '' ? undefined : JSON.parse(text) };
}

/**
 * Every word this package used to hardcode, and must not utter for a host that
 * never said it. Each one is load-bearing: `orders` / `kitchen_ticket_items`
 * were catalog entities, `Pedidos` / `Estoque` / `Cozinha` were nav labels,
 * `reports:sales:read` was an entity permission and a preset tier,
 * `America/Sao_Paulo` was the compiler's fallback zone and the picker's, and
 * `vendas-resumo` was a preset key baked into the wire schema.
 */
const FOREIGN_WORDS = [
  'orders',
  'order_items',
  'stock_movements',
  'loss_events',
  'kitchen_ticket_items',
  'kitchen_shifts',
  'Pedidos',
  'Estoque',
  'Cozinha',
  'reports:sales:read',
  'reports:kitchen:read',
  'stock:read',
  'America/Sao_Paulo',
  'vendas-resumo',
  'formas-de-pagamento',
  'PIX',
];

/** Fails naming the word AND where it was found, so a hit is actionable. */
function expectNoForeignVocabulary(where: string, text: string): void {
  for (const word of FOREIGN_WORDS) {
    expect(`${where}: ${text.includes(word) ? `LEAKED "${word}"` : 'clean'}`).toBe(
      `${where}: clean`,
    );
  }
}

describe('the backend surface serves the HOST vocabulary and nothing else', () => {
  it('lists exactly the catalog it was given, with the host starters on it', async () => {
    const { status, body } = await get('/reports/fields');

    expect(status).toBe(200);
    const listing = (body as { data: { entities: Array<{ entity: string; starter?: unknown }> } })
      .data;
    expect(listing.entities.map((entity) => entity.entity).sort()).toEqual(['fines', 'loans']);
    expect(listing.entities.every((entity) => entity.starter !== undefined)).toBe(true);
    expectNoForeignVocabulary('/reports/fields', JSON.stringify(body));
  });

  it('narrows the catalog by the HOST permission each entity declares', async () => {
    const { body } = await get('/reports/fields', [FINES]);

    const listing = (body as { data: { entities: Array<{ entity: string }> } }).data;
    expect(listing.entities.map((entity) => entity.entity)).toEqual(['fines']);
  });

  it('serves the host built-ins, and nobody else’s', async () => {
    const { body } = await get('/reports/system');

    const reports = (body as { data: { reports: Array<{ key: string }> } }).data.reports;
    expect(reports.map((report) => report.key)).toEqual([
      'emprestimos-por-estante',
      'multas-por-polo',
    ]);
    expectNoForeignVocabulary('/reports/system', JSON.stringify(body));
  });

  it('narrows the built-ins by their own tier', async () => {
    const { body } = await get('/reports/system', [FINES]);

    const reports = (body as { data: { reports: Array<{ key: string }> } }).data.reports;
    expect(reports.map((report) => report.key)).toEqual(['multas-por-polo']);
  });

  it('runs a built-in on the HOST clock, not on the one this package shipped', async () => {
    const { status, body } = await get('/reports/system/emprestimos-por-estante?preset=today');

    expect(status).toBe(200);
    const range = (body as { data: { range: { from: string; toExclusive: string } } }).data.range;
    // 2026-07-14 is inside Lisbon's summer time (UTC+1), so "hoje" opens at
    // 23:00Z on the 13th. In São Paulo — the zone this package used to fall
    // back to — the same day opens at 03:00Z on the 14th, four hours later. The
    // window is the one assertion that cannot pass under both.
    expect(range.from).toBe('2026-07-13T23:00:00.000Z');
    expect(range.toExclusive).toBe('2026-07-14T23:00:00.000Z');
  });

  it('404s an unknown key rather than offering a key from another product', async () => {
    expect((await get('/reports/system/vendas-resumo')).status).toBe(404);
  });

  it('validates a HOST built-in key on the wire schema every registry imports', () => {
    // `systemReportParams.key` used to be `z.enum(SYSTEM_REPORT_KEYS)` — seven
    // preset keys of one product, baked into the schema every host's MCP
    // registry advertises and every handler validates with. For this library
    // that schema REJECTED its own reports and offered an agent a menu of
    // seven it does not have.
    expect(
      systemReportParams.safeParse({ tenantSlug: TENANT, key: 'multas-por-polo' }).success,
    ).toBe(true);
    expect(systemReportParams.safeParse({ tenantSlug: TENANT, key: '' }).success).toBe(false);
  });

  it('lists the tenant saved documents', async () => {
    const { status, body } = await get('/reports/custom');

    expect(status).toBe(200);
    expect(JSON.stringify(body)).toContain('Circulação da semana');
    expectNoForeignVocabulary('/reports/custom', JSON.stringify(body));
  });
});

describe('authoring rides this package’s own permission', () => {
  const body = {
    name: 'Multas do mês',
    spec: FINES_BY_BRANCH,
    status: 'published',
    visibility: 'tenant',
  };

  async function post(permissions: string[]): Promise<number> {
    const response = await router(permissions).request('http://library.test/reports/custom', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.status;
  }

  it('refuses an actor holding every DATA tier but not reports:manage', async () => {
    // The exact actor that used to be admitted by `canAuthor: true` — a boolean
    // each host computed for itself, most often from a hardcoded set of role
    // names, and therefore never grantable in the role editor.
    expect(await post([LENDING, FINES])).toBe(403);
  });

  it('admits the actor who holds it', async () => {
    expect(await post([LENDING, FINES, AUTHOR])).toBe(200);
  });

  it('honours a host that spells the permission its own way', async () => {
    const app = reportBuilderRouter({
      ...config(),
      gatePermissions: { manage: 'library:catalogue:curate' },
      resolveActor: () => actor([LENDING, FINES, 'library:catalogue:curate']),
    });

    const response = await app.request('http://library.test/reports/custom', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(200);
  });
});

describe('a wiring mistake is refused at assembly, not at request time', () => {
  it('refuses a catalog entity nobody stated a permission for', () => {
    expect(() =>
      createApiReportBuilder(config({ entityPermission: { loans: LENDING } })),
    ).toThrow(/entityPermission.*"fines"/s);
  });

  it('refuses an EMPTY entityPermission rather than reading it as a lockout', () => {
    expect(() => createApiReportBuilder(config({ entityPermission: {} }))).toThrow(
      /entityPermission` is empty/,
    );
  });

  it('refuses a zone this runtime cannot resolve', () => {
    expect(() => createApiReportBuilder(config({ timeZone: 'Mars/Olympus' }))).toThrow(/timeZone/);
  });

  it('refuses a built-in that does not compile against the catalog', () => {
    const broken: SystemReportDef = {
      ...(SYSTEM_REPORTS[0] as SystemReportDef),
      key: 'quebrado',
      build: () => ({
        entity: 'orders',
        measures: [{ field: 'revenueCents' }],
        presentation: { kind: 'table' },
      }),
    };

    expect(() => createApiReportBuilder(config({ systemReports: [broken] }))).toThrow(
      /does not compile/,
    );
  });

  it('refuses two built-ins sharing a key', () => {
    const twin = SYSTEM_REPORTS[0] as SystemReportDef;
    expect(() => createApiReportBuilder(config({ systemReports: [twin, twin] }))).toThrow(
      /share the key/,
    );
  });

  it('refuses a starter for an entity the catalog does not have', () => {
    expect(() =>
      createApiReportBuilder(
        config({ starters: { borrowers: reportSpecSchema.parse(LOANS_BY_SHELF) } }),
      ),
    ).toThrow(/starters/);
  });

  /**
   * Both entities are real, so the spec compiles and the mistake is invisible
   * at every later gate: `/reports/fields` serves the fines report as the
   * `loans` prefill, and the builder opens on the wrong collection.
   */
  it('refuses a starter filed under an entity that is not its own', () => {
    expect(() =>
      createApiReportBuilder(
        config({ starters: { loans: reportSpecSchema.parse(FINES_BY_BRANCH) } }),
      ),
    ).toThrow(/filed under "loans" is a spec for "fines"/);
  });

  it('accepts a host with NO built-ins at all', () => {
    expect(() => createApiReportBuilder(config({ systemReports: [] }))).not.toThrow();
  });

  /**
   * `starters` was the last field of the vocabulary that a host could leave
   * out — `?? {}` in three places — which is the exact construct this branch
   * exists to remove. `{}` is now something the host SAYS.
   */
  it('accepts a host with NO starters at all, and requires it to say so', () => {
    expect(() => createApiReportBuilder(config({ starters: {} }))).not.toThrow();

    const withoutStarters: Partial<ReportBuilderServerConfig> = config();
    delete withoutStarters.starters;
    expect(() =>
      createApiReportBuilder(withoutStarters as ReportBuilderServerConfig),
    ).toThrow(/`starters` is missing/);
  });
});

/**
 * The web half, driven against the SAME router: `createWebReportBuilder` renders
 * the screens, the screens fetch, and the fetch is answered by the real backend
 * surface over the library's catalog. Nothing between them is stubbed, which is
 * what makes a leak visible — a screen reading a constant instead of its config
 * would print a word the router never sent.
 */
describe('the web surface renders the HOST vocabulary', () => {
  beforeEach(() => {
    const app = router();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://library.test');
      // The host mounts the surface under its own prefix; the descriptors are
      // relative to it, so this strips exactly what a host's router matched.
      const path = url.pathname.replace(`/api/admin/${TENANT}`, '') + url.search;
      return app.request(`http://library.test${path}`, init);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  function mountAt(path: string): void {
    const transport = {
      get: async <T,>(url: string): Promise<T> =>
        ((await (await fetch(url)).json()) as { data: T }).data,
      getRaw: async <T,>(url: string): Promise<T> => (await (await fetch(url)).json()) as T,
      send: async <T,>(url: string, method: string, payload?: unknown) => {
        const response = await fetch(url, {
          method,
          headers: { 'content-type': 'application/json' },
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        });
        return response.ok
          ? { ok: true as const, value: (await response.json()) as T }
          : { ok: false as const, error: { message: 'falhou' } };
      },
    };
    const { page: Page } = createWebReportBuilder({
      tenantSlug: TENANT,
      surface: SURFACE,
      copy: {
      engine: PT_BR_REPORT_ENGINE_COPY,
      blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY,
      screens: PT_BR_REPORT_SCREENS_COPY,
    },
      transport: transport as never,
      standalone: true,
      initialPath: path,
    });
    render(<Page />);
  }

  it('opens a built-in on its own title and the host’s section back-link', async () => {
    mountAt(`/${TENANT}/reports/system/emprestimos-por-estante`);

    await waitFor(() => {
      expect(screen.getByTestId('system-report-title').textContent).toBe(
        'Empréstimos por estante',
      );
    });
    const back = screen.getByTestId('system-report-back');
    // The label and the href are both the host's, from `surface.sections`. They
    // used to come from a `{ orders: "Pedidos", inventory: "Estoque", kitchen:
    // "Cozinha" }` map plus the assumption that a section key IS a URL segment
    // — this host's fines area is at `financeiro/multas`, which no derivation
    // could have produced.
    expect(back.textContent).toContain('Circulação');
    expect(back.getAttribute('href')).toBe(`/${TENANT}/circulacao`);
    expectNoForeignVocabulary('built-in screen', document.body.innerHTML);
  });

  it('sends a built-in of another section back to THAT section’s path', async () => {
    mountAt(`/${TENANT}/reports/system/multas-por-polo`);

    await waitFor(() => {
      expect(screen.getByTestId('system-report-title').textContent).toBe('Multas por polo');
    });
    expect(screen.getByTestId('system-report-back').getAttribute('href')).toBe(
      `/${TENANT}/financeiro/multas`,
    );
  });

  it('renders the host dashboard from the blocks it declared', async () => {
    mountAt(`/${TENANT}/reports/system/dashboards/painel-da-circulacao`);

    await waitFor(() => {
      expect(screen.getByTestId('page-system-dashboard')).toBeTruthy();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('system-dashboard-block-emprestimos-por-estante'),
      ).toBeTruthy();
    });
    expectNoForeignVocabulary('dashboard screen', document.body.innerHTML);
  });

  it('lists the tenant saved reports with no foreign word on the page', async () => {
    mountAt(`/${TENANT}/reports`);

    await waitFor(() => {
      expect(screen.getByTestId('page-reports')).toBeTruthy();
    });
    await waitFor(() => {
      expect(document.body.textContent).toContain('Circulação da semana');
    });
    expectNoForeignVocabulary('reports list', document.body.innerHTML);
  });
});

describe('the web factory refuses an incoherent vocabulary', () => {
  it('refuses a built-in whose section nobody declared', () => {
    expect(() =>
      createWebReportBuilder({
        tenantSlug: TENANT,
        surface: { ...SURFACE, sections: [] },
        copy: {
      engine: PT_BR_REPORT_ENGINE_COPY,
      blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY,
      screens: PT_BR_REPORT_SCREENS_COPY,
    },
      }),
    ).toThrow(/section "circulacao"/);
  });

  it('refuses a dashboard block naming a report nobody declared', () => {
    expect(() =>
      createWebReportBuilder({
        tenantSlug: TENANT,
        copy: {
      engine: PT_BR_REPORT_ENGINE_COPY,
      blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY,
      screens: PT_BR_REPORT_SCREENS_COPY,
    },
        surface: {
          ...SURFACE,
          systemDashboards: [
            {
              key: 'orfao',
              title: 'Órfão',
              description: 'Um painel sem relatórios.',
              permission: LENDING,
              section: 'circulacao',
              blocks: [{ reportKey: 'nao-existe', span: 12 }],
            },
          ],
        },
      }),
    ).toThrow(/nao-existe/);
  });

  /**
   * The dashboard half of the section rule. Its blocks were checked and its own
   * `section` was not — yet `system-dashboard.tsx` builds its back-link from it
   * exactly as the built-in screen does, so an undeclared one renders a "Voltar"
   * to a page this host may not have.
   */
  it('refuses a dashboard whose section nobody declared', () => {
    expect(() =>
      createWebReportBuilder({
        tenantSlug: TENANT,
        copy: {
      engine: PT_BR_REPORT_ENGINE_COPY,
      blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY,
      screens: PT_BR_REPORT_SCREENS_COPY,
    },
        surface: {
          ...SURFACE,
          systemDashboards: [
            {
              key: 'painel-sem-secao',
              title: 'Painel sem secção',
              description: 'Um painel pendurado em nada.',
              permission: LENDING,
              section: 'arquivo-morto',
              blocks: [{ reportKey: 'emprestimos-por-estante', span: 12 }],
            },
          ],
        },
      }),
    ).toThrow(/section "arquivo-morto"/);
  });

  /** The key IS the URL segment, so a duplicate makes one of them unreachable. */
  it('refuses two dashboards sharing a key', () => {
    const twin = SURFACE.systemDashboards[0];
    if (!twin) throw new Error('the fixture must declare a dashboard');
    expect(() =>
      createWebReportBuilder({
        tenantSlug: TENANT,
        surface: { ...SURFACE, systemDashboards: [twin, twin] },
        copy: {
      engine: PT_BR_REPORT_ENGINE_COPY,
      blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY,
      screens: PT_BR_REPORT_SCREENS_COPY,
    },
      }),
    ).toThrow(/share the key/);
  });

  it('refuses a zone this runtime cannot resolve', () => {
    expect(() =>
      createWebReportBuilder({
        tenantSlug: TENANT,
        surface: { ...SURFACE, timeZone: 'Mars/Olympus' },
        copy: {
      engine: PT_BR_REPORT_ENGINE_COPY,
      blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY,
      screens: PT_BR_REPORT_SCREENS_COPY,
    },
      }),
    ).toThrow(/timeZone/);
  });
});
