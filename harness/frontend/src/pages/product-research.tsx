import { useCallback, useMemo, useState, type JSX } from 'react';

import { Stack } from '@12-apps/ui/mui/Stack';
import {
  PT_BR_RESEARCH_MESSAGES,
  ResearchHomeScreen,
  ResearchRunScreen,
  type CatalogRef,
  type ListPagination,
  type ResearchApiClient,
  type ResearchQueryInput,
  type ResearchRequestView,
  type ResearchRunView,
  type SourceSummary,
} from '@12-apps/product-research-ui';

/**
 * The whole wiring a frontend host performs for `@12-apps/product-research-ui`.
 *
 * The package is headless by construction: every screen reads and writes
 * through a {@link ResearchApiClient} the HOST implements, and no fetch happens
 * inside it. So the only interesting question a consumer harness can ask is
 * whether the client a host would naturally write — plain same-origin `fetch`
 * against the endpoints `@12-apps/product-research` declares — actually
 * satisfies it.
 *
 * That is why this client is NOT in-memory. A page that answered its own
 * fixtures would render every screen perfectly while proving nothing about the
 * two published tarballs meeting: the engine's routes are one package, these
 * screens are another, and the shapes they agree on (`ResearchRequestView`,
 * `ResearchRunView`) are carried by a store seam typed `Promise<unknown>` so a
 * host can answer whatever it likes. There is no type error between them —
 * only a screen rendering `undefined`. Every call below crosses Vite's proxy
 * into the backend harness's real Hono mount over a real Postgres.
 *
 * Two things here are genuinely the host's and could not be otherwise:
 *
 * - **the identity.** The backend resolves a caller from a header, so the
 *   client sends one on every request. A real host sends a session cookie; what
 *   matters is that the package neither knows nor asks.
 * - **the history LISTING.** `GET /research` is the one route of the seventeen
 *   the engine deliberately does not declare — its query grammar is a host's
 *   own search-grid config — so `listRequests` below reaches a route the
 *   backend harness owns, mounted beside the package's own POST on the same
 *   path. It answers the SAME view shape, from the same mapping.
 */
const TENANT = 'research-harness';
const BASE = `/api/admin/${TENANT}/research`;

/** The backend's actor seam reads this; a real host would send a cookie. */
const HEADERS = { 'x-rbac-user': 'ana', 'content-type': 'application/json' };

async function envelope<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`${response.status} ${response.url}`);
  return ((await response.json()) as { data: T }).data;
}

function createClient(): ResearchApiClient {
  return {
    async startResearch(query: ResearchQueryInput, options?: { catalogRef?: CatalogRef }) {
      // The engine reads the query NESTED under `query` — a flat body is
      // accepted with a 202 and an empty term, because it coerces
      // `query['term'] ?? ''`. A host gets that wrong exactly once.
      const body: Record<string, unknown> = { query };
      if (options?.catalogRef !== undefined) body['catalogRef'] = options.catalogRef;
      return envelope<{ requestId: string }>(
        await fetch(BASE, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) }),
      );
    },
    async getRequest(requestId: string): Promise<ResearchRequestView> {
      return envelope(await fetch(`${BASE}/requests/${requestId}`, { headers: HEADERS }));
    },
    async getRun(runId: string): Promise<ResearchRunView> {
      return envelope(await fetch(`${BASE}/runs/${runId}`, { headers: HEADERS }));
    },
    async listRequests(input: { page: number; pageSize: number; term?: string }) {
      const query = new URLSearchParams({
        page: String(input.page),
        pageSize: String(input.pageSize),
        ...(input.term === undefined ? {} : { term: input.term }),
      });
      const response = await fetch(`${BASE}?${query}`, { headers: HEADERS });
      if (!response.ok) throw new Error(`${response.status} ${response.url}`);
      return (await response.json()) as {
        data: ResearchRequestView[];
        pagination: ListPagination;
      };
    },
    async listSources(): Promise<SourceSummary[]> {
      return envelope(await fetch(`${BASE}/sources`, { headers: HEADERS }));
    },
  };
}

/**
 * Home and run, and the navigation BETWEEN them, which is the host's.
 *
 * `onOpenRequest` is a required prop precisely because the package refuses to
 * know what a URL is here — so this is the smallest honest thing a host can do
 * with it. `ResearchRunScreen` then polls `getRequest` until a run appears,
 * which is the arrangement the 202 forces: the accepted answer cannot carry a
 * run id, because the run is the host's worker's to create.
 */
export function ProductResearchPage(): JSX.Element {
  const client = useMemo(createClient, []);
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);
  // The home screen loads its history ONCE, on mount — it has no reason to
  // know that the host just started something. Re-keying it is the host's
  // smallest honest answer to that, and without it a research a person just
  // started is missing from the list right under the form.
  const [historyKey, setHistoryKey] = useState(0);

  const open = useCallback((requestId: string) => {
    setOpenRequestId(requestId);
    setHistoryKey((current) => current + 1);
  }, []);
  const repeat = useCallback(
    (request: ResearchRequestView) => {
      void client
        .startResearch(
          {
            term: request.term,
            quantity: request.quantity,
            ...(request.brand === null ? {} : { brand: request.brand }),
            ...(request.region === null ? {} : { region: request.region }),
          } as ResearchQueryInput,
          // A repeat re-states the catalog entry the original was started from
          // (FUT-494); the form never has one. Dropping it here would turn a
          // product page's research into an untethered one on its second run.
          request.catalogRef === null ? undefined : { catalogRef: request.catalogRef },
        )
        .then(open);
    },
    [client, open],
  );

  return (
    <Stack spacing={4}>
      <ResearchHomeScreen
        key={historyKey}
        client={client}
        onOpenRequest={open}
        onRepeatRequest={repeat}
        messages={PT_BR_RESEARCH_MESSAGES}
      />
      {openRequestId !== null && (
        <div data-testid="research-open-run">
          <ResearchRunScreen
            client={client}
            requestId={openRequestId}
            messages={PT_BR_RESEARCH_MESSAGES}
          />
        </div>
      )}
    </Stack>
  );
}
