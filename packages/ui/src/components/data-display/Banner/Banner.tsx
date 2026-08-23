import CheckCircle from '@mui/icons-material/CheckCircle';
import Close from '@mui/icons-material/Close';
import Error from '@mui/icons-material/Error';
import Info from '@mui/icons-material/Info';
import Warning from '@mui/icons-material/Warning';
import { alpha, Box, Button, IconButton, Typography } from '@mui/material';
import type { Theme } from '@mui/material';
import { styled } from '@mui/material';
import React from 'react';

import { bannerPartStyles, fadeInSlide, getVariantColor } from './Banner.styles';
import type { BannerProps, BannerVariant } from './Banner.types';

const StyledBanner = styled(Box, {
  shouldForwardProp: (prop) => !['variant', 'sticky', 'fullWidth'].includes(prop as string),
})<{
  variant: BannerVariant;
  sticky: boolean;
  fullWidth: boolean;
}>(({ theme, variant, sticky, fullWidth }) => {

  const colorPalette = getVariantColor(theme, variant);

  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.5, 2),
    borderRadius: theme.spacing(1),
    backgroundColor: alpha(colorPalette.main, 0.1),
    border: `1px solid ${alpha(colorPalette.main, 0.2)}`,
    color: colorPalette.main,
    position: sticky ? 'sticky' : 'relative',
    top: sticky ? 0 : 'auto',
    zIndex: sticky ? theme.zIndex.appBar : 'auto',
    width: fullWidth ? '100vw' : '100%',
    marginLeft: fullWidth ? '50%' : 0,
    transform: fullWidth ? 'translateX(-50%)' : 'none',
    animation: `${fadeInSlide} 0.3s ease-out`,
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',

    // Enhanced accessibility and focus styles
    '&:focus-within': {
      outline: `3px solid ${alpha(colorPalette.main, 0.5)}`,
      outlineOffset: '2px',
    },

    ...bannerPartStyles(theme, colorPalette),

    // Responsive layout
    [theme.breakpoints.down('sm')]: {
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: theme.spacing(1),
      
      '.banner-content': {
        order: 1,
      },

      '.banner-actions': {
        order: 2,
        justifyContent: 'flex-start',
        marginTop: theme.spacing(1),
        marginLeft: 0,
      },
    },

    // Glass effect variant (optional enhancement)
    '&.banner-glass': {
      backgroundColor: alpha(theme.palette.background.paper, 0.1),
      backdropFilter: 'blur(20px)',
      border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
      color: theme.palette.text.primary,
      
      '.banner-icon': {
        color: colorPalette.main,
      },
    },
  };
});

const getVariantIcon = (variant: BannerVariant) => {
  const iconMap: Record<BannerVariant, React.ReactNode> = {
    info: <Info />,
    success: <CheckCircle />,
    warning: <Warning />,
    critical: <Error />,
  };
  return iconMap[variant];
};

type BannerAction = NonNullable<BannerProps['actions']>[number];

// Warnings and criticals interrupt the screen reader; the rest are announced
// politely when it next pauses.
const resolveAriaAnnouncement = (variant: BannerVariant) => ({
  role: variant === 'warning' || variant === 'critical' ? 'alert' : 'status',
  live: (variant === 'critical' ? 'assertive' : 'polite') as 'assertive' | 'polite',
});

const testIdFor = (base: string | undefined, suffix: string) =>
  base ? `${base}-${suffix}` : `banner-${suffix}`;

// Resolves the banner's palette once, rather than per property as the inline
// version did — getVariantColor was being called nine times to build one button.
const buildActionSx = (
  theme: Theme,
  variant: BannerVariant,
  actionVariant: BannerAction['variant'],
) => {
  const palette = getVariantColor(theme, variant);

  return {
    minWidth: 'auto',
    px: 1.5,
    py: 0.5,
    fontSize: '0.8125rem',
    fontWeight: 500,
    borderRadius: 1,

    ...(actionVariant === 'primary' && {
      backgroundColor: palette.main,
      color: theme.palette.getContrastText(palette.main),

      '&:hover': {
        backgroundColor: palette.dark || palette.main,
        transform: 'translateY(-1px)',
      },
    }),

    ...(actionVariant === 'secondary' && {
      borderColor: palette.main,
      color: palette.main,

      '&:hover': {
        backgroundColor: alpha(palette.main, 0.1),
        borderColor: palette.main,
        transform: 'translateY(-1px)',
      },
    }),
  };
};

