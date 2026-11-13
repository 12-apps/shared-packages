# Adopting @12-apps/marketplace

The engine is a library with required ports and no defaults: a host answers
every question only it can answer, and the engine supplies the mechanism.
Everything below is what a host binds, in the order it binds it.

## 1. The host ports (`MarketplacePorts`)

Every field is REQUIRED unless marked OPTIONAL. A missing required one is a type
error at mount, never a default that quietly adopts another host's policy.

| port | type | what the host answers |
|---|---|---|
| `db` | `() => Promise<MarketplaceDb>` | The Prisma client generated from a schema that includes `prisma/marketplace.prisma`. Structural: the four delegates `marketplaceIntegration`, `marketplaceMenuLink`, `marketplaceInboxEvent`, `marketplaceAcceptance`, and the catalogue's `marketplaceCataloguePublication` (optional in the type; the catalogue calls need it). |
| `transaction` | `<T>(fn: (db: MarketplaceDb) => Promise<T>) => Promise<T>` | Prisma's interactive `$transaction`: run `fn` with the transaction's client; a throw rolls back. Every bulk write and every decision (admission + claim) is one transaction. |
| `order.admit` | `(request: { clientId; orderId; decision: "ACCEPT" \| "REJECT"; admission: MarketplaceAdmission; db: MarketplaceDb }) => Promise<{ admitted: true } \| { admitted: false; code: string; message: string; details?: unknown }>` | Judge each decision BEFORE its claim commits, inside the claim's transaction (`request.db` is the transaction's client: draw the stock there, and a refusal anywhere in the call rolls the draw back). `admission` is `{ admitStockPastZero?: boolean }` as the person stated it. Refuse with your own code: the route answers 409 with it (`MARKETPLACE_STOCK_ASK` and the short lines in `details`). Never called for an ingest or `recordStoreCancellation`. |
| `order.create` | `(clientId, order: NormalizedMarketplaceOrder, lines: readonly ResolvedOrderLine[], db: MarketplaceDb) => Promise<string>` | Create the host's own order from a normalized one; return its id. `lines[i].subjectRef` is the mapped catalog id or null (never refuse the order for a null). `db` is the ingest's transaction client: write the order through it, so the order and the acceptance row commit together (a lost race rolls the host's order back instead of leaving an orphan a redelivery would duplicate). |
| `order.catalogHas` | `(clientId, subjectRef) => Promise<boolean>` | Does this catalog id exist and belong to this tenant? Asked before a SKU is mapped. |
| `order.onAccepted` | `(clientId, orderId) => Promise<void>` | The store accepted, or the connection auto-accepts. Start whatever accepting means here (the ticket, the board). Runs after the commit and AFTER the confirm is queued; a throw is logged and cannot un-accept or lose the confirm. Atomic work (the stock draw) belongs in `admit`. |
| `order.onRefused` | `(clientId, orderId, reason: "REJECTED" \| "EXPIRED" \| "CANCELLED") => Promise<void>` | Refuse/cancel the host order: the store refused on the clock, the clock lapsed, or the marketplace cancelled. After the commit and after the cancellation request is queued; a throw on a decision is logged. NOT called for `recordStoreCancellation`. A host that binds `onCancellationConfirmed` (request first) does not get `"REJECTED"` from `decide` either, nor `"CANCELLED"` for a cancellation the store asked for: `onCancellationConfirmed` replaces both. |
| `order.onCancellationConfirmed` | OPTIONAL — binding it OPTS IN to request first. `(clientId, orderId) => Promise<void>` | The marketplace CONFIRMED the store's own cancellation request (its event, or the job's answer for a marketplace that answers in the response); the row is REJECTED/CONFIRMED by then. Run the host's cancel here. Bound: the store's refusals and cancels (`decide` REJECT, `recordStoreCancellation`) only REQUEST the cancellation and keep the order as it was until this is called, once (a redelivered confirmation calls nothing), INSTEAD of `onRefused`. Not bound (a 1.0.0 host): everything as 1.0.0 — REJECTED at request time, `onRefused(…, "REJECTED")` from `decide`, and `onRefused(…, "CANCELLED")` on the confirmation. A throw is logged. |
| `order.onCancellationFailed` | OPTIONAL. `(clientId, orderId, reason: "REFUSED" \| "TIMEOUT") => Promise<void>` | The store's request FAILED: REFUSED (the marketplace's refusal event, the job's 4xx, its last attempt dying, or — request first — a marketplace whose API cannot take it, at once) or TIMEOUT (the outbound sweep, past the marketplace's answer window, or the 24-hour give-up). Called once, by the path that moved the row. Request first: the order stays as it was (AWAITING or ACCEPTED) and may be accepted again; show the adapter's app link and tell the person. A throw is logged. |
| `order.summarize` | `(clientId, orderIds: readonly string[]) => Promise<Map<string, MarketplaceOrderSummary>>` | The queue's host facts in one read: `{ buyerName, totalCents, unmappedLines, createdAt }`. |
| `secrets` | `{ seal(plaintext): string; open(sealed): string }` | Seal and open the credential blob with the host's key. `open` THROWS on a blob that will not open. |
| `http` | `(req: MarketplaceHttpRequest) => Promise<MarketplaceHttpResponse>` | The only way the engine reaches a marketplace. Answer any status; throw only when no answer arrived (timeout, network). The host owns the timeout, proxy and CA. `method` is `GET`, `POST`, `PUT` or, since the catalogue (1.2), `PATCH`. |
| `audit` | `{ record(entry: { clientId; actorId: string \| null; action: "marketplace.integration.archive" \| "marketplace.integration.unarchive"; provider; reason: string \| null; at: Date }, db: MarketplaceDb): Promise<void> }` | Every archive and unarchive of a connection, INSIDE the same transaction: write the line through `db`, so an archive never lands without its line and a failing audit rolls the archive back. `actorId` is `MarketplaceActor.userId`. |
| `enqueue` | `{ enqueue(name, payload, { dedupeKey? }) => Promise<{ enqueued: boolean; reason?: string }> }` | The wiring `JobsEnqueuePort`. Never throws. The engine queues only its own three on-demand jobs: `marketplace.outbound` (`{ clientId, orderId, action }`, dedupe key `marketplace.outbound:<action>:<orderId>`), `marketplace.fetch-order` (`{ clientId, inboxId }`, dedupe key `marketplace.fetch-order:<inboxId>`) and `marketplace.catalogue` (`{ clientId, publicationId, action }`, dedupe key `marketplace.catalogue:<action>:<publicationId>:<asked at, ms>`); the sweeps re-queue each under a key of their own. |
| `clock` | `{ now(): Date }` | What time it is. |
| `logger` | `{ info, warn, error }` | The wiring `LoggerPort`; bind `assembled.loggers["@12-apps/marketplace"]`. |
| `publishChanged` | `(clientId) => void` | Tell the staff surfaces something moved. Fire-and-forget. |
| `defaultAckSlaSeconds` | `number` | The acceptance window a new connection gets (the origin host: 300). |
| `reconcileBatchSize` | `number` | Stored deliveries one reconciliation pass re-runs (origin: 50). |
| `maxInboxAttempts` | `number` | Re-runs before a stored delivery is retired (origin: 5). |
| `catalogue` | OPTIONAL. `{ items(clientId, productIds) => Promise<Map<string, CatalogueItem>>; image(url) => Promise<{ contentType; base64 } \| null> }` | Catalogue publishing (1.2, FUT-4768). `items` maps the host's products into `{ name, description, imageUrl, categoryName, priceCents }` (the store's price, smallest unit; the photo an absolute https URL), keyed by product id; a missing id is a product that no longer exists. Called at publish (to check it exists) and by the job when it sends, so what goes out is the product as it is then. `image` reads a photo's bytes for a marketplace that takes an upload (iFood); null publishes without a photo. Absent: every catalogue call answers `UNSUPPORTED`. |
| `cancellationWindowMs` | OPTIONAL. `number` | For a host that requests first (binds `onCancellationConfirmed`): how long a store's cancellation request may wait (PENDING: not yet delivered, or REQUESTED: delivered and unanswered) before the outbound sweep fails it as TIMEOUT, for every adapter; a PENDING request's retries stop with it. A 1.0.0 host has no window: its requests are re-queued and given up after 24 hours, as before. Absent: each adapter's `capabilities.cancellationAnswerWindowMs` (iFood: 5 minutes, estimated); an adapter with none is given up on only after 24 hours. |

