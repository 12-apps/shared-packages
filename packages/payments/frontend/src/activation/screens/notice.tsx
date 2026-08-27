'use client';

import { Box, Stack, Typography } from '@mui/material';
import type { JSX, ReactNode } from 'react';

import { T } from '../../components/panel-tokens';

/**
 * The tinted panel every settled state is made of.
 *
 * Local to this step rather than a design-system Alert, and that is the whole
 * point of the move: the origin host rendered these through its own Alert and
 * then had to correct it twice in place — a 12px radius against the 4px cards
 * it sat under, and a hover lift on a standing panel that moved under the
 * cursor as you reached for the buttons inside it. Both corrections were
 * written as `sx` overrides in a page file, which is where a design decision
 * goes to be invisible. Here it is one shape, matching the cards it sits with,
 * for every host.
 */
type NoticeTone = 'ok' | 'warn' | 'bad' | 'info';

const TONES = {
  ok: { bg: T.okSoft, line: T.okLine, ink: T.okInk },
  warn: { bg: T.warnSoft, line: T.warnLine, ink: T.warnInk },
  bad: { bg: T.badSoft, line: T.badLine, ink: T.badInk },
  info: { bg: T.infoSoft, line: T.infoLine, ink: T.infoInk },
} as const;

export function Notice({
  tone,
  title,
  description,
  children,
  dataTestId,
}: {
  tone: NoticeTone;
  title: string;
  /** The body, when there is one — a state may be its title alone. */
  description?: string;
  /** What this outcome OFFERS, inside the panel rather than under it. */
  children?: ReactNode;
  dataTestId?: string;
}): JSX.Element {
  const tint = TONES[tone];
  return (
    <Box
      data-testid={dataTestId}
      sx={{
        background: tint.bg,
        border: `1px solid ${tint.line}`,
        borderRadius: '8px',
        p: '12px 14px',
      }}
    >
      <Typography sx={{ fontSize: '13.5px', fontWeight: 650, color: tint.ink }}>{title}</Typography>
      {description ? (
        <Typography sx={{ fontSize: '12.5px', color: T.ink2, mt: '4px', lineHeight: 1.5 }}>
          {description}
        </Typography>
      ) : null}
      {children ? <Box sx={{ mt: '12px' }}>{children}</Box> : null}
    </Box>
  );
}

/**
 * The provider's own refusal, verbatim — what support asks for on the phone.
 *
 * Selectable and monospaced on purpose: it is a string to be copied into a
 * ticket, not prose. Rendered UNDER the notice rather than inside it, because
 * it is evidence for the sentence above rather than part of it.
 */
export function ProviderMessage({ message, label }: { message: string; label: string }): JSX.Element {
  return (
    <Box
      data-testid="verify-charge-provider-message"
      sx={{
        fontFamily: T.mono,
        fontSize: '12px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        userSelect: 'text',
        p: '10px 12px',
        borderRadius: '8px',
        background: T.bg2,
        border: `1px solid ${T.line2}`,
      }}
    >
      <Typography sx={{ fontSize: '11px', color: T.ink3, mb: '4px' }}>{label}</Typography>
      {message}
    </Box>
  );
}

/** The panel that frames a whole flow — the same card the steps above use. */
export function StepPanel({
  children,
  dataTestId,
}: {
  children: ReactNode;
  dataTestId: string;
}): JSX.Element {
  return (
    <Box
      data-testid={dataTestId}
      sx={{ border: `1px solid ${T.line}`, borderRadius: '11px', p: '16px', background: T.bg }}
    >
      <Stack spacing={2}>{children}</Stack>
    </Box>
  );
}
