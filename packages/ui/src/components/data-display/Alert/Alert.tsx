import Close from '@mui/icons-material/Close';
import MuiAlert from '@mui/material/Alert/index.js';
import AlertTitle from '@mui/material/AlertTitle/index.js';
import Box from '@mui/material/Box/index.js';
import Collapse from '@mui/material/Collapse/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import { alpha, styled } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { defaultAriaLive, resolveAlertProps, testIdFor } from './Alert.helpers';
import type { AlertPalette } from './Alert.metrics';
import {
  ACTIVE,
  GLOW,
  ALERT_EASING,
  ALERT_RADIUS_UNITS,
  ALERT_TRANSITION_MS,
  CLOSE_BUTTON,
  CLOSE_DELAY_MS,
  COLLAPSE_MS,
  DESCRIPTION,
  FADE_IN,
  FOCUS,
  HOVER,
  seconds,
  TITLE,
} from './Alert.metrics';
import {
  alertEmphasisStyles,
  alertLayoutStyles,
  alertVariantStyles,
  fadeInScale,
  getColorFromTheme,
  getVariantIcon,
} from './Alert.styles';
import type { AlertColor } from '@mui/material/Alert/index.js';
import type { AlertProps } from './Alert.types';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { px } from '../../../tokens/theme';

const transition = `all ${seconds(ALERT_TRANSITION_MS)} ${ALERT_EASING}`;

// Define animations
/**
 * The pointer states' shadow: a flat tint, plus the glow when the alert has one.
 *
 * The tint is an inset spread at 100vmax, which always exceeds the element, so
 * it covers the surface edge to edge. It paints ABOVE the background and BELOW
 * the content, which is what keeps the ink's own contrast out of these states
 * entirely — see `ACTIVE` in `Alert.metrics.ts` for why a layer replaced the
 * opacity dip and the brightness multiplier that each preceded it.
 *
 * The glow is COMPOSED rather than replaced, so hovering a glowing alert keeps
 * its glow; `glowStyles` gave up its `!important` for this.
 */
function pointerShadow(
  theme: Theme,
  colorPalette: AlertPalette,
  glow: boolean,
  variant: string | undefined,
): (alpha_: number) => string {
  // The tint moves the surface AWAY from its own ink, which is why this reads
  // the variant and not only the mode.
  //
  // `gradient` is the one variant where the two disagree: it paints a
  // mid-lightness sweep (L* 42–61) under WHITE ink in BOTH modes, so the
  // mode-keyed answer tinted it white in dark mode — toward the text. Measured:
  // white-on-gradient fell to 2.90:1 on hover and 2.41:1 pressed, under the 3:1
  // floor and below its own idle. Every other variant's surface tracks the mode,
  // so for them the two rules agree.
  const ink = variant === 'gradient' || theme.palette.mode === 'light' ? '#000000' : '#ffffff';
  const glowShadow = glow
    ? `0 0 ${GLOW.blur}px ${GLOW.spread}px ${alpha(colorPalette.main, GLOW.alpha)}`
    : null;
  return (alpha_) =>
    [`inset 0 0 0 100vmax ${alpha(ink, alpha_)}`, glowShadow].filter(Boolean).join(', ');
}

