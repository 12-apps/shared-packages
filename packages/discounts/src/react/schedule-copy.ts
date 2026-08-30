/**
 * The weekly schedule editor and the sentence it reads back (FUT-996).
 *
 * The read-back is the highest-value thing on this screen — a grid of chips and
 * two clocks is data, and "Toda sexta, das 16:00 às 20:00" is the promise the
 * operator is actually making. It follows the free-units builder's rule: the
 * sentence appears only once the values make a real offer, so it is never
 * confirmation of something that cannot be saved.
 *
 * Day names are three separate records because Portuguese needs them to be.
 * `dayShort` is a chip ("Seg"), `dayLong` is a list item ("segunda"), and
 * `dayEvery` is a sentence opener whose article follows the day's GENDER
 * ("Toda segunda", "Todo sábado"). Deriving the third from the second would
 * mean encoding Portuguese grammar in a package that must not know which
 * language it is rendering.
 */
export interface DiscountsScheduleCopy {
  /** Section heading over the period and the repetition. */
  readonly sectionTitle: string;
  readonly periodTitle: string;
  readonly periodHint: string;
  readonly repetitionTitle: string;
  /** The two repetition choices. */
  readonly always: string;
  readonly specific: string;
  /** The builder. */
  readonly builderTitle: string;
  readonly addWindow: string;
  readonly removeWindow: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  /** Preset buttons that write into the chips rather than replacing them. */
  readonly presetEveryDay: string;
  readonly presetWeekdays: string;
  readonly presetWeekend: string;
  /** Monday-first, 0..6. */
  readonly dayShort: readonly string[];
  readonly dayLong: readonly string[];
  readonly dayEvery: readonly string[];
  /** Joining a day list: "segunda, terça e quarta". */
  readonly listSeparator: string;
  readonly listLast: string;
  /** Collapsed day sets, so a common week reads as a phrase not a list. */
  readonly allDays: string;
  readonly weekdays: string;
  readonly weekend: string;
  /** The read-back. `{days}`, `{from}`, `{to}`. */
  readonly summary: string;
  /** The same, when the window runs past midnight. */
  readonly summaryOvernight: string;
  /** Whose clock these times are in. `{timezone}`. */
  readonly timezoneNote: string;
  /**
   * What the shopper is promised — stated where the merchant promises it.
   * FUT-996 decision 2: the price follows the moment the item entered the cart.
   */
  readonly guaranteeNote: string;
  /**
   * The ORDER-scope asymmetry, shown ONLY for that combination because it is
   * otherwise invisible: an order-wide rule has no line to anchor to, so it is
   * judged at checkout while every other scope is judged per line.
   */
  readonly orderScopeNote: string;
  /** Grid: the campaign window and the schedule in one cell. `{window}`, `{schedule}`. */
  readonly windowWithSchedule: string;
  /** Grid: a compact schedule, plus "+N" when there are more rows. `{count}`. */
  readonly moreWindows: string;
  /** Grid + card: this rule's hours are running at this moment. */
  readonly activeNow: string;
  /** Refusals. */
  readonly daysRequired: string;
  readonly timesRequired: string;
  readonly windowsRequired: string;
}