Plus `adapters: readonly MarketplaceAdapter[]` — one per marketplace the host
sells through. The list is validated at mount (ids, duplicates, reason lists).

```ts
import { createMarketplaceEngine } from "@12-apps/marketplace";
import { createIfoodAdapter } from "@12-apps/marketplace/ifood";
import { IFOOD_ADAPTER_COPY_PT_BR } from "@12-apps/marketplace/ifood/pt-BR";

export const engine = createMarketplaceEngine({
  db: async () => getPrismaClient(),
  transaction: async (fn) => (await getPrismaClient()).$transaction((tx) => fn(tx)),
  order: { admit, create, catalogHas, onAccepted, onRefused, summarize },
  audit: { record: writeAuditLine },
  secrets: { seal: encryptSecret, open: decryptSecret },
  http: marketplaceHttp,
  enqueue: jobs,
  clock: { now: () => new Date() },
  logger: assembled.loggers["@12-apps/marketplace"],
  publishChanged,
  defaultAckSlaSeconds: 300,
  reconcileBatchSize: 50,
  maxInboxAttempts: 5,
  adapters: [createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_PT_BR })],
});
```

## 2. What the host calls on the engine

| call | when |
|---|---|
| `decideMany({ clientId, decisions, validateOnly? })` / `decide({ clientId, ...decision })` | Every accept or refusal of an order on the clock, from every surface (the board, the admin route, the MCP tool). One decide path, all-or-nothing. A decision is `{ orderId, decision: "ACCEPT", admission?, preparationMinutes? }` or `{ orderId, decision: "REJECT", reasonCode?, offendingSkus? }`. `decide` answers `decided`, `stale` with `reason` (`ALREADY_DECIDED` with the `status` — answer an ACCEPTED one as done, I4 — `EXPIRED`, `NOT_FOUND`, `CONFLICT`), `invalidReason` (`INVALID_REASON`, `ITEMS_REQUIRED`, `UNKNOWN_ITEM`), or `refusedByHost` (your `admit`'s code). |
| `recordStoreCancellation({ clientId, orderId, reasonCode?, offendingSkus? })` | The store cancels a marketplace order (before or after accepting it). Stamps the request and queues it. A host that binds no `onCancellationConfirmed` cancelled first and gets 1.0.0's stamps (REJECTED at once). A host that binds it (request first) gets the REQUEST only: the status stays AWAITING or ACCEPTED (and `decided.status` says so) until the marketplace confirms; a FAILED request may be asked again. `stale` when the marketplace already cancelled it or a request is already waiting. |
| `suggestReason(provider, { itemUnavailable })` | To preselect a reason in the refusal dialog. The host judges the shortage. |
| `orderStates(clientId, orderIds)` | The order reads: `{ status, confirmedAt, confirmFailedAt, cancellation, cancellationReasonCode, cancellationFailure, appUrl }` per marketplace order, one query. `cancellation` PENDING or REQUESTED is a request still waiting: draw it as such. `cancellationFailure` is REFUSED or TIMEOUT when `cancellation` is FAILED. |
| `adapter(provider)`, `reasons(provider)`, `appLink(provider, ref)` | The marketplace's capabilities, reasons and link, without naming it. |
| `catalogueMode(provider)` | `"push"`, `"pull"` or null: whether the product page can offer this marketplace's switch at all (null: say it cannot be published to). Null also while the host binds no `catalogue` port. |
| `publish({ clientId, provider, productId, priceCents? })` | The switch turned ON, a new marketplace price, or "try again" after FAILED. `priceCents` absent keeps the stored price, `null` goes back to the store's, a positive integer sets this marketplace's (never the store's own). Answers `queued` with the row (PUBLISHING), or `refused` with `UNSUPPORTED`, `NOT_CONNECTED` (no live connection with credentials and a merchant id), `UNKNOWN_PRODUCT` or `INVALID_PRICE`. Gate it with `marketplace:manage`. |
| `withdraw({ clientId, provider, productId })` | The switch turned OFF (and the undo of an ON). `queued` (WITHDRAWING), or `unchanged` when the product was never switched on, or is WITHDRAWN at once because its connection was archived or removed since. |
| `catalogueState({ clientId, productIds, providers? })` | The product page's read: one row per marketplace the product was ever switched on for, in one query. Draw PUBLISHED as "in the catalogue" (with your sentence for a `warningCode`, IMAGE_TOO_LARGE or IMAGE_REFUSED: it went out without its photo), PUBLISHING / WITHDRAWING as "sending…" (switch disabled), FAILED with your own sentence for its `failureCode` (REFUSED, UNAVAILABLE, TIMEOUT, NOT_CONNECTED, CREDENTIALS, PRODUCT_GONE, UNSUPPORTED, INTERNAL), the marketplace's own words from `failureReason` beside a REFUSED, and a retry (`publish` or `withdraw` again, per `failedAction`). The engine writes no sentence a person reads. No row is OFF. |
| `catalogueDocument({ clientId, provider, options: { menuName, currency } })` | PULL marketplaces only (99Food): the menu part of the document the marketplace reads. Serve it from the route the marketplace pulls (Open Delivery's `GET /v1/merchant`), merged into the rest of that document, which is the host's (`id`, `status`, `lastUpdate`, `TTL`, `basicInfo`, `services`). The menu's name and the currency are the host's words. |
| `ingest(...)`, `deliver(...)` | A producer that hands over an order directly; the webhook does `deliver` for you. |

A host never writes `provider === "IFOOD"`. A capability is asked of
`engine.adapter(provider).capabilities`.

## 3. The wiring capabilities

Adopt through `@12-apps/wiring/consumer`:

```ts
host.adoptServer({
  manifest: marketplaceManifest,          // @12-apps/marketplace/manifest
  server: marketplaceServerManifest,      // @12-apps/marketplace/manifest/server
  bindings: {
    http: { mountPath: "/api", config: { engine, copy: MARKETPLACE_SERVER_COPY_PT_BR, tenantBySlug, logger } },
    jobs: { deps: { engine } },
  },
});
```

| capability | what it is |
|---|---|
| `http` | `POST /webhooks/marketplace/:tenantSlug/:provider` (`kind: "webhook"`, needs the raw `request`), and per entity one read and one bulk write under `/admin/:tenantSlug/marketplace`: `GET`/`PUT` (connections), `GET`/`PUT /menu-links`, `GET`/`POST /acceptances` (decisions). `@12-apps/marketplace/hono`'s `marketplaceRouter({ ...config, resolveActor })` mounts them in one line. |
| `jobs` | `marketplace.expire-acceptances` (every minute, lease 5 min), `marketplace.reconcile-inbox` (every 5 min, lease 5 min), `marketplace.outbound` (3 attempts, exponential backoff 30 s), `marketplace.fetch-order` (on demand, 3 attempts, exponential backoff 5 s: the order body an event only announced; a host that holds it through its `enqueue` port holds every fetch), `marketplace.catalogue` (on demand, 3 attempts, exponential backoff 10 s: one publish or withdraw; the last attempt ends FAILED with the marketplace's reason), `marketplace.outbound-sweep` (every 5 min, lease 5 min: re-queues every call still owed after 10 min, gives a PENDING request up as FAILED after 24 h, and does the same for a catalogue row still PUBLISHING or WITHDRAWING). Bind `{ engine }`. |
| `mcp` | Six tools, the bulk-upsert protocol: `listMarketplaceIntegrations` / `upsertMarketplaceIntegrations` (operations `upsert`, `archive`, `unarchive`), `listMarketplaceMenuLinks` / `upsertMarketplaceMenuLinks`, `listMarketplaceAcceptances` / `decideMarketplaceOrders`. Every write takes a list, is all-or-nothing in one transaction, supports `validateOnly`, answers every problem with its path; reads take `ids`. Descriptions are English. |
| `permissions` | `marketplace:manage` (connect, map) and `marketplace:decide` (read and answer the queue). The host decides which roles hold them; each route declares its own. |
| `db` | `prisma/marketplace.prisma` + `prisma/migrations` (composed). |
| `observability` | namespace `marketplace`. |

The route copy (`MarketplaceServerCopy`) and each adapter's copy
(`IfoodAdapterCopy`, `NinetyNineFoodAdapterCopy`, `RappiAdapterCopy`) are
required config; pt-BR and en-US packs ship beside each. The 99Food adapter
also requires its `apiBaseUrl` per environment and its `portalUrl`, which
99Food gives a partner at onboarding. The Rappi adapter requires its
`apiBaseUrl` and `tokenUrl` per environment (on Rappi's country domains), its
`portalUrl` and its `amountUnit` (how Rappi states money for the host's
country); see the README's Rappi section for what is still ESTIMATED.

## 4. What the origin host changes when it adopts this package

1. **Bind the new ports:** `transaction` (`prisma.$transaction`), `order.admit` (move the
   stock ask and the draw of an accept here, from the Quadro's own path, so the board, the
   admin route and the MCP share it), `audit`, `http` (`marketplaceHttp`), `enqueue`,
   `clock`, `logger`. Move any atomic work out of `onAccepted`.
2. **`normalizeIfoodEvent(payload, options)`** now takes `{ missingStreetNumber }` (the pack's
   `IFOOD_ADAPTER_COPY_PT_BR.missingStreetNumber` is "s/n"); the host's tests that call it with
   one argument change. Better: call `engine.normalize("IFOOD", payload)`.
3. **The webhook's refusals are JSON:** `401 {error:"unauthorized"}`, `404
   {error:"unknown_provider"}`, `400 {error:"invalid_json"}`; an unreadable payload answers
   `{received:true, ignored:"unrecognized_payload"}` (was "unrecognized payload").
4. **`GET …/menu-links?unmapped=`** is true only for `"true"` (the host's `z.coerce.boolean`
   read `"false"` as true).
5. **The tools and routes are bulk:** `saveMarketplaceIntegration`, `deleteMarketplaceIntegration`,
   `setMarketplaceMenuLink` and `decideMarketplaceOrder` (and `POST …/acceptances/:orderId`)
   become `upsertMarketplaceIntegrations` (delete is now `operation: "archive"`),
   `upsertMarketplaceMenuLinks` and `decideMarketplaceOrders` (`POST …/acceptances` with a
   `decisions` list). Update the admin SPA's calls, the MCP tool groups and the policy table.
6. **The guards move to permissions:** connections and SKU links take `marketplace:manage`
   (was `requireTenantAdminBySlug` / `products:*`), the queue and the decision
   `marketplace:decide` (was `orders:read:all` / `requireTenantAdminBySlug`). Grant BOTH to the
   roles that hold store administration today (OWNER, ADMIN) to keep today's access, and
   `marketplace:decide` to whoever reads the queue today.
7. **`decide` returns a union** (`decided`, `stale` with a reason, `invalidReason`,
   `refusedByHost`), not `AcceptanceOutcome | null`; `recordStoreCancellation` replaces calling
   `onRefused` after the PATCH cancel.
8. **The provider is a string** checked by `engine.knows(provider)`;
   `MARKETPLACE_PROVIDERS`/`isMarketplaceProvider` are gone.
9. **Drop the origin host's unmerged `20261111190000_marketplace_outbound`** migration: this
   package's `20261111200000_marketplace_engine` adds the same columns (and more), and
   deployed in the other order the plain `ADD COLUMN` of 190000 would fail.
10. **Stop syncing the predecessor's own migration copies over this package's**: keep the
    host's applied `20260814140000`/`20261105120000` files as they are.
11. **Orders accepted before adoption are stamped confirmed, never re-sent.** The migration's
    first run over the predecessor's table sets `confirmed_at = acknowledged_at` on every row
    already `ACCEPTED`, because nothing confirmed through an API before this engine; the outbound
    sweep then owes none of them. Fresh databases and replays stamp nothing.
12. **`order.create` and `audit.record` receive a transaction client** (last argument): write
    the host's order and the audit line through it, so they commit with the engine's own rows.
    Everything `create` writes goes through that client, the buyer record and the order
    number included, never the host's global client inside the callback: on PGlite, which
    runs one transaction at a time, a write on the global client hangs the ingest, and on
    Postgres a rolled-back ingest would leave an orphan order and a burnt order number.
13. **Request first, cancel on confirm (1.1, FUT-4758) — opt in by binding
    `order.onCancellationConfirmed`.** Without it, 1.0.0's behaviour holds, with two
    differences, both harmless to a host whose cancel is idempotent: a marketplace that
    confirms in its response now also moves the row to REJECTED and calls
    `onRefused(…, "CANCELLED")` (1.0.0 called nothing there), and the event path keeps an
    accepted order's `acknowledged_at` instead of overwriting it with the cancel time. With it, the
    store's refusals and cancels (`decide` REJECT and `recordStoreCancellation`) only request
    the cancellation; the order keeps its status until the marketplace confirms, and the
    acceptance clock leaves an order with a waiting request alone (the request's window ends
    it first). To opt in:
    - bind `order.onCancellationConfirmed` (run the ordinary cancel there);
    - call `recordStoreCancellation` from every cancel entry point, without cancelling;
    - draw `orderStates(…).cancellation` PENDING/REQUESTED as "waiting for the marketplace";
    - keep the store's own reason (its loss record, who asked) for that cancel: the engine
      carries only the marketplace's code;
    - bind `order.onCancellationFailed` (REFUSED or TIMEOUT: the order stays, show the app link);
    - expect the answer window: a request still waiting past it (delivered or not) ends TIMEOUT;
    - run migration `20261112120000_marketplace_cancellation_failure` (one nullable column,
      its CHECK and an index), through the host's plugin-migration sync like the first.

14. **Catalogue publishing (1.2, FUT-4768) — opt in by binding `catalogue`.** Nothing
    changes for a host that does not. To offer the product page's marketplace switches:
    - run migration `20261113120000_marketplace_catalogue` (one new table, additive) and
      re-sync the partial (`prisma:sync-marketplace`), so `db` has the
      `marketplaceCataloguePublication` and `marketplaceCatalogueCategory` delegates;
    - bind `catalogue.items` (the product → item mapping) and `catalogue.image`;
    - let the `http` port send `PATCH`;
    - run the `marketplace.catalogue` job (it arrives with the jobs capability);
    - gate `publish`/`withdraw` with `marketplace:manage`, and show a marketplace whose
      `catalogueMode` is null as not publishable (Rappi, today);
    - for 99Food, serve `catalogueDocument` inside Open Delivery's `GET /v1/merchant`
      (the route 99Food pulls) and register that route with 99Food at onboarding.

## 5. The database

The partial names no host table: `client_id`, `order_id` and `menu_item_id`
are by-value scalars. A host that wants referential integrity adds, in its own
migration:

- `marketplace_*.client_id → <tenants>(id) ON DELETE CASCADE`
- `marketplace_acceptances.order_id → <orders>(id) ON DELETE CASCADE`
- `marketplace_menu_links.menu_item_id → <catalog>(id) ON DELETE SET NULL`

`20261113120000_marketplace_catalogue` (1.2) adds `marketplace_catalogue_publications`:
one row per (store, marketplace, product), its five states, its failed action and its
prices CHECKed, `product_id` by value; and `marketplace_catalogue_categories`, a push
marketplace's category id per (store, marketplace, category name), created once. A host that wants it adds
`marketplace_catalogue_publications.product_id → <catalog>(id) ON DELETE CASCADE`.

The migrations are replay-safe. `20261112120000_marketplace_cancellation_failure`
(1.1) adds `marketplace_acceptances.cancellation_failure_reason` (REFUSED or
TIMEOUT, CHECKed), and a PARTIAL index the expiry of waiting requests reads
(`marketplace_acceptances_cancellation_waiting_idx`, `WHERE cancellation_status IN
('PENDING','REQUESTED')`). Prisma cannot express a partial index, so it is SQL-only and
the partial declares none: a host that diffs its schema against its database ignores it,
as it already does for the first migration's partial indexes.

The migration `20261111200000_marketplace_engine` is replay-safe. On a host
that already has the predecessor's tables it adds the outbound columns
(including `cancellation_offending_skus`, `cancellation_requested_at`,
`preparation_minutes`), the order's `line_skus`, `delivered_by` and the
connection's `archived_at`, keeps the host's foreign keys, and replaces the
closed provider lists (`*_provider_valid`) with a shape check, so a new
adapter is never a migration.

## 6. What stays the host's

The stock draw at the acceptance, the settlement effects, the board's and the
order screen's UI, the cancel route itself, the HTTP client's timeout and CA,
the jobs runtime and its leases, which roles hold the two permissions, and
every sentence a person reads.
