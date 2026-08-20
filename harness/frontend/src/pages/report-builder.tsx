import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef, type JSX } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { reportSpecSchema, type ReportSpec } from '@12-apps/report-builder';
import { reportBuilderManifest } from '@12-apps/report-builder/manifest';
import { reportBuilderWebManifest } from '@12-apps/report-builder/manifest/web';
import type { BlockTemplateGroup, ReportBuilderSurface } from '@12-apps/report-builder/react';
import { createWiringHost } from '@12-apps/wiring/consumer';

/**
 * The whole wiring a frontend host performs for this package.
 *
 * Everything the reports feature IS — the list, the viewer, the editor, the
 * config panel, the pickers, the routes between them — lives inside
 * @12-apps/report-builder. This file names the tenant and mounts the surface
 * into a router, which is the only part that is genuinely the host's.
 *
 * There is no `transport`, and that absence is the point. This page used to
 * pass one that mounted the package's Hono router INSIDE the browser — Hono is
 * isomorphic, so `router.request()` answered every screen with no socket in
 * between. It proved the client and server halves of the contract against each
 * other, and it lied about being a consumer: hitting Save produced no network
 * request, and a reload threw the work away. `harness/backend` is a real server
 * on a real port now and Vite proxies `/api` to it, so omitting `transport`
 * gets the package's own same-origin `fetch` — the arrangement a real host has,
 * and therefore the one this fixture should be exercising.
 */

/** This page's harness slug — and so the hash prefix everything below owns. */
const PAGE_SLUG = 'report-builder';

/** Whose reports these are. The package builds its own paths out of it. */
const TENANT_SLUG = 'harness';

/**
 * Where the surface has to be mounted inside the router.
 *
 * Not a preference: every screen in the package navigates to an absolute
 * `/<tenantSlug>/reports/…`, so a host that mounts it anywhere else matches
 * nothing the moment anything is clicked.
 */
const SURFACE_ROOT = `/${TENANT_SLUG}/reports`;

/** A template spec, parsed the way a host's own config would be. */
const spec = (input: unknown): ReportSpec => reportSpecSchema.parse(input);

/**
 * The block templates this host offers — its product, in its words.
 *
 * They used to come from inside the package: `blockTemplateGroups()` returned
 * three groups of the origin host's own reports, built from the origin host's starters,
 * and every consumer that mounted the editor got them. The picker's contract is
 * "your groups, then the blank one", so the groups are declared here, over the
 * catalog `harness/backend` actually serves.
 */
