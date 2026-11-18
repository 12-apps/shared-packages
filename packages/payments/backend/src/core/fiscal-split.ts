/**
 * The tax a charge INFORMS to the split payment (FUT-2239; LC 214/2025 arts.
 * 31-34, the CBS/IBS split the receiver's PSP executes).
 *
 * The host computes the amounts — this package only carries them to the
 * provider, never derives them. Informing nothing is the legal default (art. 33
 * §2-A), so `ChargeInput.fiscalSplit` is optional, and an adapter that cannot
 * carry it IGNORES it: a charge request then contains none of its fields.
 */
export interface FiscalSplitInput {
  /** CBS the receiver informs for this charge, in cents (CGIBS `vlCbsInf`). */
  cbsInformedCents: number;
  /** IBS the receiver informs for this charge, in cents (CGIBS `vlIbsInf`). */
  ibsInformedCents: number;
  /** The fiscal document's 44-digit access key when it already exists, else null (CGIBS `docFiscal`). */
  documentKey: string | null;
}

/**
 * The payment arrangements a split can run on (Decreto 12.955/2026, RCBS art. 28
 * §5). A card is not one of them.
 */
export const SPLIT_ARRANGEMENTS = [
  'BOLETO',
  'PIX_DINAMICO',
  'PIX_AUTOMATICO',
  'PIX_ESTATICO',
  'TED',
  'TEF',
] as const;

export type SplitArrangement = (typeof SPLIT_ARRANGEMENTS)[number];

/**
 * How an adapter writes `fiscalSplit` on the wire. `'none'` (the default) sends
 * nothing; `'stub'` sends the field set the CGIBS OpenAPI 1.1.0 names
 * (`splitFiscal.{vlCbsInf, vlIbsInf, docFiscal}`), for a host to rehearse the
 * pass-through before the provider publishes its own mapping.
 */
export type FiscalSplitFields = 'none' | 'stub';

/** The `splitFiscal` object of a charge request, or nothing when it must not be sent. */
export function fiscalSplitFieldsOf(
  split: FiscalSplitInput | undefined,
  mode: FiscalSplitFields | undefined,
): { splitFiscal: { vlCbsInf: number; vlIbsInf: number; docFiscal: string | null } } | Record<string, never> {
  if (!split || mode !== 'stub') return {};
  return {
    splitFiscal: {
      vlCbsInf: split.cbsInformedCents,
      vlIbsInf: split.ibsInformedCents,
      docFiscal: split.documentKey,
    },
  };
}