const StyledAlert = styled(MuiAlert, {
  shouldForwardProp: (prop) =>
    !['customVariant', 'customColor', 'glow', 'pulse', 'animate'].includes(prop as string),
})<{
  customVariant?: string;
  customColor?: string;
  glow?: boolean;
  pulse?: boolean;
  animate?: boolean;
}>(({ theme, customVariant, customColor, glow, pulse, animate }) => {
  const colorPalette = getColorFromTheme(theme, customColor || customVariant || 'info');

  const withTint = pointerShadow(theme, colorPalette, Boolean(glow), customVariant);

  return {
    borderRadius: theme.spacing(ALERT_RADIUS_UNITS),
    transition: `${transition}, box-shadow ${seconds(ACTIVE.ms)} ${ALERT_EASING}`,
    position: 'relative',
    overflow: 'hidden',
    animation: animate ? `${fadeInScale} ${seconds(FADE_IN.ms)} ease-out` : 'none',
    willChange: 'transform, opacity',

    ...alertLayoutStyles(theme, colorPalette, animate),

    // Hover: one brightness step, and nothing that moves. An alert is a
    // surface rather than a control, so the pointer only needs telling it is
    // here. The icon keeps its own place for the same reason — it is the
    // variant's meaning, not an affordance to animate. The step darkens a
    // light theme and lightens a dark one, so it reads as arriving in both.
    '&:hover': {
      boxShadow: withTint(HOVER.tintAlpha),

      '&::before': {
        opacity: 1,
      },
    },

    // Press: a 20% opacity dip over a full second, and still no geometry.
    //
    // The second is the FADE, not the dip. A click's `:active` lasts about as
    // long as the finger is down, so a 1000ms ease INTO 0.8 would be cut off at
    // the first tenth of itself and read as a flicker. The dip lands at once
    // and the second is what the alert takes coming back — which is the part a
    // person actually watches, and the part that reads as deliberate.
    //
    // Neither `:hover` nor `:focus-visible` may declare `transition` for the
    // same reason, and that is not a style preference. `:active` under a mouse
    // ALWAYS implies `:hover`, so a bare `transition` shorthand in the hover
    // block outranks the root's (0,2,0 beats 0,1,0) and resets opacity to the
    // 300ms `all` — the second this whole state is built around never ran.
    //
    // The `:not(:has(…))` names CONTROLS, not any descendant. `:active`
    // matches an ancestor of whatever is pressed, so dismissing an alert
    // dimmed the alert being dismissed and pressing a call to action dimmed
    // the message explaining it. Excluding `:has(:active)` wholesale does not
    // work and was the first attempt: pressing the TEXT makes that text
    // `:active` too, so the guard matched on every press and the state never
    // fired at all.
    '&:active:not(:has(button:active, a:active, [role="button"]:active))': {
      boxShadow: withTint(ACTIVE.tintAlpha),
      transition: 'none',
    },

    // Focus: `:focus-visible`, not `:focus-within`.
    //
    // The alert carries `tabIndex={0}`, so a MOUSE CLICK focused it and painted
    // the ring — a keyboard affordance answering a pointer, which is what made
    // clicking one look like an error state. `:focus-visible` is the browser's
    // own answer to "did this focus come from the keyboard": the ring stays for
    // whoever tabs here and never fires on a click.
    //
    // One ring, not three. It was a 3px outline at 3px offset UNDER a 6px halo,
    // and stacking two rings on one edge is what read as unfinished rather than
    // as emphasis.
    // It declares no `transition`: `outline-style` is discrete, so the ring
    // arrives at full width with only its COLOUR easing — from `currentcolor`,
    // the near-black alert ink, to the blue. That is a visible dark flash on
    // every keyboard focus, and it would also outrank the root's opacity
    // transition the way the hover block did.
    '&:focus-visible': {
      outline: `${FOCUS.ringWidth}px solid ${alpha(colorPalette.main, FOCUS.ringAlpha)}`,
      outlineOffset: `${FOCUS.offset}px`,
    },

    ...alertVariantStyles(theme, customVariant, colorPalette),
    ...alertEmphasisStyles(colorPalette, Boolean(glow), Boolean(pulse)),
  };
});

// glass and gradient are our own looks with no MUI severity of their own; both
// borrow info's. danger is MUI's error.
const MUI_SEVERITY: Record<string, AlertColor> = {
  danger: 'error',
  glass: 'info',
  gradient: 'info',
};

const toMuiSeverity = (variant: string): AlertColor =>
  MUI_SEVERITY[variant] ?? (variant as AlertColor);

const AlertContent: React.FC<{
  title?: AlertProps['title'];
  description?: AlertProps['description'];
  dataTestId?: string;
  children?: React.ReactNode;
}> = ({ title, description, dataTestId, children }) => (
  <>
    {title && (
      <AlertTitle
        data-testid={testIdFor(dataTestId, 'title')}
        sx={{
          fontWeight: TITLE.fontWeight,
          fontSize: px(TITLE.fontSize),
          marginBottom: description ? TITLE.marginBottomUnits : 0,
          wordWrap: 'break-word',
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
        }}
      >
        {title}
      </AlertTitle>
    )}
    {description && (
      <Box
        component="div"
        data-testid={testIdFor(dataTestId, 'message')}
        sx={{
          opacity: DESCRIPTION.opacity,
          fontSize: px(DESCRIPTION.fontSize),
          wordWrap: 'break-word',
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
        }}
      >
        {description}
      </Box>
    )}
    {children}
  </>
);

const AlertCloseButton: React.FC<{ dataTestId?: string; label: string; onClose: () => void }> = ({
  dataTestId,
  label,
  onClose,
}) => (
  <IconButton
    data-testid={testIdFor(dataTestId, 'close')}
    aria-label={label}
    color="inherit"
    size="small"
    onClick={onClose}
    sx={(theme) => ({
      transition,
      opacity: CLOSE_BUTTON.opacity,
      // Opacity and a wash only: the button used to spin 90deg and grow 1.1,
      // which drew the eye to the dismiss rather than to the message.
      '&:hover': {
        opacity: 1,
        backgroundColor: alpha(theme.palette.action.hover, CLOSE_BUTTON.washAlpha),
      },
      // A REAL ring, on the keyboard-only selector.
      //
      // This used to be `&:focus` setting `outline: 'none'` over a
      // `rgba(0,0,0,0.1)` wash — 1.25:1 against the info surface, and MUI's
      // ButtonBase already sets `outline: 0`, so there was no UA fallback
      // either. It went unnoticed while the ROOT still matched `:focus-within`
      // and drew a ring around the whole alert; moving the root to
      // `:focus-visible` took that away and left this button with no visible
      // focus at all. `Banner`'s dismiss already draws its own outline, so
      // this is also what keeps the two surfaces telling a keyboard user the
      // same thing.
      '&:focus-visible': {
        opacity: 1,
        // `currentColor` is the alert's own ink, inherited through
        // `color="inherit"`, so the ring is drawn in whatever colour was
        // already chosen to be READ on this surface. Measured 11.2:1 on the
        // semantic variants and 5.7:1 on `gradient`.
        //
        // That is a reasoned choice, not a test-backed one, and the difference
        // matters: `alert-contrast.test.tsx` covers the ink of the four
        // semantic variants only — its `glass` case asserts the pane's alpha
        // rather than its ink, and `gradient` it does not render at all. A
        // translucent surface's contrast depends on what sits behind it, which
        // is why that test stops where it does and why this comment does not
        // borrow a guarantee it never made.
        outline: `${FOCUS.ringWidth}px solid currentColor`,
        outlineOffset: `${FOCUS.offset}px`,
        backgroundColor: alpha(theme.palette.action.focus, CLOSE_BUTTON.washAlpha),
      },
    })}
  >
    <Close fontSize="inherit" />
  </IconButton>
);

