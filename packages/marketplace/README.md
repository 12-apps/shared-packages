# @12-apps/marketplace

One integration engine for every marketplace a store sells through. Each
marketplace is an **adapter** on that engine, shipped inside this package at
its own subpath (`@12-apps/marketplace/ifood`, `@12-apps/marketplace/99food`,
`@12-apps/marketplace/rappi`).

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
| **Decisions** | Many at once, all-or-nothing: accept (with the person's admission and a preparation time), or refuse with a reason code validated against the adapter's own list and, for a reason that needs them, the order's offending SKUs. The host admits each decision inside the claim's transaction (`order.admit`: the stock ask, the draw). For a host that binds `onCancellationConfirmed`, the store's refusal or cancel is a REQUEST: only the request moves, the order stays as it was until the marketplace answers, and the host hears the answer through the optional `onCancellationConfirmed` / `onCancellationFailed` (REFUSED or TIMEOUT). `suggestReason` preselects the item-unavailable reason when the host says stock is short. |
| **SKU map** | External SKU → host catalog id, every SKU ever seen a row; mapping checks the id is the tenant's. |
| **Integration settings** | Enabled, environment, merchant id, auto-accept, acknowledgement window; credentials sealed as one blob by the host's secrets port, never returned. A connection is archived (reversible, audited), never deleted. |
| **Outbound engine** | The `marketplace.outbound` job: confirm after accept (with the preparation time where the marketplace takes one), cancellation request with the stored reason code and SKUs. 2xx done; a 4xx other than 408/425/429 refused and final; anything else retried until the last attempt, which ends FAILED whatever went wrong. Stamps `confirmed_at`, `confirm_failed_at`, `cancellation_status` (PENDING, REQUESTED, CONFIRMED, FAILED). Idempotent by the row. Queued BEFORE the host's half runs, and the `marketplace.outbound-sweep` job re-queues every call still owed, so nothing is lost. The same sweep fails a request still waiting (never delivered, or delivered and unanswered) as TIMEOUT once past its answer window, and its retries stop (the adapter's `cancellationAnswerWindowMs`, or the engine's `cancellationWindowMs`), so no request waits forever. |
| **Order fetch** | For a marketplace whose events name an order without carrying it (Open Delivery's `CREATED`), the adapter marks the event `orderToFetch`: the webhook records it PENDING and queues `marketplace.fetch-order`, which calls the adapter's `fetchOrder` and ingests through the same ingest path. No request calls out; the reconciliation sweep re-queues a row still owed, and a host that holds the job holds every fetch. |
| **Inbound outcomes** | A marketplace CANCELLED confirms a pending request; CANCELLATION_REQUEST_FAILED marks it FAILED; CONFIRMED is terminal. |
| **Catalogue publishing** | A store turns a product ON or OFF per connected marketplace, with an optional price for that marketplace. One row per (store, marketplace, product): PUBLISHING → PUBLISHED, WITHDRAWING → WITHDRAWN, FAILED with the marketplace's reason. The `marketplace.catalogue` job makes the call; the sweep re-queues what is owed. Push or pull is the adapter's. See [Catalogue publishing](#catalogue-publishing). |
| **Adapter port** | `MarketplaceAdapter`: `normalize`, `readSignature`, `verifySignature`, `cancellationReasons`, `confirm`, `requestCancellation`, `appLink`, `capabilities`, and the optional `fetchOrder` and `catalogue`. |

## Subpaths

| export | what |
|---|---|
| `@12-apps/marketplace` | the engine, the adapter port and registry, every type |
| `@12-apps/marketplace/ifood` | `createIfoodAdapter({ copy })` |
| `@12-apps/marketplace/ifood/pt-BR`, `/en-US` | the iFood adapter's copy packs (reason labels, "no street number") |
| `@12-apps/marketplace/99food` | `createNinetyNineFoodAdapter({ copy, apiBaseUrl, portalUrl })`, provider `NINETY_NINE_FOOD`, on Open Delivery |
| `@12-apps/marketplace/99food/pt-BR`, `/en-US` | the 99Food adapter's copy packs |
| `@12-apps/marketplace/rappi` | `createRappiAdapter({ copy, apiBaseUrl, tokenUrl, portalUrl, amountUnit })`, provider `RAPPI` |
| `@12-apps/marketplace/rappi/pt-BR`, `/en-US` | the Rappi adapter's copy packs |
| `@12-apps/marketplace/server` | `createApiMarketplace` (route descriptors), `MARKETPLACE_JOBS`, `MARKETPLACE_MCP_TOOLS` (six: a read and a bulk write per entity), `MARKETPLACE_PERMISSIONS`, the strict Zod inputs |
| `@12-apps/marketplace/server/pt-BR`, `/en-US` | the routes' copy packs |
| `@12-apps/marketplace/hono` | `marketplaceRouter(config)` — the routes as one Hono router (`hono` is an optional peer) |
| `@12-apps/marketplace/manifest`, `/manifest/server` | the wiring manifests |
| `prisma/marketplace.prisma`, `prisma/migrations/*` | the partial (no host table named) and its replay-safe migration |

## Catalogue publishing

FUT-4768, approved by the owner on 2026-11-12: from a product's page the store
turns the product ON (in that marketplace's catalogue) or OFF (removed) per
connected marketplace, with an optional price for that marketplace that
defaults to the store's and never changes it. What goes out: name, photo,
description, category and the price. The states a host shows: in the
catalogue, "sending…", and refused with the marketplace's reason and a retry.
Why the engine now does this at all: the decision record
[`docs/marketplace/decisions/draft-the-engine-publishes-catalogues.md`](../../docs/marketplace/decisions/draft-the-engine-publishes-catalogues.md).

```ts
engine.catalogueMode(provider);                                  // "push" | "pull" | null (cannot be published to)
await engine.publish({ clientId, provider, productId, priceCents }); // priceCents: absent keeps, null = the store's price
await engine.withdraw({ clientId, provider, productId });
await engine.catalogueState({ clientId, productIds: [productId] });  // every marketplace, one read
await engine.catalogueDocument({ clientId, provider, options: { menuName, currency } }); // pull only: what the host serves
```

| part | what it does |
|---|---|
| **The row** | `marketplace_catalogue_publications`, one per (store, marketplace, product): `status`, the marketplace price (`price_cents`, NULL = the store's), the price last sent, the marketplace's id for the item, the failed action and the marketplace's reason, and when each thing happened. `product_id` is opaque: no host table is read. |
| **States** | `publish` → PUBLISHING → (job) PUBLISHED; `withdraw` → WITHDRAWING → (job) WITHDRAWN; a final refusal, or the last attempt, → FAILED with `failedAction` (PUBLISH / WITHDRAW) and `failureReason` (the marketplace's own words). `publish` or `withdraw` again from FAILED is the retry. |
| **Idempotency** | A run acts only while the row still asks for its action at the instant it read (`requested_at`). A double tap while on its way keeps the same ask and the same dedupe key. A withdraw while publishing wins: the publish run calls nobody, and a publish that LANDS after the withdraw is withdrawn again. A withdraw of a product that never reached the marketplace (a first publish that failed) calls nobody. |
| **The host's product** | Read through the host's `catalogue.items(clientId, productIds)` port when the job sends it, so what goes out is the product as it is then; `catalogue.image(url)` hands over a photo's bytes for a marketplace that takes an upload. |
| **Push** | `catalogue.publishItem` / `withdrawItem`: the adapter writes ONE item. The engine hands it a stable reference (the row's id), so an adapter that must invent the marketplace's id derives it (`stableUuid`) and a retry never creates a second item. |
| **Pull** | `catalogue.menuDocument` builds the marketplace's menu document from every item ON (PUBLISHING or PUBLISHED); the host serves it. `notifyMenuChanged` tells the marketplace to read it again; PUBLISHED / WITHDRAWN once it took the notice. |
| **Sweep** | The `marketplace.outbound-sweep` pass re-queues a row still PUBLISHING or WITHDRAWING after 10 minutes, and FAILS one 24 hours old, so no switch says "sending" forever. |

### What each marketplace offers, from its public documentation

Read 2026-11-13. CONFIRMED: read on the page linked. ESTIMATED: not stated
there, chosen in the adapter's code and marked so beside it.

**iFood — push, Catalog API v2.0** (`src/ifood/catalogue.ts`)

| fact | status |
|---|---|
| Base `https://merchant-api.ifood.com.br/catalog/v2.0/merchants/{merchantId}/…`; bearer token from the same OAuth grant as orders | CONFIRMED — [Introduction](https://developer.ifood.com.br/en-US/docs/food/guides/modules/catalog/introduction) |
| Hierarchy catalog → context (DEFAULT delivery, WHITELABEL, INDOOR) → category → item → products / option groups / options; each level has its own status | CONFIRMED — [Fundamentals](https://developer.ifood.com.br/en-US/docs/food/guides/modules/catalog/fundamentals) |
| `GET /catalogs`; `GET /categories` (`?include_items=true`); `POST /categories` `{ name, status, template: "DEFAULT" }` → `{ id, … }` | CONFIRMED — [Endpoints](https://developer.ifood.com.br/en-US/docs/food/guides/modules/catalog/endpoints) |
| `PUT /items` with `item`, `products`, `optionGroups`, `options` (all four always sent) creates or REPLACES the whole item; the item appears at once (synchronous) | CONFIRMED — Introduction, Endpoints |
| `item.id` and `products[].id` are UUID v4 the software generates (another shape answers 404); `externalCode` is the software's code, unique per merchant (409 when reused); `status` AVAILABLE / UNAVAILABLE; `price` `{ value, originalValue? }` in the major unit | CONFIRMED — Fundamentals, Introduction |
| `PATCH /items/status` `{ itemId, status }` and `PATCH /items/price` `{ itemId, price }`, synchronous; the batch forms (`/products/status`, `/products/price`) answer a `batchId` and run asynchronously | CONFIRMED — Endpoints, [Errors](https://developer.ifood.com.br/en-US/docs/food/guides/modules/catalog/errors-and-troubleshooting) |
| `POST /image/upload` `{ image: "data:image/png;base64,…" }` → `{ imagePath }`; jpg/jpeg/png, at most 5 MB (413 above) | CONFIRMED — Endpoints, Errors |
| Errors: 400 malformed, 401 token, 403 module not contracted (the catalogue module must be enabled for the app), 404, 409 `externalCode` reused, 422 business rule, 429 rate limit, 500; do not retry 4xx but 429 | CONFIRMED — Errors |
| Rate limits: 3000 req/min for `PUT /items` and the category calls, 5000 req/min for the item status and price PATCHes | CONFIRMED — [Rate limit](https://developer.ifood.com.br/en-US/docs/getting-started/documentation/rate-limit/) (it spells the PATCH paths `/item/status`, singular, where Endpoints spells `/items/status`; the adapter uses Endpoints') |
| The category list answers an array of `{ id, name }` | ESTIMATED |
| `item.productId` names the item's product, and `products[].imagePath` carries the uploaded photo | ESTIMATED (the pages read show neither field on a full example; the Errors page names `imagePath` as what the item carries) |
| OFF is the item paused (`UNAVAILABLE`): no item delete is listed on the Endpoints page; a paused item is not shown in the app | ESTIMATED as the meaning of "removed"; the call is CONFIRMED |
| A 404 on the withdraw means the item is already out | ESTIMATED |
| A publish lands in the DEFAULT (delivery) context only; no `contextModifiers` are sent | choice |

**99Food — pull, Open Delivery v1.7.1** (`src/99food/catalogue.ts`)

| fact | status |
|---|---|
| The SOFTWARE SERVICE (the host) serves `GET /v1/merchant`; the ordering application (99Food) pulls it. `Merchant` requires `lastUpdate`, `TTL` (500–86400 s: pulled again when it runs out), `id`, `status`, `basicInfo`, `services`, `items`, `menus`, `categories`, `itemOffers` | CONFIRMED — [openapi.yaml](https://abrasel-nacional.github.io/opendelivery/openapi.yaml), `getMerchant`, `Merchant` |
| `Menu { id, name, externalCode, categoryId[] }`; `Category { id (uuid), index, name, externalCode, status, itemOfferId[] }`; `Item { id (uuid), name, description, externalCode, unit, status?, image? { URL } }`; `ItemOffer { id, itemId, index, price { value, originalValue, currency } }` — the price lives on the offer | CONFIRMED — same, the schemas |
| `POST /v1/merchantUpdate` on 99Food, sent with an EMPTY body, makes it read `GET /v1/merchant` again; 200 or 204 | CONFIRMED — same, operation `menuUpdated` |
| `GET /v1/merchantStatus?merchantId=` answers the last read's outcome (SUCCESS, PROCESSING, FAIL) | CONFIRMED — same; not called by this adapter (a later check) |
| The notification's path: the prose and the route table say `/v1/merchantUpdate`, the path key says `/v1/menuUpdated`; the adapter sends the former | ESTIMATED |
| `X-App-MerchantId` on the notification (the operation lists no header) | ESTIMATED |
| A product in the document is PUBLISHED once 99Food took the notification, not once it read the menu | choice |

**Rappi — not supported** (no `catalogue` on the adapter)

| fact | status |
|---|---|
| The menu is written whole: `POST https://{COUNTRY_DOMAIN}/api/v2/restaurants-integrations-public-api/menu` with `{ storeId, items[] }` (`name`, `description`, `imageUrl`, `price`, `sku`, `category`, `children` toppings), parent stores only | CONFIRMED — [Managing Store Menus](https://dev-portal.rappi.com/en/managing-store-menus/) |
| A sent menu goes to approval ("Menu updated and ready to be validated"), its status at `GET …/menu/approved/{storeId}`; while one is in approval, every further menu of the store is IGNORED; a rejection is a 400 with each failed validation | CONFIRMED — same |
| Availability by SKU, `PUT …/availability/stores/items` `[{ store_integration_id, items: { turn_on, turn_off } }]`, only turns items Rappi already has on or off | CONFIRMED — [Managing Availability](https://dev-portal.rappi.com/en/managing-availability/) (the page's URL line says `/token`, its heading `availability/stores/items`) |

So a per-product switch cannot be built honestly on Rappi's public API: each
publish would REPLACE the store's whole Rappi menu with the products switched
on here (wiping what the store keeps on Rappi's portal), and a second switch
inside the approval window would be dropped while the row said "in the
catalogue". The capability is absent, `engine.catalogueMode("RAPPI")` is null,
and the host shows Rappi as not publishable. Supporting it later is a pull-like
whole-menu mode over the same rows, once a store accepts that its Rappi menu
is exactly what it switches on here.

## iFood is unverified

iFood's developer portal refused our reader, so the iFood adapter's ORDER URLs,
body fields and reason codes come from the portal's search snippets
(2026-11-11). (Its Catalog module's pages were read whole on 2026-11-13: see
[Catalogue publishing](#catalogue-publishing).)
They live only in `src/ifood/outbound.ts` and `src/ifood/copy.ts`, whose
headers say so, so the homologation run corrects two files. Tests never reach
iFood: the HTTP client is the host's port.

## 99Food, on Open Delivery

99Food completed Open Delivery (Abrasel) adherence, so its adapter speaks
[Open Delivery v1.7.1](https://abrasel-nacional.github.io/opendelivery/openapi.yaml)
and is registered as `NINETY_NINE_FOOD`. Its webhook is the engine's one
route, `POST /webhooks/marketplace/:tenantSlug/NINETY_NINE_FOOD`.

```ts
import { createNinetyNineFoodAdapter } from "@12-apps/marketplace/99food";
import { NINETY_NINE_FOOD_ADAPTER_COPY_PT_BR } from "@12-apps/marketplace/99food/pt-BR";

createNinetyNineFoodAdapter({
  copy: NINETY_NINE_FOOD_ADAPTER_COPY_PT_BR,
  apiBaseUrl: { SANDBOX: "https://…", PRODUCTION: "https://…" }, // from 99Food, at partner onboarding
  portalUrl: "https://…",                                        // the merchant portal
});
```

| part | from the spec |
|---|---|
| Webhook | `X-App-Signature`: lowercase hex HMAC-SHA256 of the body, keyed by the CLIENT SECRET. A connection stores that same value as its `webhookSecret`, and a connection without one REFUSES every delivery (the key exists from the moment the store connects). The merchant is the `X-App-MerchantId` header; the engine attributes by the URL's store slug. |
| Merchant id | A connection's `externalMerchantId` for 99Food is the Open Delivery **merchant id** — the spec's `Merchant.id`, which the merchant's Software Service (the host) generates and registers with 99Food, and which 99Food echoes as `X-App-MerchantId` and `Order.merchant.id`. It is NOT 99Food's own internal id for the store shown on its portal. A fetched order whose `merchant.id` differs is refused and its inbox row settled FAILED, so correcting the connection's id lets the reconciliation sweep fetch it again within the attempt bound. |
| Events | `CREATED` → fetch the order (`GET /v1/orders/{orderId}`); `CANCELLED` → cancelled (answers a pending request; one that outruns the fetch leaves a marker, and the fetch then ingests nothing — or, when it lands while the ingest is being written, cancels the order it just wrote); `CANCELLATION_REQUEST_DENIED` → the request FAILED. The rest (`CONFIRMED`, `CANCELLATION_REQUESTED`, `ORDER_CANCELLATION_REQUEST`, `DISPATCHED`…) are recorded and IGNORED. |
| Auth | `POST /oauth/token`, form-encoded `client_credentials`; the token is cached per process. |
| Confirm | `POST /v1/orders/{orderId}/confirm` with `OrderConfirmed` (`orderExternalCode` = the host's order id, `createdAt`, `preparationTime` when stated). Every 422 is a refusal: the store sees "não confirmou" and the app link. The spec's 422 cannot tell a duplicate from a cancelled order, so a retried confirm whose first answer was lost shows that same harmless alarm. |
| Cancel | `POST /v1/orders/{orderId}/requestCancellation` with `{ reason, code, mode }`; the eleven merchant codes are the adapter's static reasons. 202, then an event. A 422 whose `cancellationStatus` is `CANCELLED` is done. |
| Order | `total.orderAmount` is the gross total. The `Order` states no commission, so `commissionCents` is null. An item's lines always add up to its `totalPrice`: a total that does not divide by the quantity is split into (q−1) units at the floor and one carrying the remainder, same SKU. Options and instructions go into the line's note; a weighed item is one line at its total. The acceptance deadline counts from the event's arrival; the liveness stamp and an auto-accept's time are the ingest's own. |

The fixtures are the spec's own examples (`src/99food/__tests__/fixtures.ts`).
`src/99food/__tests__/engine.test.ts` drives the engine through the adapter
end to end: event, fetch, ingest, aceite, confirm, cancel, the answer.

**ESTIMATED, to be checked live once 99Food grants partner access:**

- the base URLs and the portal: not public, so they are required config;
- `OrderConfirmed.createdAt` is sent as the moment of the confirmation (the
  spec's description of that field is copied from the order's);
- the cancellation answer window, 5 minutes (the spec names none);
- a token with no `expires_in` lives an hour (the field is optional);
- `outOfStockItems` is not sent: the spec wants item uuids there, and the
  engine keeps the marketplace's SKUs (`externalCode`);
- with no `totalPrice`, a line is `unitPrice × quantity + optionsPrice` (options added once: the spec calls it a line figure);
- with no `externalCode`, a line keys on the item id, which may be per order (then each such order adds an unmapped SKU row);
- that 99Food sends every event by webhook (Open Delivery also allows
  polling, which this adapter does not do).

## Rappi, from its public developer portal

Built now (owner, 2026-11-11) from what [dev-portal.rappi.com](https://dev-portal.rappi.com)
shows publicly (managing-user-orders, api-reference/orders, webhook-events,
authentication-process, read 2026-11-13), to be confirmed against Rappi's
sandbox once Rappi's account manager opens it. Registered as `RAPPI`; its
webhooks are the engine's one route, `POST /webhooks/marketplace/:tenantSlug/RAPPI`.

```ts
import { createRappiAdapter } from "@12-apps/marketplace/rappi";
import { RAPPI_ADAPTER_COPY_PT_BR } from "@12-apps/marketplace/rappi/pt-BR";

createRappiAdapter({
  copy: RAPPI_ADAPTER_COPY_PT_BR,
  apiBaseUrl: { SANDBOX: "https://…", PRODUCTION: "https://…" }, // https://{COUNTRY_DOMAIN}/api/v2/restaurants-integrations-public-api
  tokenUrl: { SANDBOX: "https://…", PRODUCTION: "https://…" },   // https://{NEW_DOMAIN}/restaurants/auth/v1/token/login/integrations
  portalUrl: "https://…",                                         // the partner portal
  amountUnit: "MINOR_UNITS",                                      // or "MAJOR_UNITS": how Rappi states money here
});
```

| part | from the portal |
|---|---|
| Webhook | Register `NEW_ORDER` and `ORDER_EVENT_CANCEL` (each its own subscription, both pointing at this one URL). `Rappi-Signature: t=<timestamp>,sign=<signature>`, HMAC-SHA256 of `<t>.<raw body>` keyed by the webhook's secret. A connection stores that secret as its `webhookSecret`, and a connection without one REFUSES every delivery. |
| Events | Rappi's bodies do not name their event, so the adapter reads the shape. An `order_detail` is `NEW_ORDER` → ingested (with `action: "scheduled"` / `"cancelled"`, the two scheduled notices → IGNORED). `{ event, order_id, store_id }` naming a cancellation (`canceled_with_charge`) → cancelled. `ORDER_OTHER_EVENT` (it carries `event_time`) → IGNORED. PING, menu and store events name no order and are acknowledged 200 and dropped. |
| Merchant id | A connection's `externalMerchantId` for Rappi is **Rappi's store id**: `store.internal_id` on `NEW_ORDER`, `store_id` on every other event. A `NEW_ORDER` naming another store is settled FAILED (so the reconciliation sweep ingests it once the id is corrected) and the webhook answers 500. |
| Auth | `POST {tokenUrl}` (the portal's `https://{NEW_DOMAIN}/restaurants/auth/v1/token/login/integrations`), JSON `{ client_id, client_secret }` → `access_token`, valid one week; sent as `x-authorization: Bearer <token>`; cached per process. |
| Take (the confirm) | `PUT {apiBaseUrl}/orders/{orderId}/take/{cookingTime}` (the portal's base is `https://{COUNTRY_DOMAIN}/api/v2/restaurants-integrations-public-api`), the store's preparation minutes (`take/` keeps the order's own). 400 "Invalid state transition" and 404 are refusals: "não confirmou" and the app link. |
| Reject (the cancel) | `PUT …/orders/{orderId}/reject` with `{ reason, cancel_type, items_skus }`: one of the portal's six `cancel_type`s, the three item ones requiring the offending SKUs. Only from SENT. The 200 IS the outcome (`asyncCancellationOutcome: false`): CONFIRMED at once. Every refused answer is a refusal (FAILED, the portal link). |
| Cancel after take | No public endpoint: `cancelAfterAccept: false`, so the store's cancel of a taken order is FAILED at once and opens the partner portal (`appLink`; Rappi names no per-order link). |
| Windows | Rappi gives a SENT order 6 minutes to be taken or rejected before its own TIMEOUT, so a reject still waiting 6 minutes after it was asked is failed as TIMEOUT (`cancellationAnswerWindowMs`). Rappi counts from the order's arrival and the engine from the request, so a reject asked late may still be sent after Rappi's TIMEOUT and come back 400 (FAILED, the portal link). A connection's acknowledgement window should be at most 360 s. |
| Order | `totals.total_order`, "the total amount that the restaurant receives", is the total; Rappi states no commission (`commissionCents` null). A line is an item at `price` plus its subitems, `× quantity`, so its rows add up exactly to it; subitems and comments go into the note; an item with no `sku` keys on Rappi's item id. `delivery` is Rappi's courier, `marketplace` the store's own, `pickup` a take-out. |

The fixtures are the portal's own examples (`src/rappi/__tests__/fixtures.ts`).
`src/rappi/__tests__/engine.test.ts` drives the engine through the adapter end
to end: webhook, ingest, aceite, take, reject, Rappi's cancel, and R3-N2.

**ESTIMATED, to be checked against the Rappi sandbox (api.dev.rappi.com):**

- the orders API's base and the token URL per environment, and the portal:
  Rappi names its domains by country, so they are required config (whole
  URLs, path included: the paths name the origin application's own noun);
- how money is stated: integers with no unit in the portal; `amountUnit` is
  required config (`MINOR_UNITS` cents, `MAJOR_UNITS` whole units);
- that the `NEW_ORDER` body is ONE `GET orders` element (the portal says "the
  same information" and shows no example);
- telling `ORDER_EVENT_CANCEL` from `ORDER_OTHER_EVENT`: no `event_time` or
  `additional_information`, and `cancel` in the `event` name; anything else is
  recorded and IGNORED, never a cancellation;
- the signature digest is lowercase hex (the example is 64 hex characters); no
  timestamp tolerance is applied (the portal states none; a replay is an inbox
  duplicate);
- the token answer's shape beyond `access_token`: an `expires_in` is read when
  present, else the portal's one week;
- a subitem's `price × quantity` is per unit of its item;
- an offending item with no `sku` is sent in `items_skus` under Rappi's item
  id, where the portal wants `items_ids`;
- no `PING` answer: the route answers `{ received: true }`, not Rappi's
  `{ "status": "OK" }`, so do not subscribe `PING` until the host answers it;
- that Rappi sends every order by webhook: `GET orders` / `orders/status/sent`
  polling is not done by this adapter;
- that Rappi serves `…/take/` with an empty cooking-time segment (the guide's
  spelling) when the store states no preparation time;
- the reject window counted from the request, where Rappi counts from the
  order's arrival (see Windows);
- that the 500 a merchant mismatch answers is harmless: Rappi redelivers, the
  redelivery is an inbox duplicate answered 200; whether Rappi throttles or
  disables a webhook after repeated 500s is not public.

Out of scope: the merchant check applies to the NEW_ORDER body only. An
`ORDER_EVENT_CANCEL` naming another `store_id` under this connection's secret
still cancels a matching order id: the signature binds the connection's own
secret, and judging event merchants in the engine would change iFood's path.

### A late synchronous answer (R3-N2)

A synchronous marketplace answers a cancellation in the response. When the
outbound sweep times a request out while the call is still in flight, the
store may accept the order before the answer lands. The accept clears the
request but keeps its `cancellation_requested_at` as a TOMBSTONE, and the job
matches a status-less row of a STILL ACCEPTED order carrying the same
instant: a late "rejected" to the call in flight still moves the order to
REJECTED (CONFIRMED) and tells the host `onCancellationConfirmed`. A late
refusal matches nothing and leaves the accepted order as it is; and once the
marketplace's own cancel event has rejected the order (telling the host), the
tombstone answers nothing more, so the host is told once.

What it does NOT cover: a call Rappi APPLIED but answered with a 5xx or not at
all. Its retry runs after the store's accept, finds no request and sends
nothing, so the order stays ACCEPTED here while cancelled on Rappi. The take
the accept queued is then answered 400, so the order shows "não confirmou"
with the portal link and a person settles it there.