const BLOCK_TEMPLATES: BlockTemplateGroup[] = [
  {
    id: 'vendas',
    title: 'Vendas',
    templates: [
      {
        // Deliberately NOT named the way the package's own deleted title→id map
        // named it ("Receita por dia" / `receita-por-dia`). The journeys read
        // this id and title out of `reports-world.ts`, so a harness that kept
        // the exact strings that map held would have run green against a
        // package still carrying it — which is how the map survived the branch
        // that de-literalised the features.
        id: 'serie-cronologica',
        title: 'Série cronológica',
        description: 'O valor liquidado a cada data, em ordem',
        spec: spec({
          entity: 'orders',
          dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
          measures: [{ field: 'revenueCents', aggregation: 'sum', alias: 'receita' }],
          filters: [{ field: 'status', operator: 'eq', value: 'PAID' }],
          presentation: { kind: 'chart', chartType: 'line' },
        }),
      },
      {
        id: 'produtos-mais-vendidos',
        title: 'Produtos mais vendidos',
        description: 'Os dez produtos que mais renderam',
        spec: spec({
          entity: 'order_items',
          dimensions: [{ field: 'productName' }],
          measures: [{ field: 'revenueCents', aggregation: 'sum', alias: 'receita' }],
          sort: [{ by: 'receita', direction: 'desc' }],
          limit: 10,
          presentation: { kind: 'chart', chartType: 'bar' },
        }),
      },
    ],
  },
  {
    id: 'movimento',
    title: 'Movimento',
    templates: [
      {
        id: 'preparo-por-estacao',
        title: 'Tempo de preparo por estação',
        description: 'Onde a cozinha demora, sem apontar para uma pessoa',
        spec: spec({
          entity: 'kitchen_ticket_items',
          dimensions: [{ field: 'stationName' }],
          measures: [
            { field: 'prepSeconds', aggregation: 'p90', alias: 'preparo_p90' },
            { field: 'lines', aggregation: 'sum', alias: 'linhas' },
          ],
          sort: [{ by: 'linhas', direction: 'desc' }],
          presentation: { kind: 'table' },
        }),
      },
      {
        id: 'horas-por-estacao',
        title: 'Horas trabalhadas por estação',
        description: 'Horas lançadas e linhas produzidas em cada estação',
        spec: spec({
          entity: 'kitchen_shifts',
          dimensions: [{ field: 'stationName' }],
          measures: [
            { field: 'laborSeconds', aggregation: 'sum', alias: 'horas' },
            { field: 'outputLines', aggregation: 'sum', alias: 'linhas' },
          ],
          sort: [{ by: 'horas', direction: 'desc' }],
          presentation: { kind: 'table' },
        }),
      },
    ],
  },
  {
    id: 'pagamentos-e-perdas',
    title: 'Pagamentos e perdas',
    templates: [
      {
        // The second half of the same pair — see `serie-cronologica` above.
        id: 'reparticao-por-canal',
        title: 'Repartição por canal',
        description: 'Como o valor liquidado se reparte entre os canais',
        spec: spec({
          entity: 'payments',
          dimensions: [{ field: 'method' }],
          measures: [{ field: 'amountCents', aggregation: 'sum', alias: 'valor' }],
          filters: [{ field: 'status', operator: 'eq', value: 'PAID' }],
          presentation: { kind: 'chart', chartType: 'pie' },
        }),
      },
      {
        id: 'perdas-por-motivo',
        title: 'Perdas por motivo',
        description: 'Quanto foi perdido, e por quê',
        spec: spec({
          entity: 'loss_events',
          dimensions: [{ field: 'reasonName' }],
          measures: [{ field: 'lossValueCents', aggregation: 'sum', alias: 'valor_perdido' }],
          presentation: { kind: 'chart', chartType: 'bar' },
        }),
      },
      {
        id: 'movimentacoes-de-estoque',
        title: 'Movimentações de estoque',
        description: 'Entradas e saídas por tipo de movimento',
        spec: spec({
          entity: 'stock_movements',
          dimensions: [{ field: 'type' }],
          measures: [{ field: 'quantityDelta', aggregation: 'sum', alias: 'quantidade' }],
          presentation: { kind: 'chart', chartType: 'bar' },
        }),
      },
    ],
  },
];

/**
 * The host's vocabulary, REQUIRED by the factory.
 *
 * Every field of it used to be a module-scope constant inside the package —
 * `SYSTEM_REPORT_NAV`, `SYSTEM_DASHBOARDS`, a `{ orders: 'Pedidos' }` label map
 * and `America/Sao_Paulo`. A harness that inherited them could not tell a
 * default from a decision, which is the whole reason the package's own
 * portability suite now speaks a language nothing here uses.
 *
 * `receita-por-forma` is the one built-in `harness/backend` serves, so the two
 * halves name the same key; the sections are where its back-link goes in THIS
 * app's hash router.
 */
const SURFACE: ReportBuilderSurface = {
  systemReports: [
    {
      key: 'receita-por-forma',
      title: 'Receita por forma de pagamento',
      description: 'Quanto entrou por PIX, cartão e garçom no período.',
      permission: 'reports:sales:read',
      section: 'orders',
      supportsGrain: false,
    },
  ],
  systemDashboards: [],
  sections: [{ key: 'orders', label: 'Pedidos', path: 'orders' }],
  blockTemplates: BLOCK_TEMPLATES,
  timeZone: 'America/Sao_Paulo',
};

/**
 * The surface, adopted through `@12-apps/wiring/consumer` (12-27): the same
 * config `createWebReportBuilder` has always taken, handed through a typed
 * binding. Module scope IS the memoisation — the binder builds the surface
 * once, which is the rule every hand wiring used to carry as a comment (the
 * factory returns component TYPES; a rebuild unmounts the whole tree).
 */
