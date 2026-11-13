/**
 * The neutral document shape: one sale, host-agnostic, as the fiscal service
 * (`sidecar/`) accepts it and as the issuer port maps a host's sale into it.
 *
 * Money is integer CENTS, rates integer BASIS POINTS (1 bp = 0.01%) — the
 * engine's conventions (`@12-apps/fiscal/engine`) — and quantities carry at
 * most four decimals. Every field is required; an absent value is `null`,
 * never a missing key, so a host cannot forget one silently.
 *
 * The JSON schema the service validates against is
 * `@12-apps/fiscal/sidecar/schema/sale-for-document.schema.json`; a test keeps
 * it and these types in step. Whether the sale becomes an NF-e (model 55) or
 * an NFC-e (model 65) is the request path's choice, never this document's.
 */

/** The 27 federative units. */
export type Uf =
  | "AC" | "AL" | "AM" | "AP" | "BA" | "CE" | "DF" | "ES" | "GO" | "MA" | "MG" | "MS" | "MT" | "PA"
  | "PB" | "PE" | "PI" | "PR" | "RJ" | "RN" | "RO" | "RR" | "RS" | "SC" | "SE" | "SP" | "TO";

/** A postal address. `postalCode` is required on the issuer's. */
export interface Address {
  readonly street: string;
  readonly number: string;
  readonly complement: string | null;
  readonly district: string;
  /** The 7-digit IBGE municipality code. */
  readonly municipalityIbge: string;
  readonly municipalityName: string;
  readonly uf: Uf;
  /** CEP, 8 digits. */
  readonly postalCode: string | null;
  readonly phone: string | null;
}

/** The issuer's tax regime on the document (`CRT` 1, 2, 3, 4). */
export type IssuerTaxRegime = "SIMPLES" | "SIMPLES_EXCESS" | "NORMAL" | "MEI";

export interface DocumentIssuer {
  /** 14 characters; the 2026 alphanumeric CNPJ is accepted. */
  readonly cnpj: string;
  /** IE digits, or `ISENTO`. */
  readonly stateRegistration: string;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly taxRegime: IssuerTaxRegime;
  readonly address: Address & { readonly postalCode: string };
}

export type BuyerDocument =
  | { readonly kind: "CPF"; readonly number: string }
  | { readonly kind: "CNPJ"; readonly number: string }
  | { readonly kind: "FOREIGN"; readonly number: string };

/** `indIEDest` 1, 2, 9. */
export type StateRegistrationStatus = "CONTRIBUTOR" | "EXEMPT" | "NON_CONTRIBUTOR";

export interface DocumentBuyer {
  readonly document: BuyerDocument;
  readonly name: string | null;
  readonly stateRegistrationStatus: StateRegistrationStatus;
  readonly stateRegistration: string | null;
  readonly email: string | null;
  readonly address: Address | null;
}

/** The goods' origin (`orig`), 0–8. */
export type GoodsOrigin = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** ICMS of a Simples Nacional issuer, without a credit. */
export interface IcmsSimples {
  readonly regime: "SIMPLES";
  readonly origin: GoodsOrigin;
  readonly csosn: "102" | "103" | "300" | "400" | "500";
}

/** ICMS of a Simples Nacional issuer that grants the buyer a credit (CSOSN 101). */
export interface IcmsSimplesWithCredit {
  readonly regime: "SIMPLES";
  readonly origin: GoodsOrigin;
  readonly csosn: "101";
  readonly creditRateBp: number;
  readonly creditCents: number;
}

/** ICMS fully taxed (CST 00). */
export interface IcmsTaxed {
  readonly regime: "NORMAL";
  readonly origin: GoodsOrigin;
  readonly cst: "00";
  readonly baseCents: number;
  readonly rateBp: number;
  readonly amountCents: number;
}

/** ICMS exempt, not taxed, suspended (40, 41, 50) or collected before by substitution (60). */
export interface IcmsUntaxed {
  readonly regime: "NORMAL";
  readonly origin: GoodsOrigin;
  readonly cst: "40" | "41" | "50" | "60";
}

export type LineIcms = IcmsSimples | IcmsSimplesWithCredit | IcmsTaxed | IcmsUntaxed;

/** The PIS and COFINS situation codes the layout accepts on an outgoing document. */
export type ContributionCst =
  | "01" | "02" | "04" | "05" | "06" | "07" | "08" | "09" | "49" | "50" | "51" | "52" | "53" | "54"
  | "55" | "56" | "60" | "61" | "62" | "63" | "64" | "65" | "66" | "67" | "70" | "71" | "72" | "73"
  | "74" | "75" | "98" | "99";

/**
 * PIS or COFINS. CST 01/02 write the base, the rate and the amount; 04–09
 * write none (send zeros); 49–99 write all three.
 */
export interface LineContribution {
  readonly cst: ContributionCst;
  readonly baseCents: number;
  readonly rateBp: number;
  readonly amountCents: number;
}

/**
 * The IBS/CBS figures of one line — what the engine's `LineTax` carries:
 * `vBC` and, per tax, the NOMINAL rate and the amount. `reductionBp` applies
 * to all three rates (`pRedAliq`; the effective rate is written beside it).
 */
export interface IbsCbsFigures {
  readonly baseCents: number;
  readonly reductionBp: number;
  readonly cbsRateBp: number;
  readonly cbsCents: number;
  readonly ibsUfRateBp: number;
  readonly ibsUfCents: number;
  readonly ibsMunRateBp: number;
  readonly ibsMunCents: number;
}

