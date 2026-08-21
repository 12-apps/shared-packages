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

`createApiDiscounts({ store, copy, logger })` returns five `WireRoute` descriptors —
list, read, create, re-state, archive — each **declaring the permission it
needs** (`discounts:read` / `discounts:write`), so a host's coverage gates can
read the policy off the assembled table instead of scanning route files.

```ts
import { createApiDiscounts } from "@12-apps/discounts/server";
import { PT_BR_DISCOUNTS_SERVER_COPY } from "@12-apps/discounts/server/pt-BR";

const { routes } = createApiDiscounts({
  store,
  copy: PT_BR_DISCOUNTS_SERVER_COPY,
  logger: createFeatureLogger("discounts"),
});
```

Or, through the contract:

```ts
import { discountsManifest } from "@12-apps/discounts/manifest";
import { discountsServerManifest } from "@12-apps/discounts/manifest/server";

host.adoptServer({
  manifest: discountsManifest,
  server: discountsServerManifest,
  bindings: {
    http: { mountPath: "/api/admin/:tenantSlug", config: { store, copy, logger } },
  },
});
```

Delete is a **soft archive**, and that is a product decision: the orders that
already redeemed a discount keep their snapshot, and its redemption counter
stays readable for reporting.

### Nothing it does is silent

`logger` is **required config, with no default**, for the reason `copy` is: the
default would be a no-op, and a no-op is the exact silence it exists to end.
Every route is wrapped, and there are three outcomes:

| outcome | level | what the line names |
|---|---|---|
| a write that succeeded | `info` | the verb, the discount id, the tenant |
| a refusal this package decided (400 / 404 / 422) | `warn` | the route, the status, and for a 422 the **field** a form paints red |
| anything thrown — and it is re-thrown unchanged | `error` | the route, the tenant, the cause's message |

Every line is a **string**. A host's logger is a Winston child in practice,
whose formatter runs `util.inspect(…, { depth: 5 })` over an extra argument —
which is how a provider error's retained response body, buyer name and CPF
included, reaches a third party. The cause is folded into the sentence instead.
A line names the tenant, the route, the discount id and the field; never the
body, never a coupon code, never a name an operator typed.

The `error` case **re-throws**. A uniqueness clash, a foreign target and a dead
connection are the store's to raise in the host's own error vocabulary; a
surface that folded one into a tidy response would turn a broken database into a
refusal nobody investigates.

A host adopting through `@12-apps/wiring/consumer` already has the logger the
binder built from this package's declared namespace — pass
`assembled.loggers["@12-apps/discounts"]`. A host on no wiring passes any
`createFeatureLogger`-shaped child of its own.

The evaluator is deliberately **not** wired to it. `evaluateCart` is a pure
function called once per cart render; a logger there would file a line per
keystroke on the storefront and would need a logger threaded through a browser
bundle. A rejected coupon is already a `DiscountRejection` in the result, which
is the host's to report if it wants to.

## Letting a host table opt in — `DiscountableCollection`

