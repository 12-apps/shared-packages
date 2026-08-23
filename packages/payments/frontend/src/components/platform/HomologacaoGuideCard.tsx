'use client';

import { Box, Link, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import type { HomologacaoGuide } from '@12-apps/payments-backend';

import { CARD_SX } from './ConnectEnvironmentCard';

/**
 * The paste-ready homologação answers (FUT-483, packaged by FUT-573) — the
 * Pipefy form with every deployment-specific value already computed, and the
 * services list naming BOTH Order and Connect.
 *
 * ## Why this screen is English and its field labels are not (FUT-760)
 *
 * The reader is the PLATFORM's own integrator — the person registering a
 * Connect application and chasing a `403 ACCESS_DENIED` — so the prose here
 * follows the same rule as every other developer-facing sentence in this
 * repo. The field names beside each value are quotes of PagBank's Pipefy
 * form, and they arrive on `guide.fieldLabels` rather than being written
 * here: this card is USED by matching each block to the box it goes in, and a
 * translated box name has nothing to match.
 */

/** One paste-ready value, in a copyable code block. */
function Answer({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <Stack spacing={0.25}>
      <Typography variant="caption" color="text.secondary" fontWeight={600}>
        {label}
      </Typography>
      <Box
        component="code"
        sx={{
          fontFamily: 'monospace',
          fontSize: 12,
          p: 1,
          borderRadius: 1,
          bgcolor: 'action.hover',
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {children}
      </Box>
    </Stack>
  );
}

export function HomologacaoGuideCard({ guide }: { guide: HomologacaoGuide }): ReactNode {
  return (
    <Stack spacing={1.5} data-testid="homologacao-guide-card" sx={CARD_SX}>
      <Typography variant="body2" fontWeight={600}>
        Homologation form — answers ready to paste
      </Typography>
      <Typography variant="body2" color="text.secondary" component="p">
        Open the{' '}
        <Link
          href={guide.formUrl}
          target="_blank"
          rel="noreferrer"
          data-testid="homologacao-form-link"
        >
          official homologation form
        </Link>{' '}
        and fill it in with the values below. In parallel, open a ticket with{' '}
        <Link href={guide.supportFormUrl} target="_blank" rel="noreferrer">
          SIP — PagBank integration support
        </Link>{' '}
        quoting the 403 ACCESS_DENIED: whichever answers first settles whether the form
        covers Connect. Documentation:{' '}
        <Link href={guide.docsUrl} target="_blank" rel="noreferrer">
          requesting homologation
        </Link>
        .
      </Typography>
      <Answer label={guide.fieldLabels.integrationType}>{guide.integrationType}</Answer>
      <Box data-testid="homologacao-services">
        <Answer label={guide.fieldLabels.services}>{guide.services.join('\n')}</Answer>
      </Box>
      <Answer label={guide.fieldLabels.accessInstructions}>{guide.accessInstructions}</Answer>
      <Answer label={guide.fieldLabels.siteUrl}>{guide.siteUrl}</Answer>
      <Answer label={guide.fieldLabels.productsDescription}>{guide.productsDescription}</Answer>
      <Typography variant="caption" color="text.secondary" component="p">
        {guide.slaText}
      </Typography>
    </Stack>
  );
}