/** The IBS/CBS group of a line. `figures: null` writes the CST and class only (immunity, say). */
export interface LineIbsCbs {
  /** `CST` of the IBS/CBS, 3 digits. */
  readonly cst: string;
  /** `cClassTrib`, 6 digits. */
  readonly classCode: string;
  readonly figures: IbsCbsFigures | null;
}

/** One item of the document. */
export interface SaleLine {
  /** The host's id; quoted back in a mapping error. */
  readonly id: string;
  /** `cProd`. */
  readonly code: string;
  /** GTIN/EAN, or `null` for "SEM GTIN". */
  readonly gtin: string | null;
  readonly description: string;
  readonly ncm: string;
  readonly cest: string | null;
  readonly cfop: string;
  /** `uCom` and `uTrib`. */
  readonly unit: string;
  /** `qCom` and `qTrib`: positive, at most four decimals. */
  readonly quantity: number;
  /** `vProd`: every unit, BEFORE the line's discount. The unit value is derived. */
  readonly valueCents: number;
  /** `vDesc`. */
  readonly discountCents: number;
  /** `vTotTrib` (the approximate tax of the transparency law), or `null`. */
  readonly approximateTaxCents: number | null;
  /** `infAdProd`. */
  readonly additionalInfo: string | null;
  readonly icms: LineIcms;
  readonly pis: LineContribution;
  readonly cofins: LineContribution;
  /** `null` writes no IBS/CBS group — a regime the engine answered `NONE` for. */
  readonly ibsCbs: LineIbsCbs | null;
}

/** `tPag`. */
export type PaymentMethod =
  | "CASH"
  | "CHECK"
  | "CREDIT_CARD"
  | "DEBIT_CARD"
  | "STORE_CREDIT"
  | "FOOD_VOUCHER"
  | "MEAL_VOUCHER"
  | "GIFT_VOUCHER"
  | "FUEL_VOUCHER"
  | "BANK_SLIP"
  | "BANK_DEPOSIT"
  | "PIX_DYNAMIC"
  | "TRANSFER"
  | "LOYALTY"
  | "PIX_STATIC"
  | "NO_PAYMENT"
  | "OTHER";

export interface CardDetails {
  /** `tpIntegra`: whether the payment went through an integrated terminal. */
  readonly integrated: boolean;
  readonly acquirerCnpj: string | null;
  /** `tBand`, 2 digits. */
  readonly brand: string | null;
  /** `cAut`. */
  readonly authorizationCode: string | null;
}

export interface SalePayment {
  readonly method: PaymentMethod;
  readonly amountCents: number;
  /** Required by the layout for a card and for a Pix; `null` otherwise. */
  readonly card: CardDetails | null;
  /** `xPag`: required when `method` is `OTHER`. */
  readonly description: string | null;
}

/** `finNFe` 1–4. */
export type DocumentPurpose = "NORMAL" | "COMPLEMENTARY" | "ADJUSTMENT" | "RETURN";
/** `idDest` 1–3. */
export type OperationDestination = "INTERNAL" | "INTERSTATE" | "FOREIGN";
/** `indPres` 1, 2, 3, 4, 5, 9. */
export type BuyerPresence =
  | "IN_PERSON"
  | "INTERNET"
  | "TELEPHONE"
  | "HOME_DELIVERY"
  | "IN_PERSON_OFF_PREMISES"
  | "OTHER";
/** `modFrete` 0, 1, 2, 3, 4, 9. */
export type FreightMode =
  | "BY_ISSUER"
  | "BY_RECIPIENT"
  | "BY_THIRD_PARTY"
  | "OWN_BY_ISSUER"
  | "OWN_BY_RECIPIENT"
  | "NONE";

/** `infIntermed`: the third-party platform the sale went through. */
export interface SaleIntermediary {
  readonly cnpj: string;
  /** `idCadIntTran`: the seller's id on that platform. */
  readonly userId: string;
}

/** `infRespTec`: the software house responsible for the issuing system. */
export interface TechnicalResponsible {
  readonly cnpj: string;
  readonly contactName: string;
  readonly email: string;
  readonly phone: string;
}

/** One sale, ready to become an NF-e or an NFC-e. */
export interface SaleForDocument {
  readonly version: 1;
  /** `serie`, 0–999. */
  readonly series: number;
  /** `nNF`, 1–999999999. The package's counter owns it. */
  readonly number: number;
  /**
   * `cNF`: the 8-digit code inside the access key. The caller draws it ONCE and
   * keeps it with the document, so a retried call yields the same key.
   */
  readonly keyCode: string;
  /** `dhEmi`: ISO 8601 with the UTC offset, `2026-11-20T12:30:00-03:00`. */
  readonly issuedAt: string;
  /** `natOp`. */
  readonly operationNature: string;
  readonly purpose: DocumentPurpose;
  readonly destination: OperationDestination;
  readonly presence: BuyerPresence;
  /** `indFinal`. */
  readonly finalConsumer: boolean;
  readonly intermediary: SaleIntermediary | null;
  readonly issuer: DocumentIssuer;
  /** `null` on an NFC-e with no identified buyer. */
  readonly buyer: DocumentBuyer | null;
  /** 1–990 items. */
  readonly lines: readonly SaleLine[];
  readonly freight: FreightMode;
  /** 1–100 payments. */
  readonly payments: readonly SalePayment[];
  /** `vTroco`. */
  readonly changeCents: number;
  readonly additionalInfo: {
    /** `infCpl`. */
    readonly forTaxpayer: string | null;
    /** `infAdFisco`. */
    readonly forTaxAuthority: string | null;
  };
  readonly technicalResponsible: TechnicalResponsible | null;
}
