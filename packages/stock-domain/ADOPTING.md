# Adopting `@12-apps/stock-domain`

An integration playbook. For what the package is and why, see
[`README.md`](./README.md); this is the "what do I wire, and what do I change if
I already had 1.x" guide.

---

## 1. What changed, and what to write instead

Up to and including **1.18.0** this package exported one application's ledger
vocabulary as constants. Every one of those exports is **gone**. They are
replaced by two factories that take the same information as config.

| Removed in 2.0 | Was | Now |
| --- | --- | --- |
| `STOCK_REASON_KINDS` | a frozen-by-convention array of direction values | `REASONS.kinds.values` — frozen for real, typed as a non-empty tuple |
| `LOSS_CATEGORIES` | an array of sub-classification values | `REASONS.categories.values` |
| `DEFAULT_STOCK_REASON_KIND` | a constant | `REASONS.kinds.fallback` |
| `DEFAULT_LOSS_CATEGORY` | a constant | `REASONS.categories.fallback` |
| `isStockReasonKind(value: string)` | a type guard | `REASONS.kinds.has(value: unknown)` |
| `isLossCategory(value: string)` | a type guard | `REASONS.categories.has(value: unknown)` |
| `type StockReasonKind` | a union derived from the array | `(typeof REASONS.kinds.values)[number]`, or `VocabularyValue<typeof REASONS.kinds>` |
| `type LossCategory` | a union derived from the array | `(typeof REASONS.categories.values)[number]` |

| New | What it is |
| --- | --- |
| `defineStockReasonTaxonomy(spec)` | the whole taxonomy — the entry point to use |
| `defineVocabulary(spec)` | one closed axis, if you need one on its own |
| `Vocabulary`, `VocabularySpec`, `VocabularyValue` | the axis types |
| `StockReasonTaxonomy`, `StockReasonTaxonomySpec` | the taxonomy types |
| `StockDomainConfigError` | thrown at ASSEMBLY when the wiring is unsafe |
| `StockValueError` | thrown by `parse` when untrusted DATA is not a member |

Three behavioural changes to know about beyond the renames:

- **The guards take `unknown`, not `string`.** Every existing call still
  compiles. What you can now delete is the `String(x)` / `typeof x === 'string'`
  dance in front of them — a JSON snapshot field or a nullable column goes
  straight in, and `null` is rejected instead of becoming `"null"`.
- **`values` is frozen and is a copy.** Nothing you still hold a reference to
  can widen the set a schema was already built from.
- **"Which kinds take a sub-classification" is declared, not inlined.** It used
  to be a sentence in a comment, which meant every read site re-decided it by
  naming one of your own direction values in an `if`. That is now
  `categoryAppliesTo`, and `categoryFor` / `coerceReason` both route through it.
- **`categoryFor` throws on a kind that is not a kind.** It distinguishes three
  cases, not two — see §3. An unknown kind is a refusal, never the inert value.

## 2. Declare your taxonomy

One module, imported by everything that touches a movement reason.

```ts
// lib/stock/reasons.ts
import { defineStockReasonTaxonomy, type VocabularyValue } from '@12-apps/stock-domain';

export const REASONS = defineStockReasonTaxonomy({
  kinds: {
    name: 'movement direction',
    values: ['OUTBOUND', 'INBOUND'],
    fallback: 'OUTBOUND',
  },
  categories: {
    name: 'shrinkage class',
    values: ['EXPIRY', 'BREAKAGE', 'SHRINK'],
    fallback: 'SHRINK',
  },
  categoryAppliesTo: ['OUTBOUND'],
});

export type ReasonKind = VocabularyValue<typeof REASONS.kinds>;
export type ReasonCategory = VocabularyValue<typeof REASONS.categories>;
```

Four things to decide deliberately, because each of them is a promise:

1. **Declaration order.** Your schema, your select box and your stored column
   all read `values`. Re-ordering it moves a published schema — see §5.
2. **`fallback` per axis.** This is what an unreadable stored value becomes on a
   read, and what an inert column carries. It must be a member, and assembly
   refuses one that is not: the read path can mint it, any save on that screen
   writes it back, and a non-member would then be refused by your own schema.
3. **`categoryAppliesTo`.** Which directions a sub-classification means anything
   on. It may not be empty — see §4.
4. **Whether the axes overlap.** A value may legitimately name both a direction
   and a sub-classification of it. Nothing here requires the sets to be disjoint
   and nothing requires them to overlap; if they do, remember that reading the
   sub-classification tells a caller nothing about the direction.

## 3. Wire the three places a vocabulary is used

### The wire schema (writes)

```ts
// lib/http/schemas.ts
import { z } from 'zod';
import { REASONS } from '../stock/reasons';

const kindSchema = z.enum(REASONS.kinds.values);
const categorySchema = z.enum(REASONS.categories.values);

export const createReasonBody = z.object({
  name: z.string().trim().min(1),
  kind: kindSchema.default(REASONS.kinds.fallback),
  category: categorySchema.default(REASONS.categories.fallback),
});
```

`values` is a non-empty tuple type for exactly this: `z.enum` refuses an
unbounded `string[]`, and a package that handed one over would push every
adopter into a cast.

Write the defaults as `REASONS.*.fallback` rather than repeating the literal.
Your database column default, your schema default and the value a read falls
back to are the same decision written in three places, and only one of them can
be the source.

### The repository (reads)

```ts
// lib/stock/reason-repository.ts
import { REASONS } from './reasons';

function toRecord(row: { kind: string; category: string; name: string }) {
  return { name: row.name, ...REASONS.coerceReason(row) };
}
```

