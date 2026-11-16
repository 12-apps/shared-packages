/** One part of the whole: a payment method, a channel, a category. */
export interface ShareBarSegment {
  /** Stable key; also the segment's test-id suffix. */
  key: string;
  /** The part's name, in the host's words: "Pix", "Balcão". */
  label: string;
  /** The part's figure, in any unit; only its share of the total is drawn. A value at or under 0 draws no segment. */
  value: number;
  /** The segment's fill; default the component's role palette, in order. */
  color?: string;
}

export interface ShareBarProps {
  /** The parts, in the order they are drawn left to right and listed. */
  segments: readonly ShareBarSegment[];
  /** The list's accessible name, e.g. "Vendas por forma de pagamento". */
  label: string;
  /**
   * How a share reads, given the WHOLE percent (the rounded shares add to
   * exactly 100). Default `"45%"`.
   */
  formatPercent?: (percent: number) => string;
  /** When given, each list row also shows the part's figure, e.g. "R$ 1.240". */
  formatValue?: (value: number) => string;
  /** The bar's height in px at the design scale. Default 24. */
  height?: number;
  /**
   * Whether a segment wide enough to hold its percent shows it inside the bar.
   * Default true. A narrow segment never shows a clipped one: its percent is
   * in the list.
   */
  inlinePercent?: boolean;
  className?: string;
  /** Root test id; segments are `<id>-segment-<key>`, rows `<id>-item-<key>`. Default `share-bar`. */
  dataTestId?: string;
}
