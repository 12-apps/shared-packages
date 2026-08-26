import Close from '@mui/icons-material/Close';
import InstallMobile from '@mui/icons-material/InstallMobile';
import IosShare from '@mui/icons-material/IosShare';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import React from 'react';

import { installPromptStyles } from './InstallPrompt.styles';
import type { InstallPlatform, InstallPromptProps } from './InstallPrompt.types';
import { usePwaInstall } from './usePwaInstall';
import type { InstallPromptCopy } from '../../../copy';

const StyledInstallPrompt = styled(Box)(({ theme }) => installPromptStyles(theme));

const testIdFor = (base: string | undefined, suffix: string) =>
  base ? `${base}-${suffix}` : `install-prompt-${suffix}`;

/**
 * The iOS branch renders instructions rather than a button, because Safari
 * exposes no API to open its own Add to Home Screen sheet. A button here would
 * be a control that does nothing when pressed.
 */
const IosInstructions: React.FC<{
  copy: InstallPromptCopy;
  instructions?: React.ReactNode;
  dataTestId?: string;
}> = ({ copy, instructions, dataTestId }) => (
  <Typography
    className="install-prompt-description"
    variant="body2"
    component="div"
    data-testid={testIdFor(dataTestId, 'ios-instructions')}
    sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}
  >
    {instructions ?? (
      <>
        {copy.iosTapBefore} <IosShare fontSize="small" aria-label={copy.shareLabel} />{' '}
        {copy.iosTapAfter}
      </>
    )}
  </Typography>
);

const InstallPromptBody: React.FC<{
  copy: InstallPromptCopy;
  icon?: React.ReactNode;
  title: string;
  description?: string;
  iosInstructions?: React.ReactNode;
  platform: InstallPlatform;
  dataTestId?: string;
}> = ({ copy, icon, title, description, iosInstructions, platform, dataTestId }) => (
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
        <IosInstructions copy={copy} instructions={iosInstructions} dataTestId={dataTestId} />
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
 * Every string is REQUIRED host config (`copy`): this package stays
 * locale-neutral and the consuming app supplies its own wording. There is no
 * English default to fall through to, so a missing word is a typecheck failure
 * rather than an English sentence in a pt-BR store.
 */
export const InstallPrompt = React.forwardRef<HTMLDivElement, InstallPromptProps>(
  (
    {
      copy,
      description,
      iosInstructions,
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
        aria-label={copy.title}
        data-testid={dataTestId}
        {...props}
      >
        <InstallPromptBody
          icon={icon}
          copy={copy}
          title={copy.title}
          description={description}
          iosInstructions={iosInstructions}
          platform={platform}
          dataTestId={dataTestId}
        />

        <InstallPromptActions
          platform={platform}
          installLabel={copy.installLabel}
          dismissLabel={copy.dismissLabel}
          onInstallClick={handleInstall}
          onDismissClick={handleDismiss}
          dataTestId={dataTestId}
        />
      </StyledInstallPrompt>
    );
  },
);

InstallPrompt.displayName = 'InstallPrompt';
