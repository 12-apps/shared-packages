import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';

import { LazyImage } from './LazyImage';
import { DEFAULT_FIELD_HEIGHT, FIELD_HEIGHT_SCALE } from '../../../tokens/field-height.core';

/**
 * FUT-2774's two "unverified" sizing claims, checked in a REAL BROWSER — the
 * only tier that runs actual CSS layout rather than jsdom's literal style
 * strings. Both reproduced (Chromium, 2026-09-26) and were recorded here as
 * permanent characterization stories asserting TODAY's collapsed `0` — see
 * FUT-2805 for the full root-cause writeup.
 *
 * FUT-2805's Decision (2026-09-27) fixed both, for the PLACEHOLDER only (the
 * loading skeleton and the `ReactNode` error fallback) — never the loaded
 * real image, which keeps sizing itself from `metrics` exactly as FUT-2774
 * left it (`brand-link.tsx`'s logo relies on an unset width sizing the real
 * `<img>` naturally). An unset axis now borrows the set one (height = width,
 * or width = height — a square placeholder); with neither set, both take the
 * theme's field height (`theme.fieldHeight`, through the existing
 * `fieldHeight()`/`rem()` helpers). The two stories below are REWRITTEN to
 * assert that fixed, non-zero behaviour instead of the old collapse. The
 * three stories after them prove the flip side: a loaded real image's own
 * geometry is untouched by this default, for a width-only, a height-only and
 * a neither-set caller alike.
 */
