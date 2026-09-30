/**
 * The setting-card family's lengths, in design px. The web reads every one
 * through `rem(theme, n)`, so they scale with the host's type scale.
 */
export const SETTING_CARD = {
  /** Between the icon and the title. */
  iconGap: 12,
  /** The spinner beside a switch while its flip is saving. */
  spinnerSize: 16,
  /** How far a group's dependent rows sit in from its main switch. */
  groupIndent: 24,
  /** The rule down the left of a group's dependent rows. */
  groupRuleWidth: 2,
  /** The narrowest a grid column gets by default. */
  gridMinColumnWidth: 320,
  /** The widest the [i]'s full-summary tooltip gets. */
  infoMaxWidth: 360,
  /** The [i]'s keyboard focus ring: its width, and its gap from the glyph. */
  infoFocusRingWidth: 2,
  infoFocusRingOffset: 2,
} as const;

/** The grid's default gap, in theme SPACING units (not px): what `sx`'s `gap: 2` means. */
export const SETTING_GRID_GAP_UNITS = 2;

/** How faded a group's dependent rows are while the main switch is off. */
export const SETTING_GROUP_INACTIVE_OPACITY = 0.5;
