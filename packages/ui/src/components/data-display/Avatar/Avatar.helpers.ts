import type { AvatarBaseProps, ContentType } from './Avatar.base';

/** Applied via a single spread so no per-field default inflates cyclomatic complexity. */
export const AVATAR_DEFAULTS = {
  variant: 'circle',
  size: 'md',
  glow: false,
  pulse: false,
  bordered: false,
  color: 'primary',
  loading: false,
  interactive: false,
  showFallbackOnError: true,
  animationDelay: 0,
} satisfies Partial<AvatarBaseProps>;

/** What wins the middle of the avatar. `broken` is the icon slot's error glyph. */
export type AvatarContentPick = ContentType | 'broken';

export interface AvatarContentArgs {
  hasChildren: boolean;
  hasFallback: boolean;
  hasIcon: boolean;
  imageError: boolean;
  showFallbackOnError: boolean;
}

/**
 * Pick what renders inside the avatar. On an image error (with fallback
 * enabled) the fallback/icon/broken-image wins; otherwise children → fallback →
 * icon → the default person glyph.
 *
 * The DECISION is shared; each renderer builds its own node from it, because
 * the two draw a glyph with different things.
 */
export function pickAvatarContent(a: AvatarContentArgs): AvatarContentPick {
  if (a.imageError && a.showFallbackOnError) {
    if (a.hasFallback) return 'fallback';
    return a.hasIcon ? 'icon' : 'broken';
  }
  if (a.hasChildren) return 'children';
  if (a.hasFallback) return 'fallback';
  return a.hasIcon ? 'icon' : 'default';
}

/** The slot id a pick takes; the broken-image glyph shares the icon slot's. */
export const contentTypeOf = (pick: AvatarContentPick): ContentType =>
  pick === 'broken' ? 'icon' : pick;

/** `${dataTestId}-loading`, or nothing at all when the caller named nothing. */
export const avatarTestId =
  (dataTestId?: string) =>
  (suffix: string): string | undefined =>
    dataTestId ? `${dataTestId}-${suffix}` : undefined;
