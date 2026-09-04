"use client";

import * as React from 'react';
import Box from '@mui/material/Box/index.js';
import Stack from '@mui/material/Stack/index.js';
import { Button } from '../components/form/Button';
import { Card, CardContent } from '../components/layout/Card';
import { Heading } from '../components/typography/Heading';
import { Text } from '../components/typography/Text';
import { Separator } from '../components/layout/Separator';
import type { SocialLoginCopy } from '../copy/form';
import { EN_US_SOCIAL_LOGIN_COPY } from '../en-US.form';

export type SocialProvider = 'google' | 'facebook' | 'apple';

/**
 * SVG Icons for social providers
 */
const GoogleIcon = (): React.ReactElement => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

const FacebookIcon = (): React.ReactElement => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M24 12c0-6.627-5.373-12-12-12S0 5.373 0 12c0 5.99 4.388 10.954 10.125 11.854V15.47H7.078V12h3.047V9.356c0-3.007 1.792-4.668 4.533-4.668 1.312 0 2.686.234 2.686.234v2.953H15.83c-1.491 0-1.956.925-1.956 1.874V12h3.328l-.532 3.469h-2.796v8.385C19.612 22.954 24 17.99 24 12z"
      fill="#1877F2"
    />
  </svg>
);

const AppleIcon = (): React.ReactElement => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
  </svg>
);

interface ProviderConfig {
  Icon: () => React.ReactElement;
  variant: 'solid' | 'outline' | 'ghost';
  color: 'primary' | 'secondary' | 'neutral';
  sx?: object;
}

const providerConfig: Record<SocialProvider, ProviderConfig> = {
  google: {
    Icon: GoogleIcon,
    variant: 'outline',
    color: 'neutral',
    sx: {
      backgroundColor: '#ffffff',
      color: '#1f1f1f',
      borderColor: '#dadce0',
      '&:hover': {
        backgroundColor: '#f5f5f5',
        borderColor: '#dadce0',
      },
    },
  },
  facebook: {
    Icon: FacebookIcon,
    variant: 'solid',
    color: 'primary',
    sx: {
      backgroundColor: '#1877F2',
      color: '#ffffff',
      '&:hover': {
        backgroundColor: '#166fe5',
      },
    },
  },
  apple: {
    Icon: AppleIcon,
    variant: 'solid',
    color: 'neutral',
    sx: {
      backgroundColor: '#000000',
      color: '#ffffff',
      '&:hover': {
        backgroundColor: '#1a1a1a',
      },
    },
  },
};

export interface SocialLoginButtonProps {
  provider: SocialProvider;
  onClick?: () => void;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  /**
   * The three provider labels (FUT-1263). `SOCIAL_LOGIN_COPY` ships both
   * languages, so a host passes `SOCIAL_LOGIN_COPY["pt-BR"]` rather than
   * authoring a word.
   *
   * These used to be English string literals inside `providerConfig`, reachable
   * by nothing: a pt-BR storefront rendered "Continue with Google" on an
   * otherwise Portuguese sign-in screen and had no way to change it.
   *
   * OPTIONAL, unlike every other `copy` in this package, and defaulted to the
   * en-US pack. That is a deliberate exception so this ships as a MINOR: making
   * it required would break every existing caller on a routine update. The cost
   * is the one this package's convention exists to avoid — a host that says
   * nothing still renders English — so a consumer wanting Portuguese must pass
   * the pack, and FUT-1263 is not closed until it does.
   */
  copy?: SocialLoginCopy;
  /**
   * Per-provider test hook. Without one all three buttons render the same
   * `data-testid`, leaving their visible text as the only selector — which is
   * exactly the text a host is now expected to translate.
   */
  dataTestId?: string;
}

/**
 * Social login button using UI package Button component
 */
export const SocialLoginButton = React.forwardRef<HTMLButtonElement, SocialLoginButtonProps>(
  (
    {
      provider,
      onClick,
      loading = false,
      disabled = false,
      fullWidth = true,
      copy = EN_US_SOCIAL_LOGIN_COPY,
      dataTestId,
    },
    ref,
  ) => {
    const config = providerConfig[provider];

    return (
      <Button
        ref={ref}
        variant={config.variant}
        color={config.color}
        size="lg"
        loading={loading}
        disabled={disabled}
        onClick={onClick}
        icon={<config.Icon />}
        dataTestId={dataTestId}
        fullWidth={fullWidth}
        sx={{
          minHeight: 48,
          justifyContent: 'flex-start',
          gap: 2,
          ...config.sx,
        }}
      >
        {copy[provider]}
      </Button>
    );
  }
);

SocialLoginButton.displayName = 'SocialLoginButton';

/**
 * Container for social login buttons with optional divider
 */
export interface SocialLoginContainerProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  showDivider?: boolean;
  dividerText?: string;
  /**
   * How wide the card is allowed to get. Defaults to the 400 it has always
   * intended, so nothing that does not ask for a width moves.
   *
   * Worth passing for a card holding a FORM rather than a row of provider
   * buttons: 400 was chosen for the latter, and an e-mail + password pair reads
   * cramped in it.
   */
  maxWidth?: number | string;
}

export function SocialLoginContainer({
  children,
  title = "Sign in to continue",
  subtitle,
  showDivider = false,
  dividerText = "or",
  maxWidth = 400,
}: SocialLoginContainerProps): React.ReactElement {
  return (
    // `width: 100%` is what makes the cap below mean anything. Every caller
    // centres this card in a flex column (`Container variant="centered"` does),
    // and a flex item under `align-items: center` sizes to its CONTENT — so the
    // card sat at whatever the longest label happened to need, ~267px, at every
    // viewport from 390 to 1280. The 400 was never reached, which is why raising
    // it would have changed nothing; the card had no width to cap.
    <Card variant="elevated" borderRadius="lg" sx={{ width: '100%', maxWidth }}>
      <CardContent>
        <Stack spacing={3} sx={{ width: '100%' }}>
          {title && (
            <Box sx={{ textAlign: 'center' }}>
              <Heading level="h2">
                {title}
              </Heading>
              {subtitle && (
                <Text color="secondary" size="sm">
                  {subtitle}
                </Text>
              )}
            </Box>
          )}

          <Stack spacing={2}>
            {children}
          </Stack>

          {showDivider && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Separator />
              <Text color="secondary" size="sm">
                {dividerText}
              </Text>
              <Separator />
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export { GoogleIcon, FacebookIcon, AppleIcon };