/**
 * The dismiss button, or nothing.
 *
 * Reads `closeLabel` straight off the props rather than through the
 * `definedProps` merge, which would widen it to `string | undefined` and hand
 * the button an empty name. The UNION in `AlertProps` guarantees the label
 * wherever `closable` is true — that narrowing is gone inside the component,
 * which is why the fallback below exists and why it is unreachable.
 */
function dismissButton(
  props: AlertProps,
  dataTestId: string | undefined,
  onClose: () => void,
): React.JSX.Element | null {
  if (!props.closable) return null;
  return <AlertCloseButton dataTestId={dataTestId} label={props.closeLabel} onClose={onClose} />;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>((alertProps, ref) => {
  const {
    variant,
    color,
    glow,
    pulse,
    icon,
    showIcon,
    onClose,
    title,
    description,
    children,
    animate,
    role,
    'aria-atomic': ariaAtomic,
    ...others
  } = resolveAlertProps(alertProps);

  // Every spelling of the test id the shared contract allows, mapped to the
  // one the DOM reads and defaulted to `alert`; the native Alert does the same.
  const dataTestId = resolveTestId(others, 'alert');
  // Then the dismiss union, which `dismissButton` reads off `alertProps` rather
  // than through this destructure — so without this strip it rides `...props`
  // onto the DOM. `ALERT_DEFAULTS` supplies `closable: false`, so that happened
  // on EVERY alert, not only the closable ones.
  const props = withoutAlertOnlyProps(withoutTestIdProps(others));

  // Depends on `variant`, so it cannot live in the static defaults above.
  const ariaLive = alertProps['aria-live'] ?? defaultAriaLive(variant);
  const [open, setOpen] = React.useState(true);
  const [isClosing, setIsClosing] = React.useState(false);

  const handleClose = () => {
    setIsClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      onClose?.();
    }, CLOSE_DELAY_MS);
  };

  const severity = toMuiSeverity(variant);

  const displayIcon = showIcon ? (
    <Box component="span" data-testid={testIdFor(dataTestId, 'icon')}>
      {icon || getVariantIcon(variant)}
    </Box>
  ) : (
    false
  );

  const content = (
    <AlertContent title={title} description={description} dataTestId={dataTestId}>
      {children}
    </AlertContent>
  );

  return (
    <Collapse in={open && !isClosing} timeout={COLLAPSE_MS}>
      <StyledAlert
        ref={ref}
        data-testid={dataTestId}
        severity={severity}
        customVariant={variant}
        customColor={color}
        glow={glow}
        pulse={pulse}
        animate={animate}
        icon={displayIcon}
        role={role}
        aria-live={ariaLive}
        aria-atomic={ariaAtomic}
        tabIndex={0}
        action={dismissButton(alertProps, dataTestId, handleClose)}
        {...props}
      >
        {content}
      </StyledAlert>
    </Collapse>
  );
});

/**
 * The props `Alert` OWNS, which must never reach the DOM.
 *
 * `AlertProps` extends MUI's, whose rest-spread is how a host's real HTML
 * attributes get onto the root — so the same spread carries the alert's own
 * configuration unless it is named here. Everything else the component consumes
 * leaves through the destructure above; these two do not, because
 * `dismissButton` reads them off the original props to keep the dismiss union's
 * narrowing intact.
 *
 * Exported so a test can render an alert carrying every name on it and assert
 * none reaches the DOM — the check that would have caught `closable`.
 */
export const ALERT_ONLY_PROPS = ['closable', 'closeLabel'] as const;

function withoutAlertOnlyProps<P extends object>(rest: P): P {
  const html = { ...rest } as Record<string, unknown>;
  for (const key of ALERT_ONLY_PROPS) delete html[key];
  return html as P;
}

Alert.displayName = 'Alert';
