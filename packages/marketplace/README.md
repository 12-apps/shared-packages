# @12-apps/marketplace

One integration engine for every marketplace a store sells through. Each
marketplace is an **adapter** on that engine, shipped inside this package at
its own subpath (`@12-apps/marketplace/ifood` today).

```ts
import { createMarketplaceEngine } from "@12-apps/marketplace";
import { createIfoodAdapter } from "@12-apps/marketplace/ifood";
import { IFOOD_ADAPTER_COPY_PT_BR } from "@12-apps/marketplace/ifood/pt-BR";

const engine = createMarketplaceEngine({
  ...hostPorts, // db, order, secrets, http, enqueue, clock, logger, publishChanged, the three numbers
  adapters: [createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_PT_BR })],
});
```

Adoption contract, every host port and the wiring: **[ADOPTING.md](./ADOPTING.md)**.
Why it is shaped this way: the decision record
[`docs/marketplace/decisions/0001-one-engine-an-adapter-per-marketplace.md`](../../docs/marketplace/decisions/0001-one-engine-an-adapter-per-marketplace.md).

## The owner's two rules

1. "The integration engine must be the same for all integrations: iFood, Rappi,
   99. Only an adapter is made for each one, to connect to the base engine."
2. "This base engine must be a separate lib that implements the wiring package."

Engine and adapters share one version. No provider-specific branch exists
anywhere outside an adapter and its registration: the engine dispatches every
provider decision through the adapter registry, and a suite registers a fake
second marketplace and drives ingest, confirm and cancel without touching
engine code (`src/__tests__/second-adapter.test.ts`).

## What the engine holds

| part | what it does |
|---|---|
| **Canonical types** | `NormalizedEvent`, `NormalizedMarketplaceOrder`: what every adapter normalizes into. Poorer than any marketplace's payload on purpose; the raw payload stays in the inbox row. |
| **Inbox** | Every delivery recorded before it is processed, deduped on `(provider, eventId)`. A redelivery is a DB-level no-op; a crash mid-ingest leaves a PENDING row the sweep retries. |
| **Pipeline** | normalize → inbox → ingest / cancel / cancellation-refused / ignore. Never throws. |
| **Ingest** | Idempotent on `(provider, externalOrderId)`. Unmapped SKUs are rows on the attention list, never a rejection. The deadline is stamped at ingest; auto-accept is born accepted in one write and queues the confirm. |
| **Acceptance clock** | `AWAITING → ACCEPTED | REJECTED | EXPIRED`, every transition predicated on the current state. The sweep never touches an accepted order. |
| **Decisions** | Many at once, all-or-nothing: accept (with the person's admission and a preparation time), or refuse with a reason code validated against the adapter's own list and, for a reason that needs them, the order's offending SKUs. The host admits each decision inside the claim's transaction (`order.admit`: the stock ask, the draw). The store's own cancel through the host's flow stamps the request too. `suggestReason` preselects the item-unavailable reason when the host says stock is short. |
| **SKU map** | External SKU → host catalog id, every SKU ever seen a row; mapping checks the id is the tenant's. |
| **Integration settings** | Enabled, environment, merchant id, auto-accept, acknowledgement window; credentials sealed as one blob by the host's secrets port, never returned. A connection is archived (reversible, audited), never deleted. |
| **Outbound engine** | The `marketplace.outbound` job: confirm after accept (with the preparation time where the marketplace takes one), cancellation request with the stored reason code and SKUs. 2xx done; a 4xx other than 408/425/429 refused and final; anything else retried until the last attempt, which ends FAILED whatever went wrong. Stamps `confirmed_at`, `confirm_failed_at`, `cancellation_status` (PENDING, REQUESTED, CONFIRMED, FAILED). Idempotent by the row. Queued BEFORE the host's half runs, and the `marketplace.outbound-sweep` job re-queues every call still owed, so nothing is lost. |
| **Inbound outcomes** | A marketplace CANCELLED confirms a pending request; CANCELLATION_REQUEST_FAILED marks it FAILED; CONFIRMED is terminal. |
| **Adapter port** | `MarketplaceAdapter`: `normalize`, `readSignature`, `verifySignature`, `cancellationReasons`, `confirm`, `requestCancellation`, `appLink`, and `capabilities`. |

## Subpaths

| export | what |
|---|---|
| `@12-apps/marketplace` | the engine, the adapter port and registry, every type |
| `@12-apps/marketplace/ifood` | `createIfoodAdapter({ copy })` |
| `@12-apps/marketplace/ifood/pt-BR`, `/en-US` | the iFood adapter's copy packs (reason labels, "no street number") |
| `@12-apps/marketplace/server` | `createApiMarketplace` (route descriptors), `MARKETPLACE_JOBS`, `MARKETPLACE_MCP_TOOLS` (six: a read and a bulk write per entity), `MARKETPLACE_PERMISSIONS`, the strict Zod inputs |
| `@12-apps/marketplace/server/pt-BR`, `/en-US` | the routes' copy packs |
| `@12-apps/marketplace/hono` | `marketplaceRouter(config)` — the routes as one Hono router (`hono` is an optional peer) |
| `@12-apps/marketplace/manifest`, `/manifest/server` | the wiring manifests |
| `prisma/marketplace.prisma`, `prisma/migrations/*` | the partial (no host table named) and its replay-safe migration |

## iFood is unverified

iFood's developer portal refused our reader, so the iFood adapter's URLs, body
fields and reason codes come from the portal's search snippets (2026-11-11).
They live only in `src/ifood/outbound.ts` and `src/ifood/copy.ts`, whose
headers say so, so the homologation run corrects two files. Tests never reach
iFood: the HTTP client is the host's port.
