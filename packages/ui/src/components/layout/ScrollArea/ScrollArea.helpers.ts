import type { ScrollAreaProps } from './ScrollArea.types';

type ScrollAreaDefaultedKeys =
  | 'width'
  | 'height'
  | 'orientation'
  | 'scrollbarSize'
  | 'autoHide'
  | 'autoHideDelay'
  | 'smoothScroll'
  | 'variant'
  | 'scrollToTopButton'
  | 'scrollToTopThreshold'
  | 'contentPadding'
  | 'alwaysShowScrollbar'
  | 'disabled'
  | 'loading'
  | 'testId';

export type ResolvedScrollAreaProps = ScrollAreaProps &
  Required<Pick<ScrollAreaProps, ScrollAreaDefaultedKeys>>;

const SCROLL_AREA_DEFAULTS: Pick<ScrollAreaProps, ScrollAreaDefaultedKeys> = {
  width: '100%',
  height: '100%',
  orientation: 'vertical',
  scrollbarSize: 'medium',
  autoHide: true,
  autoHideDelay: 1000,
  smoothScroll: true,
  variant: 'default',
  scrollToTopButton: false,
  scrollToTopThreshold: 100,
  contentPadding: 0,
  alwaysShowScrollbar: false,
  disabled: false,
  loading: false,
  testId: 'scroll-area',
};

// Strips explicitly-undefined props before the merge, so `prop={undefined}` still
// falls back to the default exactly as a destructuring default would. Applied as
// a merge rather than destructuring defaults, which would otherwise put fifteen
// branches into the component's own complexity budget.
export const resolveScrollAreaProps = (props: ScrollAreaProps): ResolvedScrollAreaProps =>
  ({
    ...SCROLL_AREA_DEFAULTS,
    ...(Object.fromEntries(
      Object.entries(props).filter(([, value]) => value !== undefined),
    ) as Partial<ScrollAreaProps>),
  }) as ResolvedScrollAreaProps;
