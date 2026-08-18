/**
 * Every screen `@12-apps/entity-lifecycle/react` ships, explorable with NO host:
 * the Lixeira, the Aprovações inbox, the two behind the package's own tabs, and
 * the draft banner a host mounts inside its own editor.
 *
 * The fake transport below stands in for the endpoints
 * `createApiEntityLifecycle` mounts. Nothing here reaches a server, so every
 * state a reviewer needs to judge — including the ones that are hard to
 * provoke against a real tenant, like a feature switched off mid-plan — is a
 * story rather than a set-up.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import type { ApprovalRequestWire, DraftWire, RecycleBinEntryWire } from './api';
import { createWebEntityLifecycle } from './create-web-entity-lifecycle';
import { LifecycleHttpError, type LifecycleResult, type LifecycleTransport } from './transport';

const meta: Meta = { title: 'Lifecycle screens' };
export default meta;

const API_BASE = '/api/admin/minha-loja';

/** The host's own words for its collections — the package ships none. */
const LABELS = {
  product: 'Produto',
  category: 'Categoria',
  supplier: 'Fornecedor',
};

const WHEN = new Date(Date.UTC(2026, 7, 14, 16, 45)).toISOString();

/**
 * A transport with no server behind it. `reads` is matched by URL PREFIX, so a
 * story can answer `/approvals?status=PENDING` and `/approvals?status=APPROVED`
 * differently — which is what the inbox's filter chips switch between.
 */
function fakeTransport(
  reads: Record<string, unknown>,
  writeResult: LifecycleResult<unknown> = { ok: true, data: undefined },
): LifecycleTransport {
  return {
    async get<T>(url: string): Promise<T> {
      const hit = Object.entries(reads)
        // Longest key first, so `…/approvals?status=APPROVED` wins over `…/approvals`.
        .sort(([a], [b]) => b.length - a.length)
        .find(([key]) => url.startsWith(key));
      if (!hit) throw new LifecycleHttpError(404, `Nada roteado para ${url}`);
      if (hit[1] instanceof LifecycleHttpError) throw hit[1];
      return { data: hit[1] } as T;
    },
    async send<T>(): Promise<LifecycleResult<T>> {
      return writeResult as LifecycleResult<T>;
    },
  };
}

function surface(transport: LifecycleTransport) {
  return createWebEntityLifecycle({ apiBase: API_BASE, transport, entityTypeLabels: LABELS });
}

// ---------------------------------------------------------------------------
// Lixeira — the recycle bin
// ---------------------------------------------------------------------------

function binEntry(over: Partial<RecycleBinEntryWire> = {}): RecycleBinEntryWire {
  return {
    id: 'bin-1',
    entityType: 'product',
    entityId: 'p1',
    label: 'Coca-Cola Lata 350ml',
    deletedBy: 'u1',
    deletedByName: 'Ana Souza',
    deletedAt: WHEN,
    status: 'DELETED',
    children: [],
    ...over,
  };
}

/**
 * A deleted aggregate brings its dependents with it, and the card says so —
 * "Inclui: …" is how an admin knows what a Restaurar will bring back.
 */
export const RecycleBin: StoryObj = {
  name: 'Lixeira — deleted items and what they take with them',
  render: () => {
    const { RecycleBinScreen } = surface(
      fakeTransport({
        [`${API_BASE}/recycle-bin`]: {
          entries: [
            binEntry({
              children: [
                { id: 'bin-1a', entityType: 'product', label: 'Variação 350ml' },
                { id: 'bin-1b', entityType: 'product', label: 'Variação 600ml' },
              ],
            }),
            binEntry({
              id: 'bin-2',
              entityType: 'category',
              entityId: 'c9',
              label: 'Bebidas geladas',
              deletedByName: 'Bruno Lima',
            }),
            // No label for `ingredient` in LABELS above: the chip renders the
            // RAW KEY, which is the package's deliberate behaviour — it ships
            // no catalog of another host's nouns.
            binEntry({
              id: 'bin-3',
              entityType: 'ingredient',
              entityId: 'i4',
              label: 'Xarope de guaraná',
              deletedBy: null,
              deletedByName: null,
            }),
          ],
        },
      }),
    );
    return <RecycleBinScreen />;
  },
};

export const RecycleBinEmpty: StoryObj = {
  name: 'Lixeira — empty',
  render: () => {
    const { RecycleBinScreen } = surface(
      fakeTransport({ [`${API_BASE}/recycle-bin`]: { entries: [] } }),
    );
    return <RecycleBinScreen />;
  },
};

// ---------------------------------------------------------------------------
// Aprovações — the change-request inbox
// ---------------------------------------------------------------------------