const webWiring = createWiringHost({
  name: 'harness-frontend',
  kind: 'web',
  // The browser half of the observability capability: errors tag with the
  // package's namespace. The harness's sink is the console.
  ports: {
    loggerFor: (namespace) => ({
      info: (message, ...meta) => console.info(`[${namespace}] ${message}`, ...meta),
      warn: (message, ...meta) => console.warn(`[${namespace}] ${message}`, ...meta),
      error: (message, ...meta) => console.error(`[${namespace}] ${message}`, ...meta),
    }),
  },
});
const { surface: reportsSurface } = webWiring.adoptWeb({
  manifest: reportBuilderManifest,
  web: reportBuilderWebManifest,
  // This host really runs the declared world: `tests/e2e/steps/reports-world.ts`
  // calls `defineReportsWorld` and playwright.config.ts compiles the package's
  // journeys under this root. The binding is the report's proof of that.
  e2e: { featuresRoot: '.features-gen' },
  bindings: {
    surface: {
      config: {
        tenantSlug: TENANT_SLUG,
        surface: SURFACE,
        // NOT standalone. `standalone` wraps the surface in a `MemoryRouter`,
        // which is what a host with no router at all needs — and a memory
        // router keeps its location in a variable, so opening a report changed
        // the screen and left the address bar saying `#/report-builder`.
        // Nothing could be linked to, reloaded or backed out of. This page has
        // a router, so the surface uses it.
        standalone: false,
      },
    },
  },
});
webWiring.assemble();
const ReportSurface = reportsSurface.page;

/**
 * The cache the surface shares with its host.
 *
 * `standalone` used to stand one up. A host that owns the router owns this too
 * — the arrangement the origin host's admin has, where an invalidation anywhere in
 * the app reaches the reports screens.
 */
const queryClient = new QueryClient();

/** The router's path: whatever the hash holds BELOW this page's own slug. */
function pathBelowSlug(): string | null {
  const hash = window.location.hash.replace(/^#/, '');
  const prefix = `/${PAGE_SLUG}`;
  if (hash === prefix) return '/';
  // Another page entirely — the shell is about to unmount this one, so there is
  // nothing here to follow and a bare remainder is not a path to navigate to.
  if (!hash.startsWith(`${prefix}/`)) return null;
  return hash.slice(prefix.length);
}

/**
 * Follow a hash the SHELL changed.
 *
 * react-router's hash history listens on `popstate` alone, and writes its own
 * navigations with `pushState` — which fires no `hashchange`. That is right in
 * an app that owns the whole hash; here the shell owns the first segment, and
 * its nav rows are plain `<a href="#/…">`. So clicking "Report builder" while
 * reading a report moved the address bar and nothing else, leaving the URL and
 * the screen disagreeing — the same defect this page exists to fix, arrived at
 * from the other side.
 *
 * `replace`, not push: the anchor has already added the entry the click asked
 * for, and pushing would make one click cost two steps of history.
 */
function FollowShellHash(): null {
  const navigate = useNavigate();
  const location = useLocation();
  // What is on screen, readable from inside a listener that outlives a render.
  const shown = useRef(location);
  shown.current = location;

  useEffect(() => {
    const onHashChange = (): void => {
      const wanted = pathBelowSlug();
      if (wanted === null) return;
      if (wanted === `${shown.current.pathname}${shown.current.search}`) return;
      void navigate(wanted, { replace: true });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [navigate]);

  return null;
}

export function ReportBuilderPage(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      {/* A REAL router, on the address bar. Its `basename` is this page's own
          slug — the segment the shell reads — so the surface writes
          `#/report-builder/harness/reports/r1` and the shell still finds
          `report-builder` at the front of it. */}
      <HashRouter basename={`/${PAGE_SLUG}`}>
        <FollowShellHash />
        <Routes>
          <Route path={`${SURFACE_ROOT}/*`} element={<ReportSurface />} />
          {/* `#/report-builder` on its own is the PAGE, not one of its screens.
              Replaced rather than pushed, so Back leaves the harness page it
              landed on instead of bouncing off this redirect. */}
          <Route path="*" element={<Navigate to={SURFACE_ROOT} replace />} />
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  );
}
