import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { LazyImage } from './LazyImage';

/**
 * FUT-2774's two "unverified" sizing claims, checked in a REAL BROWSER — the
 * only tier that runs actual CSS layout rather than jsdom's literal style
 * strings. Both requests are intercepted in `.storybook/test-runner.ts`, so
 * the loading/error state each story needs is deterministic rather than a
 * race against the real network.
 *
 * BOTH claims reproduced (Chromium, 2026-09-26, via this Storybook build) —
 * see each story below for what was actually observed. They share one root
 * cause: `ImageContainer` is `display: inline-block` with an unresolved own
 * `width`/`height` whenever the caller leaves that axis unset, and in either
 * story its only content at measurement time cannot give it a size (an
 * absolutely-positioned fallback contributes nothing to shrink-to-fit; a
 * `width: 100%` skeleton inside a `width: auto` parent resolves as `auto`,
 * i.e. zero). `orDefault` (FUT-2669) only replaces an unset/empty VALUE with
 * a fallback — it cannot fix a default VALUE (`'auto'`/`'100%'`) that itself
 * has nothing to resolve against. A real fix means giving `ImageContainer` a
 * non-collapsing size on this axis when unset — a deliberate default (a fixed
 * px floor, a different `display`, …), which is a design decision beyond this
 * ticket's mechanical guards. Per the ticket's own Decision, this is recorded
 * here rather than fixed blind; both stories characterize TODAY's behaviour
 * so an accidental change to either shows up as a failure here, not silence.
 * Follow-up: FUT-2805.
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

export const UnsetWidthSkeletonInAutoWidthBox: Story = {
  // The "unverified, carried over" claim under item #5: an unset `width`
  // defaults `SkeletonIndicator` to the literal `'100%'`, inside
  // `ImageContainer` (`display: inline-block`, itself `width: auto` when
  // `width` is unset) — a percentage width inside a shrink-to-fit parent.
  //
  // CONFIRMED REPRODUCING (Chromium, 2026-09-26): the skeleton's rendered
  // width is exactly 0, not merely small — CSS resolves the child's
  // percentage as `auto` for the parent's own shrink-to-fit computation, and
  // an `auto`-width child with no content of its own is 0. NOT fixed in this
  // ticket (see the file header): flagged as a follow-up (FUT-2805) rather
  // than picking a new default size blind. Not reached by any known
  // origin-host call site today — every one sets an explicit `width`
  // (checked 2026-09-26).
  name: '🔬 FUT-2774 #5: skeleton width, LazyImage width unset',
  args: {
    src: NEVER_RESOLVES,
    alt: 'probe',
    lazy: false,
    'data-testid': 'skel-probe',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const skeleton = await canvas.findByTestId('skel-probe-skeleton');

    await expect(skeleton.getBoundingClientRect().width).toBe(0);
  },
};

export const UnsetHeightFallbackClipping: Story = {
  // #4: an unset `height` resolves to the literal `'auto'` and reached
  // `ErrorFallback`'s `sx.height` unguarded (now routed through `orDefault`,
  // matching `SkeletonIndicator` — see LazyImage.tsx). With no in-flow content
  // left once `hasError` is true (the real `<img>` and the loading indicator
  // are both gone), `ImageContainer`'s own `height: auto` has nothing to size
  // against — and its `overflow: hidden` then clips its
  // absolutely-positioned `FallbackContainer` child to that collapsed box.
  //
  // CONFIRMED REPRODUCING (Chromium, 2026-09-26): the container's own height
  // is exactly 0, the fallback content itself has a nonzero natural height,
  // and the content's VISIBLE (clipped) height is 0 — it is on the page but
  // entirely invisible. The `orDefault` fix does not change this (it only
  // normalizes an explicit `height=""` to the same `'auto'` `SkeletonIndicator`
  // already uses); the collapse itself is not fixed in this ticket, for the
  // same reason as FUT-2774 #5 above — follow-up: FUT-2805. Not reached by
  // any known origin-host call site today — `menu-card-media.tsx`'s
  // ReactNode fallback sets an explicit `height="100%"` (checked 2026-09-26).
  name: '🔬 FUT-2774 #4: ReactNode fallback, LazyImage height unset',
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

    expect(container.getBoundingClientRect().height).toBe(0);
    expect(content.getBoundingClientRect().height).toBeGreaterThan(0);

    const visible = visibleRect(content, canvasElement);
    await expect(visible.height).toBe(0);
  },
};
