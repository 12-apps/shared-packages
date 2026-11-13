# @12-apps/fiscal

Brazilian consumption-tax machinery for any host that sells. The package is
built module by module; the first is the **IBS/CBS engine**.

| subpath | what it is |
|---|---|
| `@12-apps/fiscal/engine` | `computeTax(input) → TaxBreakdown`: pure, no I/O, no clock, no defaults. Plus `computeTaxWithOracle` over an injected `OfficialCalculator` port, and `compareBreakdowns`. |
| `@12-apps/fiscal/tables/<file>.json` | Versioned rate tables — DATA, never code. The engine stamps the table's `version` on every result. |
| `@12-apps/fiscal/manifest` | The `@12-apps/wiring` manifest. A skeleton today: the four permissions. |

## The engine

```ts
import { computeTax } from "@12-apps/fiscal/engine";
import tables from "@12-apps/fiscal/tables/ibs-cbs-2026-11-13.json" with { type: "json" };

const breakdown = computeTax({
  lines: [
    {
      id: "item-1",
      baseCents: 3990, // the line's value after its allocated discount
      quantity: 1,
      foodAndDrink: true,
      taxClass: { cClassTrib: "…", cstIbsCbs: "…", regimeEspecifico: "BARES_RESTAURANTES", reductionBp: 0 },
    },
  ],
  seller: { regime: "REGIME_REGULAR", regimeEffectiveFrom: "2026-01-01", restaurantRegime: true },
  destinationIbge: "3550308", // the establishment, or for a delivered good the place of delivery
  exclusions: { serviceCharge: null, retainedIntermediationCents: 0 },
  tables,
  supplyDate: "2026-11-20", // the local day of the supply, in the seller's clock
});
// breakdown.lines[i]: taxBaseCents, cbsRateBp/cbsCents, ibsUfRateBp/ibsUfCents,
//   ibsMunRateBp/ibsMunCents, reductionBp, the class snapshot
// breakdown: the sums, gorjetaExcludedCents, intermediationExcludedCents,
//   treatment, informative, provisional, tablesVersion
```

Money is integer cents, rates integer basis points, dates `YYYY-MM-DD`. Any
value the engine cannot read is refused with a `FiscalEngineError` carrying a
`code`; nothing is defaulted.

### The rules it applies (LC 214/2025)

- **Rates by the date of the supply**, from the table's period covering it:
  2026 CBS 0.9% and IBS 0.1% (arts. 343, 346), informative (art. 348 §1);
  2027–2028 IBS 0.05% state + 0.05% municipal (art. 344); later years the
  reference rates the table carries. A period whose figures are not yet law is
  `status: "ESTIMATE"` and stamps its results `provisional: true`.
- **Destination** (art. 11 I): a state's or municipality's own rate where the
  table lists one (`byUf`, `byMunicipality`), the reference rate elsewhere.
- **Regimes** (art. 41): regime regular and the Simples híbrido → `FULL`;
  Simples inside the DAS → `INFORMATIVE`, carrying the figures a regime store
  would show and no amount "por fora"; MEI and não contribuinte → `NONE`, zero.
  In 2026 the test rates are not applied to Simples optants (art. 348 III "c"),
  read from the period's `appliesToSimplesNacional`.
- **Bares e restaurantes**: in a store with `restaurantRegime`, a line whose
  class is `BARES_RESTAURANTES` (prepared food, non-alcoholic drinks prepared
  on the premises — art. 273) takes the table's 40% reduction (art. 275);
  alcohol and resale carry `regimeEspecifico: null` and the full rate
  (art. 273 §2). Outside the special regime a class's own `reductionBp`
  applies (a cesta-básica zero rate is a 100% reduction).
- **Exclusions**, restaurant regime only (art. 274 par. único): a service
  charge passed in full to the staff leaves the base up to 15% of the food
  and drink (I) — the part above the ceiling, or a charge the store keeps, is
  taxed as a line of its own; what a platform retained for delivery and
  intermediation leaves the base (II), spread over the lines by value in exact
  cents.
- **Rounding**: per item, per tax, to whole cents, half up — the NF-e layout's
  rounding, never a floor; the reduction applies to the rate before the
  product is rounded, and every order figure is the sum of its rounded lines.

### The oracle mode

`computeTaxWithOracle(input, calculator)` takes the same input and asks an
`OfficialCalculator` port for each item's rates, reduction and taxes; the
regime, the exclusions and the bases stay the engine's. A host points the port
at the official Calculadora de Tributos. The package's own suite runs both
modes over one fixture set and asserts `compareBreakdowns` finds nothing
(`src/engine/__tests__/oracle.test.ts`); its recorded answers are hand-computed
until a recording against the live calculator replaces them.
