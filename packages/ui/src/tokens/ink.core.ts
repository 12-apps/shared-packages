/**
 * THE COLOURS THAT HAVE NO PALETTE ROLE, NAMED — with no renderer behind them.
 *
 * Every colour a component draws comes from the theme (FUT-2593, under
 * FUT-2585). Most have a palette role — text, divider, a semantic main, a
 * neutral tone (`./ink.ts`). These do not: a chart's neon series, a map's
 * terrain, a code editor's syntax chrome, a vendor's brand. They were hex
 * literals inside components; they are NAMED sets here, which a host can
 * replace through `theme.uiInk` (`./ink.ts`), and each default is exactly the
 * value the component drew before, so moving it here changed nothing on screen.
 *
 * This file imports nothing: `*.metrics.ts` tables, which the native renderer
 * reads too, take their colours from it.
 */

/** The `neon` Chart variant: its series, its ground, its accent (`Chart`). */
export const DATA_VIZ_NEON = {
  series: ['#00ffff', '#ff00ff', '#ffff00', '#00ff00', '#ff0080', '#8000ff'],
  ground: '#000',
  accent: '#00ffff',
} as const;

/** The phases a `TimingDiagram` bar is split into, in order. */
export const TIMING_PHASES = {
  dns: '#9C27B0',
  connect: '#2196F3',
  tls: '#00BCD4',
  request: '#4CAF50',
  response: '#FF9800',
} as const;

/** `MapPreview`'s ground for the terrain and satellite map types. */
export const MAP_SURFACE = {
  terrainFrom: '#8BC34A',
  terrainTo: '#4CAF50',
  terrainTileFrom: '#7cb342',
  terrainTileTo: '#558b2f',
  satelliteTileFrom: '#1a1a1a',
  satelliteTileTo: '#2a2a2a',
} as const;

/** `CodeEditor`'s Monaco chrome, per mode — GitHub's own light and dark. */
export const CODE_EDITOR_CHROME = {
  light: {
    background: '#FFFFFF',
    foreground: '#24292E',
    lineHighlight: '#F6F8FA',
    lineNumber: '#959DA5',
    lineNumberActive: '#24292E',
    gutterBorder: '#D1D5DA',
    selection: '#C8E1FF',
  },
  dark: {
    background: '#0D1117',
    foreground: '#C9D1D9',
    lineHighlight: '#161B22',
    lineNumber: '#8B949E',
    lineNumberActive: '#C9D1D9',
    gutterBorder: '#21262D',
    selection: '#3392FF44',
  },
} as const;

/**
 * The social-login providers' OWN colours. Brand rules fix these — a host may
 * not "theme" Google's button — so the override exists only for a provider that
 * changes its guideline.
 */
export const SOCIAL_BRAND = {
  googleLogo: { blue: '#4285F4', green: '#34A853', yellow: '#FBBC05', red: '#EA4335' },
  google: { background: '#ffffff', text: '#1f1f1f', border: '#dadce0', hover: '#f5f5f5', hoverBorder: '#dadce0' },
  facebook: { background: '#1877F2', text: '#ffffff', hover: '#166fe5', logo: '#1877F2' },
  apple: { background: '#000000', text: '#ffffff', hover: '#1a1a1a' },
} as const;

/** The two decorative gradients a completed step and a tutorial's call to action wear. */
export const CELEBRATION_GRADIENTS = {
  mint: ['#84fab0', '#8fd3f4'],
  violet: ['#667eea', '#764ba2'],
} as const;

/** A count that wants attention before it is read (`NavigationMenu`'s badge). */
export const ATTENTION_INK = { from: '#ff5252', to: '#ff1744', glow: 'rgb(255, 23, 68)' } as const;

/** A search hit inside a row label (`CategorySelect`). */
export const HIGHLIGHT_MARK = '#fff2a8';

/** The slate a frosted breadcrumb bar is tinted with in dark mode. */
export const GLASS_SLATE = 'rgb(17, 24, 39)';

/** The ink of a raised floating panel's shadow (`CategorySelect`). */
export const PANEL_SHADOW_INK = 'rgb(16, 20, 35)';

/**
 * Glows that were drawn in a FIXED hue rather than the host's primary: MUI's
 * default blue (`Checkbox`, `NavigationMenu`) and the platform's default indigo
 * (`Breadcrumbs`). Kept as they are — moving them onto `palette.primary` would
 * recolour them for every host — and named so that a host can.
 */
export const EFFECT_GLOW = { muiBlue: 'rgb(25, 118, 210)', brandIndigo: 'rgb(99, 102, 241)' } as const;

/**
 * MUI's own elevation shadows 1, 2, 3 and 8 — what `theme.shadows[n]` holds at
 * MUI's defaults — for the `*.metrics.ts` tables the native renderer reads.
 */
export const ELEVATION_SHADOWS = {
  1: '0px 2px 1px -1px rgba(0,0,0,0.2),0px 1px 1px 0px rgba(0,0,0,0.14),0px 1px 3px 0px rgba(0,0,0,0.12)',
  2: '0px 3px 1px -2px rgba(0,0,0,0.2),0px 2px 2px 0px rgba(0,0,0,0.14),0px 1px 5px 0px rgba(0,0,0,0.12)',
  3: '0px 3px 3px -2px rgba(0,0,0,0.2),0px 3px 4px 0px rgba(0,0,0,0.14),0px 1px 8px 0px rgba(0,0,0,0.12)',
  8: '0px 5px 5px -3px rgba(0,0,0,0.2),0px 8px 10px 1px rgba(0,0,0,0.14),0px 3px 14px 2px rgba(0,0,0,0.12)',
} as const;

/** The two absolutes, for a renderer with no palette to read them from. */
export const ABSOLUTE_INK = { black: '#000', white: '#fff' } as const;

/** The grey ramp's steps the neutral tones are drawn from (MUI's). */
export const NEUTRAL_RAMP = {
  50: '#fafafa',
  100: '#f5f5f5',
  200: '#eeeeee',
  300: '#e0e0e0',
  400: '#bdbdbd',
  500: '#9e9e9e',
  600: '#757575',
  700: '#616161',
  800: '#424242',
  900: '#212121',
} as const;