function request(over: Partial<ApprovalRequestWire> = {}): ApprovalRequestWire {
  return {
    id: 'cr-1',
    entityType: 'product',
    entityId: 'p1',
    action: 'UPDATE',
    label: 'Coca-Cola Lata 350ml',
    status: 'PENDING',
    requestedBy: 'u2',
    requestedByName: 'Bruno Lima',
    requestedAt: WHEN,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    ...over,
  };
}

/**
 * The inbox, with all three filters answering. Switch the chips to see an
 * approved and a rejected request — the second carries the decision note,
 * which is the only place a rejection says why.
 */
export const Approvals: StoryObj = {
  name: 'Aprovações — pending, approved and rejected',
  render: () => {
    const { ApprovalsScreen } = surface(
      fakeTransport({
        [`${API_BASE}/approvals?status=PENDING`]: {
          requests: [
            request(),
            request({
              id: 'cr-2',
              action: 'CREATE',
              entityId: null,
              entityType: 'supplier',
              label: 'Distribuidora Sul',
            }),
            request({
              id: 'cr-3',
              action: 'DELETE',
              entityType: 'category',
              label: 'Bebidas geladas',
              requestedByName: 'Carla Dias',
            }),
          ],
        },
        [`${API_BASE}/approvals?status=APPROVED`]: {
          requests: [
            request({
              id: 'cr-4',
              status: 'APPROVED',
              label: 'Água com gás 500ml',
              decidedBy: 'u1',
              decidedAt: WHEN,
            }),
          ],
        },
        [`${API_BASE}/approvals?status=REJECTED`]: {
          requests: [
            request({
              id: 'cr-5',
              status: 'REJECTED',
              label: 'Cerveja 1L',
              decidedBy: 'u1',
              decidedAt: WHEN,
              decisionNote: 'Preço abaixo do custo — refaça com a margem combinada.',
            }),
          ],
        },
      }),
    );
    return <ApprovalsScreen />;
  },
};

export const ApprovalsEmpty: StoryObj = {
  name: 'Aprovações — nothing pending',
  render: () => {
    const { ApprovalsScreen } = surface(
      fakeTransport({ [`${API_BASE}/approvals`]: { requests: [] } }),
    );
    return <ApprovalsScreen />;
  },
};

/**
 * The tenant is not entitled to approvals (or switched them off). A 403 is a
 * FRIENDLY notice, not an error state: nothing is broken, the feature is off.
 */
export const ApprovalsFeatureOff: StoryObj = {
  name: 'Aprovações — feature off for this store (403)',
  render: () => {
    const { ApprovalsScreen } = surface(
      fakeTransport({
        [`${API_BASE}/approvals`]: new LifecycleHttpError(403, 'Recurso não está ativo.'),
      }),
    );
    return <ApprovalsScreen />;
  },
};

// ---------------------------------------------------------------------------
// The whole surface, tabbed
// ---------------------------------------------------------------------------

/** What a host gets by mounting ONE component: both screens behind tabs. */
export const WholePage: StoryObj = {
  name: 'The whole surface — Lixeira + Aprovações behind tabs',
  render: () => {
    const { page: Page } = surface(
      fakeTransport({
        [`${API_BASE}/recycle-bin`]: { entries: [binEntry()] },
        [`${API_BASE}/approvals`]: { requests: [request()] },
      }),
    );
    return <Page />;
  },
};

// ---------------------------------------------------------------------------
// Draft banner — mounted inside the host's own editor
// ---------------------------------------------------------------------------

const DRAFT: DraftWire = {
  id: 'd1',
  entityId: 'p1',
  data: { name: 'Coca-Cola Lata 350ml', priceCents: 650 },
  status: 'OPEN',
  updatedAt: WHEN,
};

/**
 * The banner a host puts at the top of its editor when the item has unpublished
 * edits. `title` exists because the generic copy is wrong for a collection with
 * its own noun — the origin host's product editor says "Este produto tem…".
 */
export const DraftBanner: StoryObj = {
  name: 'Draft banner — unpublished edits on a live item',
  render: () => {
    const { DraftBanner: Banner } = surface(fakeTransport({}));
    return (
      <Banner
        slug="products"
        draft={DRAFT}
        onLoad={() => undefined}
        onPublished={() => undefined}
        onDiscarded={() => undefined}
        testIdPrefix="product-draft"
        title="Este produto tem alterações não publicadas."
      />
    );
  },
};

/** A draft of an item that does not exist yet — publishing CREATES it. */
export const DraftBannerNewItem: StoryObj = {
  name: 'Draft banner — a new item that was never published',
  render: () => {
    const { DraftBanner: Banner } = surface(fakeTransport({}));
    return (
      <Banner
        slug="products"
        draft={{ ...DRAFT, id: 'd2', entityId: null }}
        onLoad={() => undefined}
        onPublished={() => undefined}
        onDiscarded={() => undefined}
        testIdPrefix="product-draft"
      />
    );
  },
};
