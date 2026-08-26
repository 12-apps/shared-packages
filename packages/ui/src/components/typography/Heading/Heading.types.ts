import type { HeadingLevel } from '../../../tokens/typography';
import type { ColorValue } from '../../../tokens/scales';
import type React from 'react';

/**
 * Re-exported, not re-declared. It was spelled out here AND (as `Level`) inside
 * `Heading.styles.ts`, so the union and the metrics table were two lists nothing
 * kept in step — the failure `tokens/scales.ts` was written to end.
 */
export type { HeadingLevel };

export interface HeadingProps extends React.HTMLAttributes<globalThis.HTMLHeadingElement> {
  /**
   * The heading's RANK — which tag it renders and where it sits in the document
   * outline. Not its size; see {@link HeadingProps.size}.
   */
  level?: HeadingLevel;
  /**
   * The step of the type scale to DRAW, when it differs from the rank. Defaults
   * to `level`, so every call written before this prop existed renders exactly
   * as it did.
   *
   * It exists because `level` used to do three jobs at once — pick the tag, set
   * the outline rank, set the font size — with no way to separate them. A page
   * title is an `h1` to a screen reader whatever it looks like, and a dense
   * screen may not want it drawn at the rank's size. Before this the only way to
   * say that was to override the component's CSS from outside, which each
   * consuming app ended up doing in its own dialect.
   *
   * ```tsx
   * <Heading level="h1" size="h3">Visão geral</Heading>
   * ```
   *
   * Reach for it when the two genuinely differ for ONE heading. If a whole
   * product wants a different scale, set `typography.headingScale` on the theme
   * instead — that is the knob for "our headings are smaller", and this is the
   * one for "this heading is".
   */
  size?: HeadingLevel;
  color?: ColorValue;
  weight?: 'light' | 'normal' | 'medium' | 'semibold' | 'bold';
  gradient?: boolean;
  children: React.ReactNode;
}
