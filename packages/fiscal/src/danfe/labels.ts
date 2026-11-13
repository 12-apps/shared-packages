/**
 * The words a DANFE NFC-e prints. The layout is the Manual do DANFE NFC-e's
 * and the words are the host's language: a host passes them all, or the
 * `./pt-BR` pack, which carries the Manual's own texts. Nothing here defaults.
 */

export interface DanfeNfceLabels {
  /** Division I. */
  readonly cnpj: string;
  readonly stateRegistration: string;
  /** Division II: the document's own title. */
  readonly title: string;
  /** Division III: the item table's header. */
  readonly itemsHeader: string;
  /** Division IV. */
  readonly itemCount: string;
  readonly totalValue: string;
  readonly discounts: string;
  readonly amountDue: string;
  readonly paymentHeader: string;
  readonly change: string;
  /** `tPag` code (`01`, `17`…) → the method's name; an unknown code prints itself. */
  readonly paymentMethods: Readonly<Record<string, string>>;
  /** Division V. */
  readonly lookupByKey: string;
  readonly homologation: string;
  readonly contingency: string;
  readonly pendingAuthorization: string;
  /** Printed on a paper signed offline and not yet authorised: the one copy, the consumer's. */
  readonly consumerCopy: string;
  /** Division VI. */
  readonly consumer: string;
  readonly unidentifiedConsumer: string;
  /** Division VII. */
  readonly number: string;
  readonly series: string;
  readonly protocol: string;
  readonly authorizedAt: string;
  /** Division VIII and after: the QR code's caption and the approximate tax line (Lei 12.741/2012). */
  readonly qrCaption: string;
  readonly approximateTaxes: string;
}

export const DANFE_LABEL_KEYS: readonly (keyof DanfeNfceLabels)[] = [
  "cnpj", "stateRegistration", "title", "itemsHeader", "itemCount", "totalValue", "discounts", "amountDue",
  "paymentHeader", "change", "paymentMethods", "lookupByKey", "homologation", "contingency", "pendingAuthorization",
  "consumerCopy",
  "consumer", "unidentifiedConsumer", "number", "series", "protocol", "authorizedAt", "qrCaption", "approximateTaxes",
];
