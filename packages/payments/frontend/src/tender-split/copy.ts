/**
 * Every word `TenderSplit` puts in front of the operator.
 *
 * Required, with no defaults — this package's own doctrine (see
 * `../card/copy.ts`): a default in one host's language reads as finished to
 * the next host until somebody sees it. The tenders' own names are not here
 * either; they arrive with each {@link TenderOption}, because which tenders a
 * store takes, and what it calls them, is the host's catalogue.
 *
 * The functions receive amounts ALREADY formatted in the host's locale and
 * currency, so no sentence here builds a number itself.
 */
export interface TenderSplitCopy {
  /** Beside the amount already carried by the picks — "Lançado". */
  readonly launchedLabel: string;
  /** Beside the amount still unpaid — "Falta". */
  readonly missingLabel: string;
  /** Once the picks cover the bill — "Fechou". */
  readonly coveredLabel: string;
  /** The picks pass the bill with nothing to hand back — "Passou R$ 5,00". */
  readonly over: (amount: string) => string;
  /** Names the progress bar for a screen reader. */
  readonly progressLabel: string;
  /** Beside the currency sign of a tender that takes an equal share — "dividido". */
  readonly sharedHint: string;
  /** Names a tender's amount field for a screen reader — "Valor em Dinheiro". */
  readonly amountLabel: (tender: string) => string;
  /** Names the control that drops a tender — "Tirar Dinheiro". */
  readonly remove: (tender: string) => string;
  /** The line naming the change handed back — "Troco". */
  readonly changeLabel: string;
  /** The confirm, before any tender is picked — "Escolha a forma". */
  readonly pickFirst: string;
  /** The confirm, while part of the bill is unpaid — "Falta R$ 5,00". */
  readonly missing: (amount: string) => string;
  /** The confirm, while a typed amount is not an amount. */
  readonly invalid: string;
  /** The confirm, once the bill is covered — "Confirmar R$ 82,00". */
  readonly confirm: (amount: string) => string;
  readonly cancel: string;
}