`coerceReason` is deliberately lenient — a legacy row that predates the
vocabulary should not take down the screen listing it. It runs the same
predicate the schema above does, so the two cannot disagree about which values
are members, only about what happens to one that is not.

### The endpoint (the rule between the axes)

```ts
const kind = REASONS.kinds.parse(body.kind);
const category = REASONS.categoryFor(kind, body.category);
```

`categoryFor` distinguishes **three** cases, and the third is the one that is
easy to fold into the second:

| The kind is… | What you get |
| --- | --- |
| not a kind at all | `StockValueError` — a write that should never have been attempted |
| a kind that takes no sub-classification | the inert `fallback`; whatever was sent is ignored |
| a kind that takes one | the parsed category, or `StockValueError` |

The first is why `kinds.parse` above is not redundant even though `categoryFor`
does it too: parsing at the top of the handler is what lets you report *which*
field was wrong. Folding an unknown kind into the inert branch instead would
return a clean-looking category and discard the sub-classification the user
chose, with nothing failing anywhere — the per-row form of the fail-open §4
refuses an empty `categoryAppliesTo` for.

Do not swallow a `StockValueError` into the fallback: on a write that stores a
classification the user did not choose. Translate it at your error boundary
instead; it is a 422, not a 500.

## 4. What assembly refuses, and why each is fail-OPEN

`defineStockReasonTaxonomy` and `defineVocabulary` throw
`StockDomainConfigError` at boot rather than trusting the spec. A
required-but-unvalidated option is still fail-open, and each of these is a case
where declaring *nothing* opens a door rather than closing one:

| Refused | What would otherwise happen |
| --- | --- |
| `values: []` | no member for `fallback` to be, so the read path mints a value typed as a member that your write schema refuses — and `z.enum([])` either throws at construction or matches nothing while reads keep going |
| `categoryAppliesTo: []` | every kind takes no sub-classification, so every one a user picks is replaced by the inert value on the way to storage — silently, for the whole vocabulary, with no failed write to notice it by |
| `categoryAppliesTo: ['TPYO']` | the same discard, narrowed to one direction, which is harder to notice rather than easier |
| a blank value | every "is it filled in" check admits it, so an unset form field validates as a deliberate choice |
| a value with surrounding whitespace | the malformation `"A, B".split(',')` produces, and the one whose every consequence is silent: the published enum carries `" B"`, so the write validator refuses every stored `B` while the read path coerces the whole column to `fallback` |
| a repeated value | "the vocabulary widened" and "it did not" produce the same array length, which is what a drift test usually watches |
| a near-duplicate (`['A', 'A ']`) | two entries to every length check and one value to every reader — refused by the whitespace rule before the duplicate rule could miss it |
| a `fallback` outside its set | a narrowing that cannot fail — a cast wearing a guard's clothes |

Two of these the compiler catches first, and only because `fallback` and
`categoryAppliesTo` are non-inferring positions: an empty literal makes the
value type infer as `never`, so there is no member `fallback` could be, and a
typo'd entry cannot widen the axis to include itself. That is the case where you
write the values out in TypeScript.

If you assemble from configuration instead — a settings table, a JSON file, an
environment variable — there is no compiler in the loop, which is what the
runtime refusals are for. Catch `StockDomainConfigError` at boot and fail the
process. It is not a per-request error and should never be handled as one.

## 5. Re-check anything generated from `values`

If any part of your build **serialises** these arrays — an OpenAPI document, an
MCP manifest, a JSON Schema, a GraphQL enum, a generated client — then the array
is part of your published contract, and both its members and their ORDER are.
Adopting this version does not change the members, but it moves where they are
declared, so regenerate and commit those artifacts in the same change as the
wiring. A drift check that compares a committed artifact against a fresh
generation will otherwise fail on the next unrelated pull request, with a diff
that points at neither.

## 6. What this package does NOT do for you

It is a vocabulary kit, not a stock module. It owns no screen, no endpoint and
no table, so it deliberately holds none of the wiring those imply. If your
ledger needs any of the following, they are yours to compose — and each one is
listed because it is a place a package like this is tempted to reach:

| Concern | Where it belongs |
| --- | --- |
| notifying someone when a level runs out | your notification package, subscribed by the host |
| an audit entry for an adjustment | your audit package, at the repository or route seam |
| a realtime event on a movement | your realtime package, published by the host |
| capping how many storage places a tenant may have | your entitlement package, checked before the write |
| version history, soft delete or a recycle bin for a reason row | your entity-lifecycle package, configured by the host |
| permission ids that gate the reasons screen | your RBAC catalog, which the host owns |
| the pt-BR (or any) label a value shows on a screen | your host's copy, keyed by the value |

This package takes values and hands back guarded types. Everything above needs a
tenant, a request, a user or a transaction, none of which it has or wants.

## 7. Checklist

- [ ] one `defineStockReasonTaxonomy` call, exported from one module
- [ ] no literal from either axis written anywhere but that module
- [ ] every schema enum built from `values`, every default from `fallback`
- [ ] every read through `coerceReason`; every write through `kinds.parse` and
      then `categoryFor` (§3 — the kind is parsed where you can name the field)
- [ ] no axis value declared with surrounding whitespace, especially where the
      values are split out of a setting or an environment variable (§4)
- [ ] `StockValueError` mapped to a 422 at the error boundary
- [ ] `StockDomainConfigError` fails the boot, not the request
- [ ] generated wire artifacts regenerated and committed (§5)
- [ ] your database `CHECK` constraints and column defaults still agree with the
      declared values — this package cannot see them
