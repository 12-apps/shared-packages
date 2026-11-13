/**
 * The engine's vocabulary. Money is integer CENTS, rates are integer BASIS
 * POINTS (1 bp = 0.01%), dates are ISO calendar days (`YYYY-MM-DD`) in the
 * seller's own clock — the fato gerador is the local day of the supply, and the
 * host, which owns the clock, says which day that was.
 *
 * Nothing here has a default. Every field is required, and a value the engine
 * cannot read is refused with a `FiscalEngineError`, never guessed.
 */

/** An ISO calendar day, `YYYY-MM-DD`. */
export type IsoDate = string;

/**
 * The seller's IBS/CBS regime (LC 214/2025 art. 41).
 *
 * - `REGIME_REGULAR` — Lucro Presumido/Real: the full breakdown, "por fora".
 * - `SIMPLES_IBS_CBS_REGULAR` — the Simples híbrido (art. 41 §3): a Simples
 *   optant that applies the regime regular to IBS/CBS; full breakdown.
 * - `SIMPLES` — inside the DAS (art. 41 §2): an `INFORMATIVE` breakdown, with
 *   the figures a regime store would show and no amount charged "por fora".
 * - `MEI` and `NAO_CONTRIBUINTE` — no IBS/CBS on the document: zero.
 */
export type TaxRegime =
  | "REGIME_REGULAR"
  | "SIMPLES_IBS_CBS_REGULAR"
  | "SIMPLES"
  | "MEI"
  | "NAO_CONTRIBUINTE";

/** The special regimes the engine applies. */
export type RegimeEspecifico = "BARES_RESTAURANTES";

/** What the treatment of the seller's regime is on the date of the supply. */
export type TaxTreatment = "FULL" | "INFORMATIVE" | "NONE";

/** The two codes an NF-e item carries for its IBS/CBS classification. */
export interface TaxClassCode {
  readonly cClassTrib: string;
  readonly cstIbsCbs: string;
}

/**
 * A line's tax class, as the host classified the item. `cClassTrib` and
 * `cstIbsCbs` are carried opaque into the snapshot (the classification table
 * is the host's data, Informe Técnico 2025.002).
 *
 * `regimeEspecifico: "BARES_RESTAURANTES"` marks prepared food and
 * non-alcoholic drinks prepared on the premises (art. 273 caput, §1; the
 * official class is 200047). Alcohol, even prepared on the premises, and food
 * or drink bought from third parties and resold as-is are OUT (art. 273 §2)
 * and must carry `null`.
 */
export interface TaxClass extends TaxClassCode {
  readonly regimeEspecifico: RegimeEspecifico | null;
  /** The class's own rate reduction (a listed-food reduction, say), 0–10000. */
  readonly reductionBp: number;
}

/** One priced line of the supply. */
export interface TaxLineInput {
  /** The host's id, echoed on the output line; unique within the input. */
  readonly id: string;
  /**
   * What the line costs the buyer, every unit, AFTER its allocated discount
   * (an unconditional discount is outside the base, art. 12 §2 III). It is
   * the price the shopper sees, so in a period whose table says
   * `taxInsidePrice` the IBS/CBS are INSIDE it and the engine takes them out;
   * otherwise it is the base itself and the tax is computed on top of it.
   */
  readonly valueCents: number;
  /** Units (`qCom`): positive, at most four decimals (weighed goods). */
  readonly quantity: number;
  /**
   * Whether the line is food or drink — what the gorjeta's 15% ceiling is
   * measured against (art. 274 par. único I). A delivery fee is not.
   */
  readonly foodAndDrink: boolean;
  readonly taxClass: TaxClass;
}

/** Who sells, and under which regime since when. */
export interface SellerProfile {
  readonly regime: TaxRegime;
  /** The first day `regime` applies. A supply before it is refused. */
  readonly regimeEffectiveFrom: IsoDate;
  /** Whether the bares e restaurantes regime (arts. 273–276) applies. */
  readonly restaurantRegime: boolean;
}

/** The service charge (taxa de serviço / gorjeta) on the supply. */
export interface ServiceChargeInput {
  /** Echoed as the service-charge line's id; unique within the input. */
  readonly id: string;
  readonly amountCents: number;
  /** Whether the charge is passed in full to the staff. */
  readonly passedToStaff: boolean;
  /** The class the WHOLE charge is taxed at when it is not excluded. */
  readonly taxClass: TaxClass;
}

/** What a digital platform retained for delivery and intermediation. */
export interface RetainedIntermediationInput {
  /** Echoed as the excluded line's id; unique within the input. */
  readonly id: string;
  /** Never passed to the restaurant; NOT included in any line's value. */
  readonly amountCents: number;
}

/**
 * The amounts the restaurant regime keeps out of the base (art. 274 par.
 * único), each segregated on the document as its own item (RCBS art. 399 §2:
 * without the segregation the base is the full value, §4).
 */
export interface TaxExclusions {
  /**
   * Excluded (its own line, the table's gorjeta class) only when the store is
   * in the restaurant regime, the charge is passed in full to the staff AND it
   * is at most 15% of the food and drink. Otherwise the whole charge is a
   * taxed line under its own class — never a partial exclusion.
   */
  readonly serviceCharge: ServiceChargeInput | null;
  /** Restaurant regime only (art. 274 par. único II); refused elsewhere. */
  readonly retainedIntermediation: RetainedIntermediationInput | null;
}

/** The IBS share of one sphere in one period: the reference and the overrides. */
export interface IbsSphereRates {
  /** The reference rate, which applies wherever no own rate is listed. */
  readonly referenceBp: number;
}

