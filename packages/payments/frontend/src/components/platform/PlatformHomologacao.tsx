'use client';

import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';

import type { HomologacaoGuide } from '@12-apps/payments-backend';

import { CARD_SX } from './ConnectEnvironmentCard';
import { HomologacaoGuideCard } from './HomologacaoGuideCard';
import {
  HomologacaoOutcomeCard,
  type HomologacaoSaveInput,
  type HomologacaoSaveState,
  type PlatformHomologationRecordView,
} from './HomologacaoOutcomeCard';
import type { PlatformHomologacaoCopy } from './copy';
import { PlatformCopyProvider, usePlatformCopy } from './copy-context';

/**
 * The PLATFORM's PagBank homologação screen (FUT-483, packaged by FUT-573).
 *
 * The platform is the direct integrator, so the homologação is the
 * platform's, once — store owners are platform users and are exempt. The
 * screen carries the three halves: the recorded outcome (so "is the platform
 * homologated?" stops being a question for a person), the Pipefy form with
 * paste-ready answers (BOTH services — Order and Connect), and the evidence
 * generator running on the platform's own sandbox credentials.
 *
 * Dumb by design: data and mutations arrive via props from the host's own
 * mounted routes (`platformHomologacaoGuide`, `createHomologationRecordService`
 * and `buildPlatformHomologacaoAnexo` in `@12-apps/payments-backend`), so the
 * host page is a thin mount.
 *
 * English, like the rest of this platform surface (FUT-760) — see
 * `ConnectApplicationPanel` for why. The only Portuguese that reaches the
 * screen is PagBank's own form field names, carried on `guide.fieldLabels`.
 */
export interface PlatformHomologacaoProps {
  /** The recorded outcome; null renders the honest "not submitted". */
  record: PlatformHomologationRecordView | null;
  /** The paste-ready answers, computed by the host's backend. */
  guide: HomologacaoGuide;
  /** Record the outcome — the host PUTs it and refreshes `record`. */
  onSaveRecord: (input: HomologacaoSaveInput) => void;
  /** The host's save-mutation state. */
  save: HomologacaoSaveState;
  /**
   * Generate AND deliver the evidence file (the host downloads what its anexo
   * route answers). Reject with an Error whose message names the reason —
   * e.g. the missing platform sandbox token and where to fix it — and the
   * card shows it verbatim.
   */
  onGenerateAnexo: () => Promise<void>;
  /** Every word these three cards render. REQUIRED — no default copy. */
  copy: PlatformHomologacaoCopy;
}

/** The evidence-file half: real sandbox calls, downloaded as a text file. */
function AnexoCard({ onGenerate }: { onGenerate: () => Promise<void> }): ReactNode {
  const copy = usePlatformCopy().anexo;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onGenerate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.generateFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={1.5} data-testid="homologacao-anexo-card" sx={CARD_SX}>
      <Typography variant="body2" fontWeight={600}>
        {copy.heading}
      </Typography>
      <Typography variant="body2" color="text.secondary" component="p">
        {copy.body}
      </Typography>
      <Box>
        <Button
          variant="outlined"
          size="small"
          disabled={busy}
          onClick={() => void generate()}
          data-testid="homologacao-anexo-button"
        >
          {copy.generate}
        </Button>
      </Box>
      {error !== null ? (
        <Alert severity="error" data-testid="homologacao-anexo-error">
          {error}
        </Alert>
      ) : null}
    </Stack>
  );
}

export function PlatformHomologacao(props: PlatformHomologacaoProps): ReactNode {
  const { record, guide, onSaveRecord, save, onGenerateAnexo } = props;
  return (
    <PlatformCopyProvider copy={props.copy}>
      <Stack spacing={2} data-testid="platform-homologacao">
        <HomologacaoOutcomeCard record={record} onSave={onSaveRecord} save={save} />
        <HomologacaoGuideCard guide={guide} />
        <AnexoCard onGenerate={onGenerateAnexo} />
      </Stack>
    </PlatformCopyProvider>
  );
}
