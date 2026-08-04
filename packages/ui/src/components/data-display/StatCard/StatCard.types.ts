import type { ReactNode } from 'react';

/** Which way a metric moved over the comparison window. */
export type StatCardDeltaDirection = 'up' | 'down' | 'neutral';

/**
 * How the movement should READ to the user. Direction and meaning are separate
 * concerns: revenue going up is good, cost going up is bad — so a consumer can
 * override the tone without lying about the arrow.
 */
export type StatCardDeltaTone = 'positive' | 'negative' | 'neutral';

/** The optional period-over-period change shown beneath a stat's value. */
export interface StatCardDelta {
  /**
   * Pre-formatted change, e.g. `"+12,5%"` or `"-R$ 320,00"`. Formatting
   * (locale, currency, precision) belongs to the caller, exactly as {@link
   * StatCardProps.value} does.
   */
  value: string;
  /** The arrow/geometry: which way the metric moved. */
  direction: StatCardDeltaDirection;
  /**
   * The semantic colour. Defaults to the direction's natural reading
   * (`up` → positive, `down` → negative, `neutral` → neutral); pass it
   * explicitly for "lower is better" metrics such as cost.
   */
  tone?: StatCardDeltaTone;
  /** Optional context for the comparison, e.g. `"vs. período anterior"`. */
  label?: string;
  /**
   * Overrides the generated screen-reader sentence (which is English by
   * default) — pass a localized string when the surrounding app is not English.
   */
  ariaLabel?: string;
}

/** Props for the {@link StatCard} KPI tile. */
export interface StatCardProps {
  /** What the figure measures, e.g. `"Receita"`. */
  label: string;
  /**
   * The figure itself, ALREADY formatted (`"R$ 1.250,00"`, `"60,0%"`, `12`).
   * The tile never formats: money/percent/locale rules live with the caller.
   */
  value: ReactNode;
  /** Optional period-over-period change rendered under the value. */
  delta?: StatCardDelta;
  /** Optional leading icon rendered beside the label. */
  icon?: ReactNode;
  /** Optional clarifying line under the value, e.g. the range being measured. */
  hint?: string;
  /**
   * While true the value/delta are replaced by skeletons and the tile is
   * announced as busy — the label stays, so the grid never reflows on load.
   */
  loading?: boolean;
  /** Custom className for the tile root. */
  className?: string;
  /** Test id for the tile root; child test ids are derived from it. */
  dataTestId?: string;
}