const meta: Meta<typeof LazyImage> = {
  title: 'Media/LazyImage/Tests',
  component: LazyImage,
  parameters: { layout: 'padded' },
  tags: ['autodocs', 'test', 'component:LazyImage'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const NEVER_RESOLVES = 'https://lazyimage-fut2774.invalid/never-resolves.png';
const ALWAYS_ERRORS = 'https://lazyimage-fut2774.invalid/always-errors.png';

/**
 * A tiny (120×80, so clearly non-square and distinct from any plausible
 * field-height default) opaque PNG, inline as a `data:` URI — it decodes with
 * no network request at all, so a story using it loads deterministically
 * without `.storybook/test-runner.ts`'s route interception.
 */
const LOADS_IMMEDIATELY =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAABQCAIAAABd+SbeAAAAg0lEQVR42u3QQQ0AAAgEoOtkScMZyhbOBxsJSPVwIApEi0a0aNEWRItGtGjRFkSLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGI/mMBAXhJ2KHxSr8AAAAASUVORK5CYII=';
const NATURAL_WIDTH = 120;
const NATURAL_HEIGHT = 80;

/**
 * The rectangle of `element` as actually painted: its own box, intersected
 * with every ancestor (up to `root`) whose computed `overflow` clips —
 * `hidden` or `clip`. `auto`/`scroll` are left out: they clip only what a
 * viewer has not scrolled to, which is not what FUT-2774 #4 is about.
 * Zero width or height here means nothing of `element` is visible, even
 * though `element.getBoundingClientRect()` alone would still report its own
 * unclipped, content-based size.
 */
function clippedRect(rect: DOMRect, node: Element | null, root: Element): DOMRect {
  if (!node || node === root.parentElement) return rect;
  const clips = ['hidden', 'clip'].includes(getComputedStyle(node).overflow);
  if (!clips) return clippedRect(rect, node.parentElement, root);

  const clip = node.getBoundingClientRect();
  const left = Math.max(rect.left, clip.left);
  const top = Math.max(rect.top, clip.top);
  const right = Math.min(rect.right, clip.right);
  const bottom = Math.min(rect.bottom, clip.bottom);
  const next = new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
  return clippedRect(next, node.parentElement, root);
}

function visibleRect(element: Element, root: Element): DOMRect {
  return clippedRect(element.getBoundingClientRect(), element.parentElement, root);
}

/**
 * The theme's field height in real px, measured the same way the component
 * derives it (`fieldHeightRem`, at the `'md'` step) rather than a hard-coded
 * number — this Storybook's theme (`.storybook/preview.tsx`) is a plain MUI
 * `createTheme`, so `theme.fieldHeight` is unset and `DEFAULT_FIELD_HEIGHT`
 * is what resolves; reading the root font size rather than assuming `16`
 * keeps this from silently drifting if that ever changes.
 */
function expectedFieldHeightPx(): number {
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return DEFAULT_FIELD_HEIGHT * FIELD_HEIGHT_SCALE.md * rootPx;
}

// Chromium rounds sub-pixel layout to 1/64px; comparisons below use this
// instead of exact equality (per this package's own story-test convention).
const PX_TOLERANCE = 0.6;

export const UnsetWidthSkeletonInAutoWidthBox: Story = {
  // FUT-2774 #5, FIXED by FUT-2805: an unset `width` (and here `height` too —
  // neither axis is passed) used to default `SkeletonIndicator` to the
  // literal `'100%'`/`'auto'`, inside `ImageContainer` (`display:
  // inline-block`, itself `width: auto` when `width` is unset) — a
  // percentage width inside a shrink-to-fit parent resolved to exactly 0.
  //
  // FIXED (Chromium): with neither axis set, the Decision gives the skeleton
  // both dimensions from the theme's field height — a square, non-zero
  // placeholder — which also lets `ImageContainer`'s own shrink-to-fit width
  // resolve from the skeleton's now-definite size instead of collapsing.
  name: '🔬 FUT-2805: skeleton, LazyImage width+height unset (fixed, was #5)',
  args: {
    src: NEVER_RESOLVES,
    alt: 'probe',
    lazy: false,
    'data-testid': 'skel-probe',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const skeleton = await canvas.findByTestId('skel-probe-skeleton');
    const rect = skeleton.getBoundingClientRect();
    const expected = expectedFieldHeightPx();

    await expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    // A square placeholder at the theme's field height (neither axis set).
    expect(Math.abs(rect.width - rect.height)).toBeLessThan(PX_TOLERANCE);
    expect(Math.abs(rect.width - expected)).toBeLessThan(PX_TOLERANCE);
    expect(Math.abs(rect.height - expected)).toBeLessThan(PX_TOLERANCE);
  },
};

export const UnsetHeightFallbackClipping: Story = {
  // FUT-2774 #4, FIXED by FUT-2805: with `state.hasError` true, the real
  // `<img>` and the loading indicator are both gone, so `ImageContainer`
  // (`overflow: hidden`) had NO in-flow content to size itself from — its
  // `height: auto` (and, with neither axis set here, its `width: auto` too)
  // collapsed to 0, clipping the absolutely-positioned `FallbackContainer`
  // entirely away even though the fallback's own content had a real,
  // nonzero natural size.
  //
  // FIXED (Chromium): with neither axis set, the Decision sizes
  // `ImageContainer` ITSELF (the one thing here that can, since
  // `FallbackContainer` is `position: absolute` and never feeds its
  // ancestor's shrink-to-fit/auto-height no matter its own size) from the
  // theme's field height — a square — so `overflow: hidden` no longer clips
  // the fallback's content to nothing.
  name: '🔬 FUT-2805: ReactNode fallback, LazyImage width+height unset (fixed, was #4)',
  args: {
    src: ALWAYS_ERRORS,
    alt: 'probe',
    lazy: false,
    retryOnError: false,
    'data-testid': 'fallback-probe',
    fallback: (
      <Box data-testid="fallback-probe-content">
        <Typography variant="caption">Image unavailable</Typography>
      </Box>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const container = await canvas.findByTestId('fallback-probe');
    const content = await canvas.findByTestId('fallback-probe-content');
    const expected = expectedFieldHeightPx();

    const containerRect = container.getBoundingClientRect();
    await expect(containerRect.height).toBeGreaterThan(0);
    expect(containerRect.width).toBeGreaterThan(0);
    expect(Math.abs(containerRect.width - expected)).toBeLessThan(PX_TOLERANCE);
    expect(Math.abs(containerRect.height - expected)).toBeLessThan(PX_TOLERANCE);

    const contentRect = content.getBoundingClientRect();
    expect(contentRect.height).toBeGreaterThan(0);

    // No longer clipped to nothing: at least SOME of the fallback's content
    // is now visible inside the container's (no-longer-collapsed) box — a
    // fixed field-height square is not a promise that every caller's content
    // fits inside it without any clipping at all (this one, at 40×40, does
    // wrap and get clipped a little narrower than its own unclipped size —
    // it is simply no longer clipped to NOTHING, which is the collapse this
    // ticket fixes).
    const visible = visibleRect(content, canvasElement);
    await expect(visible.height).toBeGreaterThan(0);
    expect(visible.height).toBeLessThanOrEqual(contentRect.height + PX_TOLERANCE);
  },
};

/**
 * The loaded real `<img>`'s own rendered box, waiting for `onLoad` to have
 * actually fired (`isLoaded` flips `state.isLoading` false, which is what
 * `showLoading`/the fade rely on) rather than a fixed timeout.
 */
async function loadedImageRect(canvasElement: HTMLElement, testId: string): Promise<DOMRect> {
  const canvas = within(canvasElement);
  const img = (await canvas.findByTestId(`${testId}-img`)) as HTMLImageElement;
  await waitFor(() => expect(img.complete && img.naturalWidth > 0).toBe(true));
  return img.getBoundingClientRect();
}

export const WidthOnlyLoadedImageSizesNaturally: Story = {
  // FUT-2805's Decision applies the new default to the PLACEHOLDER only —
  // never the loaded real image, which keeps sizing from `metrics` exactly
  // as before (FUT-2774's `emptyToUnset`): an unset height stays `auto` and
  // the image scales proportionally from its own intrinsic aspect ratio, NOT
  // forced square to match the set width (what a naive "borrow the other
  // axis" applied to the real image too would have done).
  name: '🔬 FUT-2805: width-only caller, loaded image keeps its natural aspect',
  args: {
    src: LOADS_IMMEDIATELY,
    alt: 'probe',
    lazy: false,
    fadeIn: false,
    loadingState: 'none',
    width: 200,
    'data-testid': 'width-only-probe',
  },
  play: async ({ canvasElement }) => {
    const rect = await loadedImageRect(canvasElement, 'width-only-probe');
    const expectedHeight = 200 * (NATURAL_HEIGHT / NATURAL_WIDTH);

    expect(Math.abs(rect.width - 200)).toBeLessThan(PX_TOLERANCE);
    // NOT forced to 200 (a square placeholder) — the image's own aspect ratio.
    expect(Math.abs(rect.height - expectedHeight)).toBeLessThan(PX_TOLERANCE);
    expect(Math.abs(rect.height - rect.width)).toBeGreaterThan(PX_TOLERANCE);
  },
};

export const HeightOnlyLoadedImageSizesNaturally: Story = {
  name: '🔬 FUT-2805: height-only caller, loaded image keeps its natural aspect',
  args: {
    src: LOADS_IMMEDIATELY,
    alt: 'probe',
    lazy: false,
    fadeIn: false,
    loadingState: 'none',
    height: 100,
    'data-testid': 'height-only-probe',
  },
  play: async ({ canvasElement }) => {
    const rect = await loadedImageRect(canvasElement, 'height-only-probe');
    const expectedWidth = 100 * (NATURAL_WIDTH / NATURAL_HEIGHT);

    expect(Math.abs(rect.height - 100)).toBeLessThan(PX_TOLERANCE);
    // NOT forced to 100 (a square placeholder) — the image's own aspect ratio.
    expect(Math.abs(rect.width - expectedWidth)).toBeLessThan(PX_TOLERANCE);
    expect(Math.abs(rect.width - rect.height)).toBeGreaterThan(PX_TOLERANCE);
  },
};

export const NeitherSetLoadedImageSizesIntrinsically: Story = {
  // The sharpest proof: with NEITHER axis set, the placeholder default would
  // be a `fieldHeight` square — but the loaded real image is sized from its
  // own intrinsic 120×80, not forced to that square, once it has loaded.
  name: '🔬 FUT-2805: neither set, loaded image keeps its intrinsic size (not the field-height square)',
  args: {
    src: LOADS_IMMEDIATELY,
    alt: 'probe',
    lazy: false,
    fadeIn: false,
    loadingState: 'none',
    'data-testid': 'neither-set-probe',
  },
  play: async ({ canvasElement }) => {
    const rect = await loadedImageRect(canvasElement, 'neither-set-probe');
    const fieldHeightPx = expectedFieldHeightPx();

    expect(Math.abs(rect.width - NATURAL_WIDTH)).toBeLessThan(PX_TOLERANCE);
    expect(Math.abs(rect.height - NATURAL_HEIGHT)).toBeLessThan(PX_TOLERANCE);
    // Distinct from the field-height square the PLACEHOLDER would have used.
    expect(Math.abs(rect.width - fieldHeightPx)).toBeGreaterThan(PX_TOLERANCE);
    expect(Math.abs(rect.height - fieldHeightPx)).toBeGreaterThan(PX_TOLERANCE);
  },
};

export const BothAxesSetSkeletonUnchanged: Story = {
  // "A caller that sets both axes renders exactly as today" (the Decision's
  // own geometry-neutral guarantee) — for the code path this ticket actually
  // touches, `SkeletonIndicator`'s own default: both explicit, non-square
  // values must pass straight through, not get borrowed/overridden.
  name: '🔬 FUT-2805: both axes set, skeleton geometry-neutral',
  args: {
    src: NEVER_RESOLVES,
    alt: 'probe',
    lazy: false,
    width: 200,
    height: 100,
    'data-testid': 'both-set-probe',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const skeleton = await canvas.findByTestId('both-set-probe-skeleton');
    const rect = skeleton.getBoundingClientRect();

    expect(Math.abs(rect.width - 200)).toBeLessThan(PX_TOLERANCE);
    expect(Math.abs(rect.height - 100)).toBeLessThan(PX_TOLERANCE);
  },
};
