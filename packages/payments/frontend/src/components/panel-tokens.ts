/**
 * The payments screen's own palette and geometry, taken verbatim from the
 * design prototype.
 *
 * Local rather than theme-level on purpose. `@repo/spa-shared/theme` says it in
 * as many words — "re-deriving them here would quietly restyle every admin
 * screen from a function nobody thinks of as owning that" — and the platform
 * primary (`#6366F1`) is a decision already made for the rest of the app. This
 * screen is a designed surface with its own greens, ambers and hairlines, and
 * matching it must not move a single pixel anywhere else.
 *
 * Every value here is a hex the prototype states, not an approximation: a
 * "pixel perfect" screen that rounds its own line colour to `divider` is a
 * screen that looks nearly right and reviews as wrong.
 */
export const T = {
  ink: '#111318',
  ink2: '#3d4350',
  ink3: '#6b7280',
  ink4: '#9aa1ad',
  line: '#e4e7ec',
  line2: '#eef0f4',
  bg: '#ffffff',
  bg2: '#f7f8fa',

  brand: '#5b5bd6',
  brandInk: '#4a4ac4',
  brandSoft: '#eeeefc',
  brandLine: '#c9c9f2',

  ok: '#0f7a4d',
  okSoft: '#e8f6ef',
  okLine: '#bfe5d3',
  okInk: '#0b5c3a',

  warn: '#b45309',
  warnSoft: '#fdf1e3',
  warnLine: '#f3d9b5',
  warnInk: '#7c3d06',

  bad: '#c02626',
  badSoft: '#fdeceb',
  badLine: '#f5c6c2',
  badInk: '#8f1d1d',

  info: '#1d6fa5',
  infoSoft: '#e8f3fb',
  infoLine: '#bfdcf0',
  infoInk: '#14496b',

  mono: '"SFMono-Regular",ui-monospace,Menlo,Consolas,monospace',
} as const;

/** The card that bounds one provider: hairline, 12px, nothing clipped. */
export const CARD_SX = {
  border: `1px solid ${T.line}`,
  borderRadius: '12px',
  background: T.bg,
  overflow: 'hidden',
} as const;

/**
 * A step's panel — the bordered block a single step lives in.
 *
 * `overflow: hidden` matters: the action bar below sticks to its bottom edge
 * and would otherwise paint over the rounded corner.
 */
export const PANEL_SX = {
  border: `1px solid ${T.line}`,
  borderRadius: '11px',
  overflow: 'hidden',
  mx: '20px',
  mb: '20px',
} as const;

/**
 * The action bar: the primary control, always the last thing in the block the
 * owner just filled.
 *
 * Sticky rather than merely last, so on a long step (the four credential boxes,
 * the card form) the button the owner is working toward stays on screen instead
 * of being something they have to go and find.
 */
export const BAR_SX = {
  position: 'sticky',
  bottom: 0,
  background: 'rgba(255,255,255,.94)',
  backdropFilter: 'blur(6px)',
  borderTop: `1px solid ${T.line}`,
  px: '18px',
  py: '12px',
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
} as const;

/** The sentence beside the button — why it is enabled, or what just happened. */
export const BAR_MSG_SX = {
  fontSize: '12.5px',
  color: T.ink3,
  flex: 1,
  minWidth: '140px',
  lineHeight: 1.4,
} as const;

/** Primary: the one thing this step is for. */
export const BTN_PRIMARY_SX = {
  borderRadius: '8px',
  px: '18px',
  py: '10px',
  fontSize: '13.5px',
  fontWeight: 650,
  textTransform: 'none',
  boxShadow: 'none',
  background: T.brand,
  color: '#fff',
  '&:hover': { background: T.brandInk, boxShadow: 'none' },
  '&.Mui-disabled': { background: '#c9cad6', color: '#fff' },
} as const;

/** Secondary: a real alternative, not a lesser primary. */
export const BTN_SECONDARY_SX = {
  borderRadius: '8px',
  px: '18px',
  py: '10px',
  fontSize: '13.5px',
  fontWeight: 650,
  textTransform: 'none',
  background: T.bg,
  border: `1px solid ${T.line}`,
  color: T.ink2,
  '&:hover': { borderColor: T.ink4, background: T.bg },
} as const;

/**
 * Destructive, stated quietly.
 *
 * "Remover conexão" sits beside the step's own button and must not compete with
 * it — an owner reaches this deliberately or not at all, and a red filled button
 * on every step is an invitation to misclick.
 */
export const BTN_QUIET_DANGER_SX = {
  background: 'none',
  border: 0,
  color: T.bad,
  px: '6px',
  py: '10px',
  fontSize: '13.5px',
  fontWeight: 600,
  textTransform: 'none',
  '&:hover': { background: 'none', textDecoration: 'underline' },
} as const;

/** An inline text control — the way between the two connection paths. */
export const LINKISH_SX = {
  background: 'none',
  border: 0,
  color: T.brand,
  fontSize: '12.5px',
  p: 0,
  minWidth: 0,
  textTransform: 'none',
  verticalAlign: 'baseline',
  '&:hover': { background: 'none', textDecoration: 'underline' },
} as const;
