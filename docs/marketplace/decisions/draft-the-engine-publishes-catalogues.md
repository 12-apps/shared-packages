# Draft — The engine publishes the store's products to a marketplace's catalogue

**Status:** proposed (numbered on merge)
**Scope:** `packages/marketplace` — the adapter port (`catalogue`), the catalogue publication, the `marketplace.catalogue` job, the iFood and 99Food adapters
**Ticket:** FUT-4768 (the engine half; the host's product page is a separate delivery)
**Amends:** [0001 — One marketplace engine; each marketplace is an adapter](./0001-one-engine-an-adapter-per-marketplace.md)

---

## Decision

The engine was ingest-only for the menu: orders came in, the SKU map tied a
marketplace's SKUs to the host's products, and nothing about the menu went
out. That position is reversed. The owner (2026-11-11, translated): "besides
that, on the product page it should be possible to remove something from the
iFood/Rappi/etc. catalogue, or add one that is not there". The approved screen
(2026-11-12): one switch per connected marketplace on the product's page, ON
meaning the product is in that marketplace's catalogue and OFF removed, with an
optional price per marketplace that starts as the store's and never changes it;
what goes out is the name, the photo, the description, the category and the
price; the states shown are "in the catalogue", "sending…" and "refused" with
the marketplace's reason and a retry.

The owner's rule binds it: "the integration engine must be the same for all
integrations: iFood, Rappi, 99. Only an adapter is made for each one."

So:

1. **The catalogue is an OPTIONAL capability of the adapter port**,
   `catalogue`, in one of two modes, and the engine reads the mode, never the
   provider:
   - **push** — `publishItem` / `withdrawItem` write ONE item to the
     marketplace (iFood's Catalog API v2.0);
   - **pull** — the marketplace reads the menu from the store's software
     (Open Delivery, which 99Food implements): `menuDocument` builds the menu
     the host serves, `notifyMenuChanged` tells the marketplace to read it again.
   A marketplace whose adapter states none cannot be published to, and the
   host says so (`catalogueMode` null).
2. **One row per (store, marketplace, product)** in the engine's own table,
   with the mechanism's states: PUBLISHING → PUBLISHED, WITHDRAWING →
   WITHDRAWN, FAILED with the action and a failure CODE the host words (the
   marketplace's own words kept beside a refusal only; the engine writes no
   sentence a person reads). The price for the marketplace lives on the row
   (NULL: the store's), and so does the photo the marketplace holds.
   A push marketplace's category id is stored per (connection, name) and its
   creation claimed by one publish at a time, so a new category is created
   once. A publish that succeeds maps the SKU the marketplace's orders will
   carry to the product.
3. **Nothing calls a marketplace inline.** `publish` and `withdraw` stamp and
   queue `marketplace.catalogue`; the job makes the call with the outbound
   rules every other call follows (2xx done, a final 4xx FAILED, anything else
   retried until the last attempt), idempotent by the row and the instant it
   was asked; the outbound sweep re-queues a row still owed and fails one a day
   old.
4. **The engine never reads a host table.** The host maps its product into the
   item shape through a port (`catalogue.items`), read when the job sends, and
   hands over a photo's bytes (`catalogue.image`) for a marketplace that takes
   an upload.

## Why each part is shaped this way

**Two modes, not one.** iFood is written to; Open Delivery is read from — the
standard makes the software serve `GET /v1/merchant` and the marketplace pull
it. Forcing pull into push (or the reverse) would put a 99Food branch in the
engine; as two shapes of one capability, both are an adapter's.

**The row's states are the screen's states.** PUBLISHING and WITHDRAWING are
"sending…", PUBLISHED "in the catalogue", FAILED "refused, with the reason".
The host draws them without knowing the marketplace.

**A stable reference per publication.** iFood wants item ids the software
invents, and a lost answer must not make a second item, so the engine hands
the adapter the row's id and the adapter derives the marketplace's ids from it
(`stableUuid`).

**The store's last tap wins.** The publish run calls nobody once the row asks
for a withdraw, a publish that lands after a withdraw is withdrawn again, a
withdraw that lands after the product was switched back on is followed by a
publish, and a new price is a new ask. A withdraw is always sent (a publish
whose answer was lost may have landed), unless the connection is gone.

## Limits

- **Rappi has no catalogue capability.** Its public menu write replaces the
  store's whole menu, goes through an approval, and ignores further menus while
  one is in approval; its availability endpoints only switch items Rappi
  already has. A per-product switch on that would wipe the store's Rappi menu
  and claim "in the catalogue" for a menu Rappi may have dropped. The README's
  "Catalogue publishing" section has the evidence.
- **One simple item.** No add-ons, combos, pizzas, schedules or per-context
  prices: the approved screen sends name, photo, description, category and
  price.
- **OFF on iFood is a paused item** (`UNAVAILABLE`): the Catalog API's
  endpoints list no item delete. A paused item is not shown in the app, and ON
  makes it available again under the same id.
- **Unverified details are ESTIMATED** in the adapters' code and in the README's
  table, to be confirmed in each marketplace's sandbox.

## Consequences

- A host opts in by binding the `catalogue` port, running the additive
  migration `20261113120000_marketplace_catalogue`, letting its `http` port send
  `PATCH`, and running the `marketplace.catalogue` job (ADOPTING.md §4, item 14).
- For 99Food the host serves the engine's menu document from Open Delivery's
  `GET /v1/merchant`.
- A third marketplace with a catalogue is again an adapter: a `catalogue` in one
  of the two modes. `src/__tests__/catalogue.test.ts` drives fake push and pull
  marketplaces, and one without a catalogue, through the engine with no engine
  change.
