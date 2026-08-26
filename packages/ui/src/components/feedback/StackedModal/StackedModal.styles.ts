import { alpha } from '@mui/material/styles';
import type { CSSObject, Theme } from '@mui/material/styles';
import { dynamicViewportHeight } from '../../../utils/viewport';
import type { ModalPanelRole, PanelMaxWidth } from './StackedModal.types';

/** Props that drive the panel's look but must not reach the DOM. */
export interface PanelStyleProps {
  modalRole?: ModalPanelRole;
  isAnimating?: boolean;
  glass?: boolean;
  rtl?: boolean;
  customMaxWidth?: PanelMaxWidth;
}

/** Style-only props, filtered out before they can land on a DOM node. */
export const STYLE_ONLY_PROPS = ['modalRole', 'isAnimating', 'glass', 'rtl', 'customMaxWidth'];

/** MUI breakpoint names mapped to the pixel width they cap the panel at. */
const MAX_WIDTH_PX: Record<Exclude<PanelMaxWidth, false>, number> = {
  xs: 444,
  sm: 600,
  md: 960,
  lg: 1280,
  xl: 1920,
};

const BACKDROP_BY_ROLE: Partial<Record<ModalPanelRole, string>> = {
  secondary: 'rgba(0, 0, 0, 0.3)',
  background: 'rgba(0, 0, 0, 0.1)',
};

const ANIMATION_BY_ROLE: Partial<Record<ModalPanelRole, string>> = {
  secondary: 'expandModal 300ms ease-in-out forwards',
  primary: 'contractModal 300ms ease-in-out forwards',
};

// Animation endpoints use the common lg width (60vw); the role styles set the
// exact per-breakpoint width once the animation settles.
const KEYFRAMES: CSSObject = {
  '@keyframes expandModal': {
    from: { width: '60vw', transform: 'translateX(0)' },
    to: { width: '100vw', transform: 'translateX(0)' },
  },
  '@keyframes contractModal': {
    from: { width: '100vw', transform: 'translateX(0)' },
    to: { width: '60vw', transform: 'translateX(0)' },
  },
};

const cap = (customMaxWidth?: PanelMaxWidth): number | null =>
  customMaxWidth ? MAX_WIDTH_PX[customMaxWidth] : null;

/** One breakpoint's width: the viewport share, held under the optional px cap. */
const panelWidth = (share: string, capPx: number | null): CSSObject =>
  capPx
    ? { width: `min(${share}, ${capPx}px)`, maxWidth: `${capPx}px` }
    : { width: share, maxWidth: share };

const backdropStyles = (modalRole?: ModalPanelRole): CSSObject => ({
  backgroundColor: (modalRole && BACKDROP_BY_ROLE[modalRole]) ?? 'rgba(0, 0, 0, 0.5)',
  backdropFilter: modalRole === 'primary' ? 'blur(4px)' : 'none',
});

/**
 * The top panel is viewport-aware and narrows as the screen grows: full width on
 * mobile, 80vw on tablet/small desktop, 60vw on regular desktops (lg up —
 * including ~1080p/1440p/1080-wide), and 40vw only on ultra-wide screens
 * (≥2200px) so the receding panel stays visible on huge monitors. A `maxWidth`
 * prop, when given, caps it further.
 */
const primaryPanelStyles = (theme: Theme, capPx: number | null): CSSObject => ({
  [theme.breakpoints.down('sm')]: panelWidth('100%', capPx),
  [theme.breakpoints.between('sm', 'lg')]: panelWidth('80vw', capPx),
  [theme.breakpoints.up('lg')]: panelWidth('60vw', capPx),
  '@media (min-width:2200px)': panelWidth('40vw', capPx),
});

