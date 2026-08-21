# @12-apps/discounts

The discount / promotion domain, extracted from its origin host and made
host-agnostic: an **evaluator** that decides what a cart actually pays, and an
**admin CRUD surface** shipped as wiring-contract route descriptors over a
store port.

No database, no framework, no clock, and **no baked user copy**.

## What is in the box

| entry | what it is |
|---|---|
| `@12-apps/discounts` | the engine: `evaluateDiscounts`, `previewItemDiscount`, the vocabulary, the rejection copy port |
| `@12-apps/discounts/pt-BR` | the pt-BR rejection pack, imported by hand |
| `@12-apps/discounts/server` | `createApiDiscounts`, the `DiscountStore` port, the permission contribution, the MCP tools |
| `@12-apps/discounts/server/pt-BR` | the pt-BR pack for the admin surface's sentences |
| `@12-apps/discounts/manifest` | the shared wiring manifest |
| `@12-apps/discounts/manifest/server` | the `http` capability |

## The model

A discount is a **percentage** (basis points, 1..10000) or a **fixed amount**
(integer cents), scoped to the whole **order**, to **categories**, or to
specific **items**, fired either **automatically** when its conditions hold or
by the buyer typing a **coupon code**. Money is integer cents throughout; a
percentage is basis points, so "12,5%" needs no decimal column anywhere.

The evaluator is a pure function of `{ lines, rules, couponCode, now }`:

```ts
import { evaluateDiscounts } from "@12-apps/discounts";

const outcome = evaluateDiscounts({ lines, rules, couponCode, now: new Date() });
// outcome.subtotalCents, .discountTotalCents, .totalCents
// outcome.applied[]   — what removed money, frozen for the order snapshot
// outcome.lines[]     — per-line cents removed; Σ equals discountTotalCents
// outcome.rejections[] — only for what the buyer ASKED for, or lost a stack race
```

Three properties it holds to the cent, and the suite pins each:

- `Σ applied[].amountCents === discountTotalCents === Σ lines[].discountCents`;
- narrowest scope first, so an order-wide promo can never give away money an
  item-level promo already removed;
- a discounted order is never worth **less than one cent**. That is a payment
  constraint, not a pricing one — providers reject a zero-amount charge, so an
  order discounted to nothing could never be settled at all. The floor is
  applied *during* allocation, never as a post-hoc trim, which is what keeps
  the sum identity above true.

`previewItemDiscount` answers the other question — what a catalog card should
strike through *before* there is a cart — from the same rules, so a card and a
cart cannot quote different numbers.

## The admin surface

`createApiDiscounts({ store, copy })` returns five `WireRoute` descriptors —
list, read, create, re-state, archive — each **declaring the permission it
needs** (`discounts:read` / `discounts:write`), so a host's coverage gates can
read the policy off the assembled table instead of scanning route files.

```ts
import { createApiDiscounts } from "@12-apps/discounts/server";
import { PT_BR_DISCOUNTS_SERVER_COPY } from "@12-apps/discounts/server/pt-BR";

const { routes } = createApiDiscounts({ store, copy: PT_BR_DISCOUNTS_SERVER_COPY });
```

Or, through the contract:

```ts
import { discountsManifest } from "@12-apps/discounts/manifest";
import { discountsServerManifest } from "@12-apps/discounts/manifest/server";

host.adoptServer({
  manifest: discountsManifest,
  server: discountsServerManifest,
  bindings: { http: { mountPath: "/api/admin/:tenantSlug", config: { store, copy } } },
});
```

Delete is a **soft archive**, and that is a product decision: the orders that
already redeemed a discount keep their snapshot, and its redemption counter
stays readable for reporting.

## What the host still owns

**The database.** A discount's rows relate to a host's own catalog and orders —
targets point at its categories and items, redemptions at its orders and its
buyers — so neither wiring `db` mode qualifies and the manifest declares none.
The host owns the schema, the tenant scoping, the transactions and the
uniqueness conflicts, and answers the `DiscountStore` port. What travels is the
RULE, not the storage.

**Every sentence a human reads.** `DiscountRejectionCopy` (buyer-facing) and
`DiscountsServerCopy` (operator-facing) are required config with **no
defaults** — `createApiDiscounts` throws at construction naming every missing
key. pt-BR packs ship as named exports a host passes by hand, so choosing a
language is a line in the host's diff rather than a silence.

**Who is calling, and whether the plan allows it.** The actor arrives already
resolved (`{ clientId }`); authentication, tenant resolution, RBAC tiers and
plan gates stay where they belong.

**The words on a pill.** The validity filter a promotions grid usually wants —
running / scheduled / ended — compares two nullable columns against "now",
which no `filterableField` expresses, and its values are words a host chose. So
a host extends the advertised list query and reads its own key back out in its
store. See `DiscountListInput`.
