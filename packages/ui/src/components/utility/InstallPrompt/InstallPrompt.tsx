import Close from '@mui/icons-material/Close';
import InstallMobile from '@mui/icons-material/InstallMobile';
import IosShare from '@mui/icons-material/IosShare';
import { Box, Button, IconButton, Typography } from '@mui/material';
import { styled } from '@mui/material';
import React from 'react';

import { installPromptStyles } from './InstallPrompt.styles';
import type { InstallPlatform, InstallPromptProps } from './InstallPrompt.types';
import { usePwaInstall } from './usePwaInstall';

const StyledInstallPrompt = styled(Box)(({ theme }) => installPromptStyles(theme));

const testIdFor = (base: string | undefined, suffix: string) =>
  base ? `${base}-${suffix}` : `install-prompt-${suffix}`;

/**
 * The iOS branch renders instructions rather than a button, because Safari
 * exposes no API to open its own Add to Home Screen sheet. A button here would
 * be a control that does nothing when pressed.
 */
const IosInstructions: React.FC<{
  instructions?: React.ReactNode;
  dataTestId?: string;
}> = ({ instructions, dataTestId }) => (
  <Typography
    className="install-prompt-description"
    variant="body2"
    component="div"
    data-testid={testIdFor(dataTestId, 'ios-instructions')}
    sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}
  >
    {instructions ?? (
      <>
        Tap <IosShare fontSize="small" aria-label="Share" /> then &quot;Add to Home Screen&quot;
      </>
    )}
  </Typography>
);

const InstallPromptBody: React.FC<{
  icon?: React.ReactNode;
  title: string;
  description?: string;
  iosInstructions?: React.ReactNode;
  platform: InstallPlatform;
  dataTestId?: string;
}> = ({ icon, title, description, iosInstructions, platform, dataTestId }) => (
  <>
    <Box className="install-prompt-icon" aria-hidden="true">
      {icon ?? <InstallMobile />}
    </Box>

    <Box className="install-prompt-content">
      <Typography
        className="install-prompt-title"
        variant="subtitle2"
        component="div"
        data-testid={testIdFor(dataTestId, 'title')}
      >
        {title}
      </Typography>

      {description && (
        <Typography
          className="install-prompt-description"
          variant="body2"
          component="div"
          data-testid={testIdFor(dataTestId, 'description')}
        >
          {description}
        </Typography>
      )}

      {platform === 'ios' && (
        <IosInstructions instructions={iosInstructions} dataTestId={dataTestId} />
      )}
    </Box>
  </>
);

const InstallPromptActions: React.FC<{
  platform: InstallPlatform;
  installLabel: string;
  dismissLabel: string;
  onInstallClick: () => void;
  onDismissClick: () => void;
  dataTestId?: string;
}> = ({ platform, installLabel, dismissLabel, onInstallClick, onDismissClick, dataTestId }) => (
  <Box className="install-prompt-actions">
    {platform === 'prompt' && (
      <Button
        size="small"
        variant="contained"
        onClick={onInstallClick}
        data-testid={testIdFor(dataTestId, 'install')}
      >
        {installLabel}
      </Button>
    )}

    <IconButton
      size="small"
      onClick={onDismissClick}
      aria-label={dismissLabel}
      data-testid={testIdFor(dataTestId, 'dismiss')}
    >
      <Close fontSize="small" />
    </IconButton>
  </Box>
);

/**
 * A dismissible invitation to install the app, rendered only when the browser
 * is actually able to install it and the user has not recently said no.
 *
 * Returns `null` in every other case — already installed, dismissed, or a
 * browser with no install route at all — so it is safe to mount unconditionally
 * in a layout rather than gating it at the call site.
 *
 * The copy defaults to English and every string is a prop: this package stays
 * locale-neutral and the consuming app supplies its own wording.
 */
export const InstallPrompt = React.forwardRef<HTMLDivElement, InstallPromptProps>(
  (
    {
      title = 'Install this app',
      description,
      installLabel = 'Install',
      iosInstructions,
      dismissLabel = 'Dismiss install prompt',
      icon,
      onInstall,
      onDismiss,
      storageKey,
      dismissForDays,
      className,
      'data-testid': dataTestId = 'install-prompt',
      ...props
    },
    ref,
  ) => {
    const { canInstall, platform, promptInstall, dismiss } = usePwaInstall({
      storageKey,
      dismissForDays,
    });

    const handleInstall = React.useCallback(() => {
      void promptInstall().then((outcome) => onInstall?.(outcome));
    }, [promptInstall, onInstall]);

    const handleDismiss = React.useCallback(() => {
      dismiss();
      onDismiss?.();
    }, [dismiss, onDismiss]);

    if (!canInstall) {
      return null;
    }

    return (
      <StyledInstallPrompt
        ref={ref}
        className={className}
        role="region"
        aria-label={title}
        data-testid={dataTestId}
        {...props}
      >
        <InstallPromptBody
          icon={icon}
          title={title}
          description={description}
          iosInstructions={iosInstructions}
          platform={platform}
          dataTestId={dataTestId}
        />

        <InstallPromptActions
          platform={platform}
          installLabel={installLabel}
          dismissLabel={dismissLabel}
          onInstallClick={handleInstall}
          onDismissClick={handleDismiss}
          dataTestId={dataTestId}
        />
      </StyledInstallPrompt>
    );
  },
);

InstallPrompt.displayName = 'InstallPrompt';