export interface IbsUfRates extends IbsSphereRates {
  /** State rates keyed by the 2-digit IBGE state code. */
  readonly byUf: Readonly<Record<string, number>>;
}

export interface IbsMunRates extends IbsSphereRates {
  /** Municipal rates keyed by the 7-digit IBGE municipality code. */
  readonly byMunicipality: Readonly<Record<string, number>>;
}

/** One stretch of time with one set of rates. */
export interface RatePeriod {
  readonly from: IsoDate;
  /** Inclusive; `null` is open-ended. */
  readonly to: IsoDate | null;
  /** `ESTIMATE` stamps every result computed on it `provisional`. */
  readonly status: "LAW" | "ESTIMATE";
  readonly source: string;
  /** The test year: highlighted, payment waived (art. 348 §1). */
  readonly informative: boolean;
  /** `false` in 2026: the test rates are not applied to Simples optants (art. 348 III "c"). */
  readonly appliesToSimplesNacional: boolean;
  /**
   * Whether the IBS/CBS sit INSIDE the item's value on the document (they
   * compose `vProd` and the price without tax travels in `vProdLiq`) — from
   * 2027 by the NF-e layout. When true, a line's `valueCents` is the
   * tax-inclusive price.
   */
  readonly taxInsidePrice: boolean;
  readonly cbsBp: number;
  readonly ibsUf: IbsUfRates;
  readonly ibsMun: IbsMunRates;
}

/** A versioned rate table: DATA, loaded by the host, stamped on every result. */
export interface RateTables {
  readonly version: string;
  readonly notes?: readonly string[];
  /** The gorjeta's ceiling as a share of food and drink: 1500 (art. 274 par. único I). */
  readonly gorjetaCapBp: number;
  readonly gorjetaCapSource?: string;
  /** The classes the excluded items are segregated under (410019, 410020). */
  readonly exclusionClasses: {
    readonly GORJETA: TaxClassCode;
    readonly INTERMEDIATION: TaxClassCode;
    readonly source?: string;
  };
  readonly specialRegimes: Readonly<
    Record<RegimeEspecifico, { readonly reductionBp: number; readonly source: string }>
  >;
  readonly periods: readonly RatePeriod[];
}

/** Everything one computation needs. */
export interface TaxInput {
  readonly lines: readonly TaxLineInput[];
  readonly seller: SellerProfile;
  /**
   * The 7-digit IBGE code of the place the IBS goes to: the establishment,
   * or for a delivered good the place of delivery (art. 11 I).
   */
  readonly destinationIbge: string;
  readonly exclusions: TaxExclusions;
  readonly tables: RateTables;
  /** The day of the supply; the rate is the rate of that day. */
  readonly supplyDate: IsoDate;
}

/** Where an output line came from. */
export type LineSource = "LINE" | "SERVICE_CHARGE" | "GORJETA_EXCLUDED" | "INTERMEDIATION_EXCLUDED";

/** The per-tax figures of one line. Rates are nominal; `reductionBp` applies to all three. */
export interface LineFigures {
  readonly reductionBp: number;
  readonly cbsRateBp: number;
  readonly cbsCents: number;
  readonly ibsUfRateBp: number;
  readonly ibsUfCents: number;
  readonly ibsMunRateBp: number;
  readonly ibsMunCents: number;
}

/** One output line — one NF-e item. */
export interface LineTax extends LineFigures {
  readonly lineId: string;
  readonly source: LineSource;
  readonly quantity: number;
  /** The value as given (`vProd`). */
  readonly valueCents: number;
  /** The base the taxes are computed on (`vBC`): 0 on an excluded line. */
  readonly taxBaseCents: number;
  /** CBS + IBS-UF + IBS-Mun of the line. */
  readonly taxCents: number;
  /**
   * The value without tax (`vProdLiq` = value − tax) in a `taxInsidePrice`
   * period; `null` when the tax is not inside the value.
   */
  readonly netValueCents: number | null;
  /**
   * The unit value without tax (`vUnComLiq`), in reais with ten decimals as
   * the layout writes it, within ±0,01 of `vProdLiq / qCom` (rule I11c-20);
   * `null` when `netValueCents` is.
   */
  readonly netUnitValue: string | null;
  /** The class snapshot (the table's exclusion class on an excluded line). */
  readonly taxClass: TaxClass;
}

/** The breakdown of one supply. Every order figure is the sum of its rounded lines. */
export interface TaxBreakdown {
  readonly lines: readonly LineTax[];
  readonly valueCents: number;
  readonly taxBaseCents: number;
  readonly cbsCents: number;
  readonly ibsUfCents: number;
  readonly ibsMunCents: number;
  readonly ibsCents: number;
  readonly totalTaxCents: number;
  /** Σ `netValueCents` (`vProdLiqTot`), or `null` when the tax is not inside the values. */
  readonly netValueCents: number | null;
  readonly gorjetaExcludedCents: number;
  readonly intermediationExcludedCents: number;
  readonly regime: TaxRegime;
  readonly treatment: TaxTreatment;
  /**
   * True when the figures are shown but not charged "por fora": the test year
   * (2026), or a Simples store inside the DAS. False for a `NONE` treatment,
   * which shows nothing.
   */
  readonly informative: boolean;
  /** True when the period's figures are estimates, not law. */
  readonly provisional: boolean;
  /** Whether the line values were taken as tax-inclusive. */
  readonly taxInsidePrice: boolean;
  readonly supplyDate: IsoDate;
  readonly destinationIbge: string;
  readonly tablesVersion: string;
}
