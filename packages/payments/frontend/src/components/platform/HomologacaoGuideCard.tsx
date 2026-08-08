'use client';

import { Box, Link, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import type { HomologacaoGuide } from '@12-apps/payments-backend';

import { CARD_SX } from './ConnectEnvironmentCard';

/**
 * The paste-ready homologação answers (FUT-483, packaged by FUT-573) — the
 * Pipefy form with every deployment-specific value already computed, and the
 * services list naming BOTH Order and Connect.
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
        Formulário de homologação — respostas prontas
      </Typography>
      <Typography variant="body2" color="text.secondary" component="p">
        Abra o{' '}
        <Link
          href={guide.formUrl}
          target="_blank"
          rel="noreferrer"
          data-testid="homologacao-form-link"
        >
          formulário oficial de homologação
        </Link>{' '}
        e preencha com os valores abaixo. Em paralelo, abra um chamado no{' '}
        <Link href={guide.supportFormUrl} target="_blank" rel="noreferrer">
          SIP — Suporte Integração PagBank
        </Link>{' '}
        citando o 403 ACCESS_DENIED — o que responder primeiro resolve a dúvida de o
        formulário cobrir ou não o Connect. Documentação:{' '}
        <Link href={guide.docsUrl} target="_blank" rel="noreferrer">
          solicitar homologação
        </Link>
        .
      </Typography>
      <Answer label="Selecione o tipo de integração">{guide.integrationType}</Answer>
      <Box data-testid="homologacao-services">
        <Answer label="Selecione qual serviço você integrou (marque OS DOIS)">
          {guide.services.join('\n')}
        </Answer>
      </Box>
      <Answer label="Instruções de acesso ao seu ambiente (limite de 255 caracteres)">
        {guide.accessInstructions}
      </Answer>
      <Answer label="URL do site">{guide.siteUrl}</Answer>
      <Answer label="Detalhe quais produtos/serviços serão comercializados">
        {guide.productsDescription}
      </Answer>
      <Typography variant="caption" color="text.secondary" component="p">
        {guide.slaText}
      </Typography>
    </Stack>
  );
}
