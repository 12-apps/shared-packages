'use client';

import { Box, Link, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import type { HomologacaoGuide } from '@12-apps/payments-backend';

import { CARD_SX } from './ConnectEnvironmentCard';
import { usePlatformCopy } from './copy-context';

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
  const copy = usePlatformCopy().guide;
  return (
    <Stack spacing={1.5} data-testid="homologacao-guide-card" sx={CARD_SX}>
      <Typography variant="body2" fontWeight={600}>
        {copy.heading}
      </Typography>
      <Typography variant="body2" color="text.secondary" component="p">
        {copy.ledeBeforeForm}
        <Link
          href={guide.formUrl}
          target="_blank"
          rel="noreferrer"
          data-testid="homologacao-form-link"
        >
          {copy.formLink}
        </Link>
        {copy.ledeBeforeSupport}
        <Link href={guide.supportFormUrl} target="_blank" rel="noreferrer">
          {copy.supportLink}
        </Link>
        {copy.ledeBeforeDocs}
        <Link href={guide.docsUrl} target="_blank" rel="noreferrer">
          {copy.docsLink}
        </Link>
        {copy.ledeAfterDocs}
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
