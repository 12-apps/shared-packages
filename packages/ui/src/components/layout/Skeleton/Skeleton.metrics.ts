import type { SkeletonIntensity, SkeletonVariant } from './Skeleton.base';

/**
 * THE NUMBERS BOTH `Skeleton` RENDERERS DRAW WITH.
 *
 * `Skeleton.styles.ts` (web, emotion over MUI's own `Skeleton`) and
 * `Skeleton.native.tsx` (React Native) read this one table. The web turns them
 * into CSS strings — `blur(20px)`, `shimmer 2s infinite` — and native uses the
 * numbers as they are, so neither renderer restates a value.
 *
 * Two groups live here. The first is what the web component WRITES (the
 * intensity alphas, the default box, the glass and shimmer washes). The second
 * is what MUI's own `Skeleton` contributes on the web and the native half
 * therefore has to restate: its pulse keyframe, its wave cadence, and the
 * geometry of the `text` variant. Those are MUI's DEFAULTS — a host that
 * re-themes them moves the web only, which `NATIVE-NOTES.md` records.
 */

/** The tint's alpha over the ink, per intensity. */
export const SKELETON_INTENSITY_OPACITY: Record<SkeletonIntensity, number> = {
  low: 0.11,
  medium: 0.13,
  high: 0.15,
};

/** The box a variant draws when the caller gives no `width`/`height`. */
export const SKELETON_DEFAULT_DIMENSIONS: Record<
  SkeletonVariant,
  { width: number | string; height: number | undefined }
> = {
  // `text` has no height of its own: MUI's line box gives it one (below).
  text: { width: '100%', height: undefined },
  circular: { width: 40, height: 40 },
  rectangular: { width: '100%', height: 40 },
  wave: { width: '100%', height: 40 },
};

/* ── `glassmorphism` ──────────────────────────────────────────────────────── */

/** The 135° wash over `background.paper`, from the first stop to the last. */
export const GLASS_BACKGROUND_ALPHA_FROM = 0.8;
export const GLASS_BACKGROUND_ALPHA_TO = 0.4;
export const GLASS_BLUR_PX = 20;
export const GLASS_BORDER_ALPHA = 0.2;
/** `0 8px 32px 0 rgba(0, 0, 0, 0.1)`. */
export const GLASS_SHADOW = { offsetY: 8, blur: 32, alpha: 0.1 } as const;

/* ── `shimmer` ────────────────────────────────────────────────────────────── */

/** The sweep's middle stop, over white. */
export const SHIMMER_ALPHA = 0.3;
export const SHIMMER_DURATION_MS = 2000;

/**
 * MUI's `palette.common`, which is a pair of fixed hexes rather than anything
 * derived — so the shared theme has no slot for them and they are named here.
 */
export const COMMON_BLACK = '#000';
export const COMMON_WHITE = '#fff';

/* ── MUI's own `Skeleton`, restated for the renderer that has no MUI ──────── */

/**
 * MUI's `pulseKeyframe`: opacity 1 → 0.4 → 1, `2s ease-in-out 0.5s infinite`.
 * The delay runs once on the web; native replays it each lap unless the
 * animation is sequenced, which `Skeleton.native.tsx` does.
 */
export const PULSE = { durationMs: 2000, delayMs: 500, dip: 0.4 } as const;

/** MUI's `wave` sweep: `1.6s linear 0.5s infinite`, in `palette.action.hover`. */
export const WAVE = { durationMs: 1600, delayMs: 500 } as const;

/**
 * The `text` variant, as MUI draws it: a line box `1.2em` tall squashed to 60%
 * of its height (`transform: scale(1, 0.60)`), with a `4px/6.7px` elliptical
 * radius that the same squash turns back into a round 4px. React Native has no
 * `em`, and its transforms do not change layout, so the native half multiplies
 * the two out into one height and draws the plain 4px radius the squash lands on.
 */
export const TEXT_LINE_HEIGHT_EM = 1.2;
export const TEXT_SCALE_Y = 0.6;
