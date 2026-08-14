# `@12-apps/stock-domain`

Closed vocabularies for a **stock-movement reason taxonomy**, assembled from
values the adopting application declares.

Zero dependencies, no framework code, no I/O. A host's server repositories, its
HTTP handlers, its report engine and its browser bundles all import this, so
anything heavier here is dragged into all four.

```ts
import { defineStockReasonTaxonomy } from '@12-apps/stock-domain';

export const REASONS = defineStockReasonTaxonomy({
  kinds: { name: 'movement direction', values: ['OUTBOUND', 'INBOUND'], fallback: 'OUTBOUND' },
  categories: { name: 'shrinkage class', values: ['EXPIRY', 'BREAKAGE'], fallback: 'EXPIRY' },
  categoryAppliesTo: ['OUTBOUND'],
});

export type ReasonKind = (typeof REASONS.kinds.values)[number];
```

## What this package owns, and what it does not

It owns the **shape** of the taxonomy, which is a fact about stock ledgers:

- a movement reason sits on a **direction** axis, and that axis decides the sign
  of the movement — so it is what any report totalling one direction must filter
  on;
- a second axis **sub-classifies** reasons, but only on some directions; on the
  others the column exists and its content is inert;
- both axes are **closed** sets;
- the set a write is validated against **is** the set a read is narrowed with.

It does not own the values. Which directions an operation recognises, how it
sub-classifies them, which member an unreadable row falls back to and what any
of them are called on a screen are facts about that operation, its regulator and
its accountant — and they arrive as config.

They used to be compiled in. Two arrays sat in this package as constants, with
their derived types, their derived defaults and two type guards over them, and
they were one application's ledger vocabulary extracted along with the code. An
adopter did not merely inherit them: a host builds its wire schema from these
arrays, so one product's ledger values were published as the agent-facing type
of a field on every adopter's API. `ADOPTING.md` has the migration table.

## The API

### `defineVocabulary(spec) → Vocabulary`

One closed axis.

| Member | What it is |
| --- | --- |
| `values` | every value, in declaration order, frozen, typed as a non-empty tuple so `z.enum` and its equivalents accept it |
| `fallback` | what a lenient read turns an unreadable value into, and what an inert column carries |
| `has(value)` | **the** predicate — takes `unknown`, narrows to a member |
| `parse(value)` | narrow, or throw `StockValueError` |
| `coerce(value)` | narrow, or return `fallback` |

`parse`, `coerce` and every taxonomy rule are built on `has`, and `has` is built
from a frozen copy of `values`. There is no second statement of the set for
either side to fall behind — which is the point: the two sides of this contract
are a schema in a route and a narrowing in a repository, they live in different
files, and when one learns a new value and the other does not, nothing fails to
compile, because the losing side has usually widened to `string`.

### `defineStockReasonTaxonomy(spec) → StockReasonTaxonomy`

Two axes and the rule between them.

| Member | What it is |
| --- | --- |
| `kinds`, `categories` | a `Vocabulary` each |
| `categoryAppliesTo` | the kinds a category means something on |
| `categoryApplies(kind)` | whether this kind takes one |
| `categoryFor(kind, value)` | the **write** rule, in three cases: throw on a kind that is not a kind, inert `fallback` on a kind that takes no category, parse on one that does |
| `coerceReason(row)` | the **read** rule: narrow a stored row, falling back rather than throwing |

Reads are lenient and writes are not, on purpose: one malformed legacy row
should not take down the screen listing it, while a write that would create such
a row has a user in front of it who can be told. "Lenient" only ever changes
what happens to a **rejected** value, never which values are rejected.

## Assembly refuses, rather than trusting

A required-but-unchecked option is still fail-open, so every one of these is a
`StockDomainConfigError` thrown once, at assembly, at boot:

- **an empty `values`** — the tempting reading is "declare nothing and nothing
  is allowed", and that is not what happens. There is no member for `fallback`
  to be, so the read path must return something outside the set typed as though
  it were inside, while the host's write schema either refuses to construct or
  matches nothing;
- **an empty `categoryAppliesTo`** — every kind then takes no category, so every
  sub-classification a user picks is replaced by the inert value on its way to
  storage, silently, with no failed write anywhere to notice it by;
- **a `categoryAppliesTo` entry that is not a kind** — a typo names a direction
  that does not exist, so the real one quietly stops taking categories;
- **a value with surrounding whitespace** — what `"A, B".split(',')` produces
  from a settings row or an environment variable, and the malformation whose
  every consequence is silent: the published enum carries `" B"`, so the write
  validator refuses every stored `B` while the read path coerces the whole
  column to `fallback`;
- **a blank or repeated value**, and **a `fallback` outside its own set**.

`StockDomainConfigError` is a wiring bug an adopter finds by booting.
`StockValueError` is a data failure they find by serving. They are separate
classes because collapsing them makes a request-time throw read like an outage
and a deploy-time one read like a user typo.

## Tests

```bash
pnpm --filter @12-apps/stock-domain test
```

Five suites, three of which are about portability rather than behaviour:

- `portability.test.ts` mounts **two** hosts in one process — a transfusion
  service and a glacier core archive, differing in arity on every axis — each
  with a wire validator built from the published values, a store holding rows
  that validator never saw, and the screens that read them back;
- `entry-points.test.ts` enumerates `package.json#exports`, enumerates what each
  entry exports, and fails on a factory with no empty-collection case — a guard
  reachable only from some other factory is a guard an adopter never meets;
- `packed-artifact.test.ts` asks `npm pack --dry-run --json` what would be
  uploaded and reads every entry off disk, because this package publishes its
  source and every `*.md`, so a value can leave in a comment or a doc sentence
  that nothing renders. It sweeps for the removed export NAMES too — every one
  of them hides an `_` or a camel hump inside the banned word, so none is
  visible to the word-boundary list — with one exact-path exemption for
  `ADOPTING.md`, whose migration table has to name them, proved in both
  directions.

The ban list itself lives in `src/__tests__/foreign-vocabulary.ts` and is
imported by both suites, because two statements of one set is the defect this
package exists to remove.