const BannerActionButton: React.FC<{
  action: BannerAction;
  variant: BannerVariant;
  dataTestId?: string;
}> = ({ action, variant, dataTestId }) => (
  <Button
    size="small"
    variant={action.variant === 'primary' ? 'contained' : 'outlined'}
    onClick={action.onClick}
    data-testid={testIdFor(dataTestId, 'action')}
    sx={(theme) => buildActionSx(theme, variant, action.variant)}
  >
    {action.label}
  </Button>
);

const BannerBody: React.FC<{
  displayIcon: React.ReactNode;
  title?: BannerProps['title'];
  description?: BannerProps['description'];
  dataTestId?: string;
  children?: React.ReactNode;
}> = ({ displayIcon, title, description, dataTestId, children }) => (
  <>
    {displayIcon && (
      <Box className="banner-icon" aria-hidden="true" data-testid={testIdFor(dataTestId, 'icon')}>
        {displayIcon}
      </Box>
    )}

    <Box className="banner-content">
      {title && (
        <Typography
          className="banner-title"
          variant="subtitle2"
          component="div"
          data-testid={testIdFor(dataTestId, 'title')}
        >
          {title}
        </Typography>
      )}
      {description && (
        <Typography
          className="banner-description"
          variant="body2"
          component="div"
          data-testid={testIdFor(dataTestId, 'message')}
        >
          {description}
        </Typography>
      )}
      {children}
    </Box>
  </>
);

const BannerTrailing: React.FC<{
  actions?: BannerProps['actions'];
  variant: BannerVariant;
  dismissible: boolean;
  onDismissClick: () => void;
  dismissLabel: string;
  dataTestId?: string;
}> = ({ actions, variant, dismissible, onDismissClick, dismissLabel, dataTestId }) => (
  <Box display="flex" alignItems="center" gap={1}>
    {actions && actions.length > 0 && (
      <Box className="banner-actions">
        {actions.map((action, index) => (
          <BannerActionButton
            key={index}
            action={action}
            variant={variant}
            dataTestId={dataTestId}
          />
        ))}
      </Box>
    )}

    {dismissible && (
      <IconButton
        className="banner-dismiss"
        size="small"
        onClick={onDismissClick}
        aria-label={dismissLabel}
        data-testid={testIdFor(dataTestId, 'close')}
        sx={{ transition: 'all 0.2s ease' }}
      >
        <Close fontSize="small" />
      </IconButton>
    )}
  </Box>
);

export const Banner = React.forwardRef<HTMLDivElement, BannerProps>(
  (
    {
      variant = 'info',
      title,
      description,
      icon,
      dismissible = false,
      dismissLabel,
      onDismiss,
      actions,
      sticky = false,
      fullWidth = false,
      className,
      children,
      'data-testid': dataTestId = 'banner',
      ...props
    },
    ref,
  ) => {
    const [visible, setVisible] = React.useState(true);

    const handleDismiss = React.useCallback(() => {
      setVisible(false);
      onDismiss?.();
    }, [onDismiss]);

    const displayIcon = icon || getVariantIcon(variant);

    const { role: ariaRole, live: ariaLive } = resolveAriaAnnouncement(variant);

    if (!visible) {
      return null;
    }

    return (
      <StyledBanner
        ref={ref}
        variant={variant}
        sticky={sticky}
        fullWidth={fullWidth}
        className={className}
        role={ariaRole}
        aria-live={ariaLive}
        aria-atomic="true"
        tabIndex={0}
        data-testid={dataTestId}
        {...props}
      >
        <BannerBody
          displayIcon={displayIcon}
          title={title}
          description={description}
          dataTestId={dataTestId}
        >
          {children}
        </BannerBody>

        <BannerTrailing
          actions={actions}
          variant={variant}
          dismissible={dismissible}
          onDismissClick={handleDismiss}
          dismissLabel={dismissLabel}
          dataTestId={dataTestId}
        />
      </StyledBanner>
    );
  },
);

Banner.displayName = 'Banner';