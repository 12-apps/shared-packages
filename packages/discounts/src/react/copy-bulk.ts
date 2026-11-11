/**
 * The bulk actions' words (FUT-4420): the three entries of "Ações", the extend
 * dialog, and the sentences a host's report renders around the per-row
 * messages the server answers. Optional as a group on {@link DiscountsWebCopy}
 * - a pack written before the bulk actions is filled in from the package's own
 * - and a host that wires no `bulkSlot` never shows any of it.
 */
export interface DiscountsBulkCopy {
  readonly activateAll: string;
  readonly deactivateAll: string;
  readonly extend: string;
  /** The extend dialog's title for ONE discount and for `{count}` of them. */
  readonly extendTitleOne: string;
  readonly extendTitleMany: string;
  readonly modeLabel: string;
  readonly modeDays: string;
  readonly modeDate: string;
  readonly daysLabel: string;
  readonly daysSuffix: string;
  readonly dateLabel: string;
  readonly datePlaceholder: string;
  readonly dateInvalid: string;
  readonly dateIncomplete: string;
  readonly daysRequired: string;
  /** The hint under "+ dias": counts from each end, ended ones from today. */
  readonly extendHintDays: string;
  /** The hint under "Nova data": the date rule, said before saving. */
  readonly extendHintDate: string;
  /** A "Nova data" before today is refused in the dialog, before saving. */
  readonly datePast: string;
  /** Nothing answered (or the server failed) on a request that must not be sent twice. */
  readonly outcomeUnknown: string;
  /** The confirm button, `{count}`. */
  readonly extendConfirm: string;
  readonly cancel: string;
  /** The ✕ and back of the dialog. */
  readonly close: string;
  readonly back: string;
  /** The request itself failed (nothing answered, or a 4xx with no sentence). */
  readonly requestFailed: string;
  /** More than the cap was selected; `{max}`. */
  readonly tooMany: string;
}
