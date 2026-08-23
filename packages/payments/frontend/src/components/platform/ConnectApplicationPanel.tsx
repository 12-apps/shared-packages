'use client';

import { Box, Button, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import type { ConnectApplicationReport, PaymentEnvironment } from '@12-apps/payments-backend';

import { CARD_SX, ConnectEnvironmentCard } from './ConnectEnvironmentCard';
import type { PlatformHomologacaoCopy } from './copy';
import { PlatformCopyProvider, usePlatformCopy } from './copy-context';

/**
 * The platform's PagBank Connect application, per environment (FUT-479,
 * packaged by FUT-573).
 *
 * The application every store authorizes against is registered by hand, so
 * nothing in the product could say what is registered, in which environment,
 * or with which redirect URI. This panel is the consult
 * (`GET /oauth2/application/{client_id}`) made permanent: per environment —
 * sandbox and produção are separate applications — it shows what PagBank has
 * on file, including the exact redirect_uri, and flags a mismatch against the
 * callback the deployment actually uses (a mismatch is a silent OAuth
 * failure). Read-only: creating an application stays a deliberate manual act.
 *
 * Dumb by design: the HOST fetches the report from its own mounted route
 * (`consultConnectApplications` in `@12-apps/payments-backend`) and passes it
 * here, so the host page is a thin mount — page chrome, auth and loading
 * belong to the host; the screen itself lives in this package.
 *
 * Its words are the HOST's (FUT-760), passed as one required `copy` object.
 * The reader is whoever operates the platform — and a second platform adopting
 * this package has its own operator, who reads whatever it was handed. The
 * literals this screen used to carry were English because they were written
 * for whoever was reading the code, which is a different person.
 */
export interface ConnectApplicationPanelProps {
  /** The consult report, as the backend's `consultConnectApplications` answers. */
  report: ConnectApplicationReport;
  /** Re-run the consult. Omitted, the refresh button is not rendered. */
  onRefresh?: () => void;
  /**
   * Which host-side variables feed one environment's application — the host's
   * own configuration surface, rendered as a collapsible per-environment help
   * when provided.
   */
  configVarsFor?: (environment: PaymentEnvironment) => string[];
  /** Every word this panel and its environment cards render. REQUIRED. */
  copy: PlatformHomologacaoCopy;
}

export function ConnectApplicationPanel(props: ConnectApplicationPanelProps): ReactNode {
  return (
    <PlatformCopyProvider copy={props.copy}>
      <ConnectApplicationBody {...props} />
    </PlatformCopyProvider>
  );
}

function ConnectApplicationBody(props: ConnectApplicationPanelProps): ReactNode {
  const { report, onRefresh, configVarsFor } = props;
  const copy = usePlatformCopy().connect;
  return (
    <Stack spacing={2} data-testid="connect-application-panel">
      <Stack spacing={0.5} data-testid="connect-expected-redirect" sx={CARD_SX}>
        <Typography variant="caption" color="text.secondary" fontWeight={600}>
          {copy.expectedRedirectHeading}
        </Typography>
        <Box
          component="code"
          sx={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}
        >
          {report.expectedRedirectUri}
        </Box>
      </Stack>
      {report.environments.map((status) => (
        <ConnectEnvironmentCard
          key={status.environment}
          status={status}
          configVars={configVarsFor?.(status.environment)}
        />
      ))}
      {onRefresh ? (
        <Box>
          <Button
            variant="outlined"
            size="small"
            onClick={() => onRefresh()}
            data-testid="connect-refresh"
          >
            {copy.consultAgain}
          </Button>
        </Box>
      ) : null}
    </Stack>
  );
}
