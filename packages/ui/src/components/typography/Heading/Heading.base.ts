import type React from 'react';

import type { HeadingLevel } from '../../../tokens/heading-scale';
import type { ColorValue } from '../../../tokens/vocabulary';

/**
 * THE CONTRACT BOTH `Heading` RENDERERS HONOUR — and nothing else.
 *
 * No MUI and no react-native here, on purpose: this file ships in both
 * declaration outputs (`dist/types` and `dist/types-native`), and a native
 * consumer has no `@mui/material` to resolve a type import against. The web
 * adds a heading element's attributes in `Heading.types.ts`; the native side
 * adds a react-native `Text`'s props in `Heading.types.native.ts`.
 */
export type { HeadingLevel };

export type HeadingWeight = 'light' | 'normal' | 'medium' | 'semibold' | 'bold';

export interface HeadingBaseProps {
  /**
   * The heading's RANK — which tag it renders (`aria-level` on native) and
   * where it sits in the document outline. Not its size; see {@link HeadingBaseProps.size}.
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
  /** `normal` is the weight the step was designed to carry, not body text's 400. */
  weight?: HeadingWeight;
  /** Paint the glyphs with the colour's two-stop gradient (the first stop, flat, on native). */
  gradient?: boolean;
  children: React.ReactNode;
  testID?: string;
  dataTestId?: string;
}
