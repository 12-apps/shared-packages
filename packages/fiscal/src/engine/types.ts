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

/**
 * A line's tax class, as the host classified the item. `cClassTrib` and
 * `cstIbsCbs` are carried opaque into the snapshot (the classification table
 * is the host's data, Informe Técnico 2025.002).
 *
 * `regimeEspecifico: "BARES_RESTAURANTES"` marks prepared food and
 * non-alcoholic drinks prepared on the premises (art. 273 caput, §1). Alcohol,
 * even prepared on the premises, and food or drink bought from third parties
 * and resold as-is are OUT (art. 273 §2) and must carry `null`.
 */
export interface TaxClass {
  readonly cClassTrib: string;
  readonly cstIbsCbs: string;
  readonly regimeEspecifico: RegimeEspecifico | null;
  /** The class's own rate reduction (a listed-food reduction, say), 0–10000. */
  readonly reductionBp: number;
}

/** One priced line of the supply. */
export interface TaxLineInput {
  /** The host's id, echoed on the output line; unique within the input. */
  readonly id: string;
  /**
   * The line's whole value (every unit) AFTER its allocated discount: an
   * unconditional discount is outside the base (art. 12 §2 III).
   */
  readonly baseCents: number;
  /** Units, for the document (`qCom`). Positive; fractional for weighed goods. */
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
  /**
   * Whether the charge is passed in full to the staff. Only then is it
   * excluded from the base, up to the ceiling (art. 274 par. único I); a
   * charge the store keeps is price.
   */
  readonly passedToStaff: boolean;
  /** The class the part that stays in the base is taxed at. */
  readonly taxClass: TaxClass;
}

/** The amounts the restaurant regime keeps out of the base (art. 274 par. único). */
export interface TaxExclusions {
  readonly serviceCharge: ServiceChargeInput | null;
  /**
   * What a digital platform retained for delivery and intermediation and
   * never passed to the restaurant (art. 274 par. único II). 0 when none.
   */
  readonly retainedIntermediationCents: number;
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
export type LineSource = "LINE" | "SERVICE_CHARGE";

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

/** One output line. */
export interface LineTax extends LineFigures {
  readonly lineId: string;
  readonly source: LineSource;
  readonly quantity: number;
  /** The value before the exclusions. */
  readonly baseCents: number;
  /** The base the tax was computed on (`vBC`): the value less its exclusions. */
  readonly taxBaseCents: number;
  /** The class snapshot, as given. */
  readonly taxClass: TaxClass;
}

/** The breakdown of one supply. Every order figure is the sum of its rounded lines. */
export interface TaxBreakdown {
  readonly lines: readonly LineTax[];
  readonly taxBaseCents: number;
  readonly cbsCents: number;
  readonly ibsUfCents: number;
  readonly ibsMunCents: number;
  readonly ibsCents: number;
  readonly totalTaxCents: number;
  readonly gorjetaExcludedCents: number;
  readonly intermediationExcludedCents: number;
  readonly regime: TaxRegime;
  readonly treatment: TaxTreatment;
  /** True when no amount is due "por fora": the test year, or a Simples store inside the DAS. */
  readonly informative: boolean;
  /** True when the period's figures are estimates, not law. */
  readonly provisional: boolean;
  readonly supplyDate: IsoDate;
  readonly destinationIbge: string;
  readonly tablesVersion: string;
}
