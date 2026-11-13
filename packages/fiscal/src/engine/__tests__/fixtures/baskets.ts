/**
 * The fixture set every engine suite and the oracle harness share: the tax
 * classes a store of each kind sells (prepared food, alcoholic drink, resold
 * packaged goods, cesta básica, a listed food, the delivery fee, household
 * goods), one restaurant basket and one market basket.
 *
 * The codes are the official ones (Informe Técnico 2025.002, as the official
 * calculator V0066 serves them): 200047 bares e restaurantes (−40%), 200003
 * Anexo I (zero), 200034 Anexo VII (−60%), 000001 full rate. The engine
 * carries them opaque and computes from `regimeEspecifico` and `reductionBp`;
 * the oracle harness checks the pairing against the calculator.
 */

import tables from "../../../../tables/ibs-cbs-2026-11-13.json";
import type {
  RateTables,
  SellerProfile,
  TaxClass,
  TaxExclusions,
  TaxInput,
  TaxLineInput,
} from "../../types";

export const TABLES = tables as RateTables;

/** São Paulo (SP) and Rio de Janeiro (RJ), 7-digit IBGE codes. */
export const SAO_PAULO = "3550308";
const RIO = "3304557";

export const CLASSES = {
  /** Prepared on the premises: in the restaurant regime (art. 273 caput, §1). */
  preparedFood: { cClassTrib: "200047", cstIbsCbs: "200", regimeEspecifico: "BARES_RESTAURANTES", reductionBp: 0 },
  /** Alcohol, even prepared on the premises: OUT, full rate (art. 273 §2). */
  alcoholicDrink: { cClassTrib: "000001", cstIbsCbs: "000", regimeEspecifico: null, reductionBp: 0 },
  /** Bought from a third party and sold as-is: OUT, full rate (art. 273 §2). */
  resoldPackaged: { cClassTrib: "000001", cstIbsCbs: "000", regimeEspecifico: null, reductionBp: 0 },
  /** The delivery fee the store keeps: inside the base (art. 12 §1 IV), full rate. */
  deliveryFee: { cClassTrib: "000001", cstIbsCbs: "000", regimeEspecifico: null, reductionBp: 0 },
  /** Cesta básica: zero rate (arts. 125–126, Anexo I) — a 100% reduction. */
  cestaBasica: { cClassTrib: "200003", cstIbsCbs: "200", regimeEspecifico: null, reductionBp: 10000 },
  /** A listed food with the 60% reduction (Anexo VII). */
  listedFood: { cClassTrib: "200034", cstIbsCbs: "200", regimeEspecifico: null, reductionBp: 6000 },
  /** Household goods: full rate. */
  household: { cClassTrib: "000001", cstIbsCbs: "000", regimeEspecifico: null, reductionBp: 0 },
} as const satisfies Record<string, TaxClass>;

export const RESTAURANT_SELLER: SellerProfile = {
  regime: "REGIME_REGULAR",
  regimeEffectiveFrom: "2026-01-01",
  restaurantRegime: true,
};

export const MARKET_SELLER: SellerProfile = {
  regime: "REGIME_REGULAR",
  regimeEffectiveFrom: "2026-01-01",
  restaurantRegime: false,
};

/** Burger, two juices, a bag of chips resold, the delivery fee: R$ 66,40. */
const RESTAURANT_LINES: readonly TaxLineInput[] = [
  { id: "burger", valueCents: 3990, quantity: 1, foodAndDrink: true, taxClass: CLASSES.preparedFood },
  { id: "juice", valueCents: 1200, quantity: 2, foodAndDrink: true, taxClass: CLASSES.preparedFood },
  { id: "chips", valueCents: 650, quantity: 1, foodAndDrink: true, taxClass: CLASSES.resoldPackaged },
  { id: "delivery", valueCents: 800, quantity: 1, foodAndDrink: false, taxClass: CLASSES.deliveryFee },
];

/** Rice (cesta), weighed honey (Anexo VII), three detergents, a notebook: R$ 106,07. */
const MARKET_LINES: readonly TaxLineInput[] = [
  { id: "rice-5kg", valueCents: 2790, quantity: 1, foodAndDrink: true, taxClass: CLASSES.cestaBasica },
  { id: "honey", valueCents: 1850, quantity: 0.512, foodAndDrink: true, taxClass: CLASSES.listedFood },
  { id: "detergent", valueCents: 1377, quantity: 3, foodAndDrink: false, taxClass: CLASSES.household },
  { id: "notebook", valueCents: 4590, quantity: 1, foodAndDrink: false, taxClass: CLASSES.household },
];

export const NO_EXCLUSIONS: TaxExclusions = { serviceCharge: null, retainedIntermediation: null };

export function restaurantInput(supplyDate: string, overrides: Partial<TaxInput> = {}): TaxInput {
  return {
    lines: RESTAURANT_LINES,
    seller: RESTAURANT_SELLER,
    destinationIbge: SAO_PAULO,
    exclusions: NO_EXCLUSIONS,
    tables: TABLES,
    supplyDate,
    ...overrides,
  };
}

export function marketInput(supplyDate: string, overrides: Partial<TaxInput> = {}): TaxInput {
  return {
    lines: MARKET_LINES,
    seller: MARKET_SELLER,
    destinationIbge: RIO,
    exclusions: NO_EXCLUSIONS,
    tables: TABLES,
    supplyDate,
    ...overrides,
  };
}

/** One day in each golden year. 2026 is recorded; the others are ESTIMATE periods. */
export const GOLDEN_DATES = {
  2026: "2026-11-20",
  2027: "2027-06-15",
  2029: "2029-03-01",
  2033: "2033-01-01",
} as const;
