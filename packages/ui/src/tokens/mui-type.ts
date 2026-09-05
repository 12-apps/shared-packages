import type { UiTheme } from './theme';

/**
 * MUI'S DEFAULT `Typography` VARIANTS, AS NUMBERS.
 *
 * Several web components render a title or a message BY NAME —
 * `<Typography variant="h6">` — and let MUI's theme turn the name into a
 * size. The native halves have no MUI theme, so they need the numbers MUI's
 * `createTypography` produces for those names. These are those numbers, for
 * the variants the ported components use: `fontSize` in px, `lineHeight` as
 * a ratio, `letterSpacing` in em exactly as MUI rounds it
 * (`round(letterSpacing / size)`, five decimals).
 *
 * Only the DEFAULTS. A host that re-themes `typography.h6` moves the web
 * halves and not these; each component that reads this records that as a
 * known gap in its `NATIVE-NOTES.md`.
 */
export type MuiTypeVariantName = 'h6' | 'body1' | 'body2' | 'caption';

export interface MuiTypeVariant {
  fontSize: number;
  lineHeight: number;
  fontWeight: 400 | 500;
  letterSpacingEm: number;
}

export const MUI_TYPE: Record<MuiTypeVariantName, MuiTypeVariant> = {
  h6: { fontSize: 20, lineHeight: 1.6, fontWeight: 500, letterSpacingEm: 0.0075 },
  body1: { fontSize: 16, lineHeight: 1.5, fontWeight: 400, letterSpacingEm: 0.00938 },
  body2: { fontSize: 14, lineHeight: 1.43, fontWeight: 400, letterSpacingEm: 0.01071 },
  caption: { fontSize: 12, lineHeight: 1.66, fontWeight: 400, letterSpacingEm: 0.03333 },
};

/** MUI's `theme.typography.fontWeightMedium`, which several web styles name outright. */
export const MUI_FONT_WEIGHT_MEDIUM = 500;

/** A variant multiplied out for a renderer whose `lineHeight` and `letterSpacing` are absolute. */
export interface MuiTypeStyle {
  fontFamily: string | undefined;
  fontSize: number;
  lineHeight: number;
  fontWeight: `${MuiTypeVariant['fontWeight']}`;
  letterSpacing: number;
}

/**
 * The variant as absolute numbers, in the theme's font. `fontSize` may be
 * overridden — the Alert's title is `body1` at 1.05rem — and the ratios
 * follow it, which is what the browser does with `em` and a unitless
 * line-height.
 */
export function muiTypeStyle(
  theme: Pick<UiTheme, 'typography'>,
  variant: MuiTypeVariantName,
  fontSize: number = MUI_TYPE[variant].fontSize,
): MuiTypeStyle {
  const step = MUI_TYPE[variant];
  return {
    fontFamily: theme.typography.fontFamily,
    fontSize,
    lineHeight: fontSize * step.lineHeight,
    fontWeight: `${step.fontWeight}`,
    letterSpacing: fontSize * step.letterSpacingEm,
  };
}