/** Panels below the top one expand to full width, producing the GTM stacking effect. */
const secondaryPanelStyles = (): CSSObject => ({
  width: '100vw !important',
  maxWidth: '100vw !important',
  right: '0 !important',
  top: '0 !important',
  ...dynamicViewportHeight('height', 'maxHeight'),
  borderRadius: '0 !important',
  opacity: 0.95,
  transform: 'scale(1)',
});

const rolePanelStyles = (theme: Theme, role: ModalPanelRole | undefined, capPx: number | null): CSSObject => {
  if (role === 'primary') return primaryPanelStyles(theme, capPx);
  if (role === 'secondary') return secondaryPanelStyles();
  // Background modals stay mounted but hidden, for performance.
  if (role === 'background') return { display: 'none' };
  return {};
};

const glassStyles = (theme: Theme, glass?: boolean, role?: ModalPanelRole): CSSObject =>
  glass && role === 'primary'
    ? {
        backgroundColor: alpha(theme.palette.background.paper, 0.85),
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
      }
    : {};

const animationStyles = (isAnimating?: boolean, role?: ModalPanelRole): CSSObject =>
  isAnimating ? { animation: (role && ANIMATION_BY_ROLE[role]) ?? 'none' } : {};

const panelBaseStyles = (theme: Theme): CSSObject => ({
  margin: 0,
  position: 'fixed',
  right: 0,
  top: 0,
  // Pinned to the DYNAMIC viewport: on iOS a `100vh` panel runs underneath the
  // browser toolbar, which parks the tail of the scroll area (the submit row)
  // out of reach. See `dynamicViewportHeight`.
  ...dynamicViewportHeight('height', 'maxHeight'),
  borderRadius: 0,
  willChange: 'transform, width, border-radius',
  transition: theme.transitions.create(
    ['width', 'max-width', 'border-radius', 'transform', 'opacity'],
    { duration: 300, easing: theme.transitions.easing.easeInOut },
  ),
});

const panelStyles = (theme: Theme, props: PanelStyleProps): CSSObject => {
  const capPx = cap(props.customMaxWidth);
  return {
    ...panelBaseStyles(theme),
    ...rolePanelStyles(theme, props.modalRole, capPx),
    ...glassStyles(theme, props.glass, props.modalRole),
    ...animationStyles(props.isAnimating, props.modalRole),
  };
};

/** The full rule set for the sliding panel's Dialog root. */
export const dialogRootStyles = (theme: Theme, props: PanelStyleProps): CSSObject => ({
  direction: props.rtl ? 'rtl' : 'ltr',
  '& .MuiBackdrop-root': backdropStyles(props.modalRole),
  '& .MuiDialog-container': { alignItems: 'flex-start', justifyContent: 'flex-end' },
  '& .MuiDialog-paper': panelStyles(theme, props),
  ...KEYFRAMES,
});

export const titleStyles = (theme: Theme, rtl?: boolean): CSSObject => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: theme.spacing(2, 2.5),
  borderBottom: `1px solid ${theme.palette.divider}`,
  direction: rtl ? 'rtl' : 'ltr',
});

export const titleLeftStyles = (theme: Theme): CSSObject => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1.5),
  flex: 1,
});

export const titleRightStyles = (theme: Theme): CSSObject => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
});

export const loadingOverlayStyles = (theme: Theme): CSSObject => ({
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: alpha(theme.palette.background.paper, 0.8),
  zIndex: 9999,
});

export const modalContentStyles = (theme: Theme): CSSObject => ({
  padding: theme.spacing(3),
  // MUI's DialogContent defaults to `overflow-y: auto`, but inside a panel it is
  // NOT the element that scrolls — ModalBody above it is, and this box always
  // ends up exactly as tall as its own content. A scroll container that never
  // scrolls is still the containing block for every `position: sticky`
  // descendant, so a sticky header anchored here gets zero travel and rides the
  // content out of view: sticky, and pinned to nothing. Handing the overflow
  // back to ModalBody makes the panel's own scroller the anchor.
  overflowY: 'visible',
});