A discount points at rows this package will never see: a store's categories, its
products, and — the day a host wants it — its suppliers or its shelves. Every
question about them ("which exist", "are they this tenant's", "what is this one
filed under") is answerable only by the host, so the host DECLARES the table:

```ts
const categories: DiscountableCollection = {
  targetType: "CATEGORY",
  slug: "categories",
  label: "Categorias",          // host vocabulary, host language
  nests: true,
  ops: {
    list: (clientId) => …,      // the picker's rows
    ownsAll: (clientId, ids) => …,   // the cross-tenant guard
    parents: (clientId) => …,   // child → parent, for the ancestry walk
  },
};

createApiDiscounts({ store, copy, logger, collections: [categories, products] });
```

Three pieces of hand-written host code collapse into it:

| host code | becomes |
|---|---|
| a per-table cross-tenant `count` before every write | `ops.ownsAll`, run once per write for every dimension |
| the tenant's category tree loaded, and an ancestor walk with a cycle guard | `ops.parents` + the package's own `buildTargetPath` |
| an admin page side-loading two catalogs at `?pageSize=500` to feed a picker | `GET /discounts/targets`, one round trip |

Two things it fixes as a side effect. The ownership check now covers the ids
inside a **combo's slots** — a combo scope drops the top-level target pair and
carries its targets in the slots, so a host checking only the pair let a crafted
combo name another store's products. And the ancestry walk stops being a second
implementation: the host builds the cart lines this package prices, so both
sides now read the same `buildTargetPath`.

The check runs OUTSIDE the store's transaction, and that is enough for the leak
that matters: a catalog row's tenant never changes, so an id owned by this
tenant now cannot belong to another one by the time the write lands. The only
race left is a target deleted in between, whose outcome is a discount pointing
at a row that no longer exists — which the evaluator already tolerates.

`collections` is **optional**, and the omission is a real configuration: a host
that sells one undifferentiated thing has no dimension to register. What it
costs is stated rather than defaulted around — with nothing registered,
`GET /discounts/targets` answers `[]` and the cross-tenant check stays the
store's job.

### Why this is not a wiring capability yet

`@12-apps/wiring`'s contract folder holds http, web, mcp, db, env, jobs, email,
notifications and permissions — there is no registration or extension concept,
so promoting this would mint a new capability on two instances that are less
alike than they look: `@12-apps/entity-lifecycle` registers a collection it
DRIVES, with write ops, while this registers a catalog dimension it only
QUERIES. Abstracting one contract over both risks fitting neither. It ships
here, shaped deliberately like its sibling so the family resemblance is visible,
and a third consumer is what would earn it a place in the contract.

`DISCOUNT_TARGET_TYPES` is closed at two today. That is a boundary, not a
principle: a third dimension is expressible the moment targets are stored **by
value** (`(target_type, target_id)`) instead of as a join table per member, and
the registration is shaped so that widening the array plus registering one more
collection is the whole change.

## The schema travels too

The package ships a **composed Prisma partial** and its migrations
(`prisma/discounts.prisma`, `wiring.db`). A host syncs the partial into its
schema folder and discovers the migration structurally:

```bash
pnpm --filter @12-apps/discounts prisma:sync         # copy the partial
pnpm --filter @12-apps/discounts prisma:sync:check   # drift gate, for CI
```

Three tables — `discounts`, `discount_combo_slots`, `discount_targets` — and
what makes them shippable at all is that **nothing in them names a host table**:

| the origin had | the partial has | why |
|---|---|---|
| `client Client @relation(...)` | a scalar `client_id` | this package cannot know a host's tenant model's name |
| `discount_categories` + `discount_items`, one FK each | one `discount_targets`, keyed `(target_type, target_id)` | a partial naming `product_categories` only compiles inside a host that has that table |
| the scope's targets and a combo slot's, separately | one table, told apart by a nullable `slot_id` | they are the same fact; two tables need every reverse read, ownership check and cascade written twice |

Which collections are discountable is answered at RUNTIME by a
`DiscountableCollection` registration, not by the schema. That is the whole
move, and it is `@12-apps/entity-lifecycle`'s, applied here.

**The redemption snapshot stays with the host.** `order_discounts` is a child of
the host's own order, with a cascade, and its purpose is to freeze what a buyer
received on an order the host owns. Shipping the rule and leaving the receipt is
the clean cut.

**What the by-value target costs**, stated plainly: the schema no longer
guarantees that deleting a category cannot leave a rule pointing at a ghost.
Three things carry that instead — the evaluator already tolerates an unmatched
target (it covers nothing), `DiscountableOps.ownsAll` refuses a foreign or
missing id on every write, and a host that wants the constraint back may add it
in its own migration.

### The migration adopts an existing table

Every statement is idempotent, because the first host to adopt this package
already HAS a `discounts` table from its own, earlier migration — and a package
migration sorts AFTER the host's by name, so a bare `CREATE TABLE` would fail
`migrate deploy` on every database that already has one. A fresh host gets
everything; an existing host gets only what it is missing (the three combo
columns, the two new tables, and the widened `type`/`scope`/value CHECKs);
replaying the whole folder is a no-op.

It deliberately does NOT move a host's existing target rows into
`discount_targets`. Only that host knows what its catalog tables are called, so
backfilling and dropping the old join tables is one migration in the host,
written once, sorting after this one.

`src/prisma/__tests__/migration.test.ts` applies the SQL to real Postgres
(PGlite) in all three situations — 17 cases, including the partial uniques, both
cascades, and the CHECK widening a schema diff cannot see.

## The admin screens travel too — `@12-apps/discounts/react`

```ts
// ONCE, at module scope. The members are component TYPES.
export const discounts = createWebDiscounts({
  apiBase: `/api/admin/${slug}`,
  copy: PT_BR_DISCOUNTS_WEB_COPY,   // required, no defaults
  locale: "pt-BR",
  currency: "BRL",
  currencyField: MyCurrencyField,   // currency entry is a host decision
  onError: reportToSentry,          // required — see below
  breadcrumb: [{ label: "Início", href: "/admin" }, { label: "Descontos" }],
});

// <discounts.Screen /> is the whole promotions admin.
```

What that one call replaces: a server-driven grid with eight columns, five
filter pills and a CSV/JSON export; a create/edit form of fourteen inputs, four
of which appear only when another says so; the target pickers; two card
layouts; four confirmation popups; and every wire call between them.

**Build it once, at module scope.** The members are component TYPES, so
rebuilding per render gives React new types every time and remounts the whole
tree below — a form then cannot be typed into, and nothing says why.
`useWebDiscounts` is the memoised form for a genuinely dynamic mount path.

### `onError` is required, and it is the browser twin of the server's logger

These screens already tell the OPERATOR what went wrong. That is not the same as
anybody knowing. A refused write, a catalog that would not load, a page read
that failed — each reaches a person only if a host routes it somewhere, and a
no-op default would make *nothing is broken* and *nothing is watching* look
identical. `context` is a stable dotted token (`discounts.list`,
`discounts.create`, `discounts.targets`) so a reporter can group on it.

### One vocabulary, in English, on the wire

`DISCOUNT_WINDOW_STATES` are `RUNNING` / `SCHEDULED` / `ENDED`, and the words on
the pill come from the copy pack. They are read in three places that must agree
— the filter pill, the query the backend receives, and the badge on a row — and
the moment one of those is a word in a language, the set stops being a set. The
origin filtered on `Vigente`, so its wire protocol *was* its language.

`discountWindowState()` lives in the engine rather than in this surface for the
same reason: the badge and the backend filter must answer "has it ended" the
same way, and two implementations is how a grid shows a rule as running on a row
the filter excludes.

### What a host still supplies, and why each one

| config | why it cannot be defaulted |
|---|---|
| `copy` | a default in one language reads as finished to the next host until a user sees it |
| `locale` + `currency` | "12,5" is not a translation of "12.5" — it decides PARSING as much as rendering |
| `currencyField` | masking, which side the symbol sits on, whether cents are typed — no neutral answer exists |
| `onError` | above |
| `breadcrumb` | the host owns its own information hierarchy |

### Storybook

`pnpm --filter @12-apps/discounts dev` (port 6009). Every ported component has
stories, including the states nobody can produce on demand in a real
environment: a refused write, a backend that will not answer, a catalog that
failed while the grid loaded fine. The stories substitute a **transport**, not a
stubbed client, so they exercise the real path building and envelope unwrapping
and only the bytes are pretend.

## What the host still owns

**Persistence itself.** The package owns the schema; the host owns the client,
the tenant scoping, the transactions and the uniqueness conflicts, and answers
the `DiscountStore` port. `toTargetRows` / `fromTargetRows` do the fold between
the id arrays this package speaks and the by-value rows the schema stores, so a
store stays persistence and nothing else — that mapping is exactly where a
dropped `slotId` produces a combo whose slots have silently merged.

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
