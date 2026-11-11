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
  /** The extend dialog. */
  readonly extendTitle: string;
  /** Under the title, `{count}`. */
  readonly extendSelected: string;
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
  readonly extendHint: string;
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
