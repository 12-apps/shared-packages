# @12-apps/discounts

The discount / promotion domain, extracted from its origin host and made
host-agnostic: an **evaluator** that decides what a cart actually pays, and an
**admin CRUD surface** shipped as wiring-contract route descriptors over a
store port.

No database, no framework, no clock, and **no baked user copy**.

## What is in the box

| entry | what it is |
|---|---|
| `@12-apps/discounts` | the engine: `evaluateDiscounts`, `previewItemDiscount`, `comboOffersForItem`, `matchCombo`, the vocabulary, the rejection copy port |
| `@12-apps/discounts/pt-BR` | the pt-BR rejection pack, imported by hand |
| `@12-apps/discounts/server` | `createApiDiscounts`, the `DiscountStore` port, the permission contribution, the MCP tools |
| `@12-apps/discounts/server/pt-BR` | the pt-BR pack for the admin surface's sentences |
| `@12-apps/discounts/manifest` | the shared wiring manifest |
| `@12-apps/discounts/manifest/server` | the `http` capability |

## The model

A discount is a **percentage** (basis points, 1..10000) or a **fixed amount**
(integer cents), scoped to the whole **order**, to **categories**, to specific
**items**, or to a **combo**, fired either **automatically** when its conditions
hold or by the buyer typing a **coupon code**. Money is integer cents
throughout; a percentage is basis points, so "12,5%" needs no decimal column
anywhere.

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

## Combos

A **combo** is a discount scoped to a group the merchant defines: a list of
**slots**, each naming products and/or categories and how many units it needs.
The evaluator matches those slots against the cart's **units**, repeatedly, and
prices each match.

```ts
// "1 pipoca grande + 2 refrigerantes por R$ 25,00"
{
  scope: "COMBO",
  type: "BUNDLE_PRICE",
  bundlePriceCents: 2_500,
  comboRequirements: [
    { menuItemIds: ["popcorn-lg"], categoryIds: [], quantity: 1 },
    { menuItemIds: [], categoryIds: ["drinks"], quantity: 2 },
  ],
}

// "3 hambúrgueres pelo preço de 2" — one slot of three, the cheapest one free
{
  scope: "COMBO",
  type: "FREE_UNITS",
  freeUnits: 1,
  comboRequirements: [{ menuItemIds: ["burger"], categoryIds: [], quantity: 3 }],
}
```

Four rewards, and the type picks which column is read:

| type | column | the group's discount |
|---|---|---|
| `BUNDLE_PRICE` | `bundlePriceCents` | its value above the bundle price |
| `FREE_UNITS` | `freeUnits` | its N cheapest units |
| `PERCENTAGE` | `percentOffBp` | that rate off it |
| `FIXED_AMOUNT` | `amountOffCents` | that many cents off it |

The last two are the ordinary columns, doing the ordinary thing against a group
instead of against a line. The first two only mean something against a matched
group, so they are legal at `COMBO` scope and nowhere else — the write path
refuses the combination and a host's CHECK constraint should too.

Every reward is **per application**. A cart of seven burgers takes "3 for the
price of 2" twice and pays full price for the seventh; `maxComboApplications`
caps that when a merchant wants it capped.

Four decisions worth knowing before you wire it up:

- **Combos run first.** The pass order is `COMBO → ITEM → CATEGORY → ORDER`.
- **What a combo consumed is opaque to `ITEM` and `CATEGORY`.** A combo price is
  a number the merchant set deliberately; a component-targeted promotion
  stacking on top of it is a double discount. So a line of five burgers with
  three inside a combo offers exactly two burgers, at full price, to an
  item-level promotion. **`ORDER` is not blocked** and applies to the combo
  price, because an order-wide promise is about the basket, not the components.
- **One pool.** Every combo draws from the same units, so two combos can never
  both be paid for the same burger. The richer one claims them first.
- **A combo is not badged.** Its price does not exist until the other components
  are in the cart, so `previewItemDiscount` skips it. `comboOffersForItem` is
  what a card can honestly show instead — that the item takes part in a combo,
  as a label rather than a price.

A combo the cart cannot assemble is rejected `COMBO_NOT_MATCHED`, which is the
one rejection reason this package refuses to coarsen: a buyer one soda short
can finish the combo, and telling them so is the difference between a dead end
and a sale.

### What a combo is NOT, here

It is a **pricing rule**, not a catalog entity. There is no `Combo` product with
its own menu card, its own single cart line and its own order snapshot — that is
a host table with foreign keys into the host's own catalog, which is exactly why
this package declares no `db` capability. What travels is the rule; the sellable
bundle, if a host wants one, stays the host's.

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

Combos add three nullable columns to that table — `bundle_price_cents`,
`free_units`, `max_combo_applications` — and one child table for the slots, each
row carrying a quantity plus its own product and category id lists. `DiscountWrite`
hands a store exactly that: the columns on `scalars`, the slots on
`targets.comboRequirements`, already validated and narrowed to the scope. A host
that does not sell combos adds nothing: the fields are optional on everything
this package asks a host to BUILD (`DiscountRule`, `DiscountRecord`) and
complete on everything it PRODUCES, so adopting the version that introduced them
is a no-op until a `COMBO`-scoped row exists.

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
