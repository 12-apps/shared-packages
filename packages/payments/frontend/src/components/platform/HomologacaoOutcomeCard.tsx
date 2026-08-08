'use client';

import { Alert, Box, Button, Chip, Stack, TextField, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';

import type { PlatformHomologationStatus } from '@12-apps/payments-backend';

import { CARD_SX } from './ConnectEnvironmentCard';

/**
 * The homologação outcome record (FUT-483, packaged by FUT-573) — the durable
 * answer to "is the platform homologated?". Absence of the record is the
 * honest fourth state ("não solicitada"), which is why it is displayed but
 * never offered as a choice.
 */

/**
 * One provider's recorded outcome as the wire carries it — the backend's
 * `PlatformHomologationRecord` after JSON serialization (dates as ISO
 * strings).
 */
export interface PlatformHomologationRecordView {
  provider: string;
  status: PlatformHomologationStatus;
  protocol: string | null;
  notes: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

/** What the outcome form submits — the whole record, replaced deliberately. */
export interface HomologacaoSaveInput {
  status: PlatformHomologationStatus;
  protocol: string;
  notes: string;
}

/** The host's save-mutation state, whatever machinery produces it. */
export interface HomologacaoSaveState {
  pending: boolean;
  error: string | null;
  success: boolean;
}

const STATUS_LABEL: Record<PlatformHomologationStatus, string> = {
  SUBMITTED: 'Solicitada',
  APPROVED: 'Aprovada',
  REJECTED: 'Recusada',
};

const STATUS_COLOR: Record<PlatformHomologationStatus, 'warning' | 'success' | 'error'> = {
  SUBMITTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
};

function StatusChip({ record }: { record: PlatformHomologationRecordView | null }): ReactNode {
  if (record === null) {
    return (
      <Chip
        label="Não solicitada"
        size="small"
        variant="outlined"
        data-testid="homologacao-status-chip"
      />
    );
  }
  return (
    <Chip
      label={STATUS_LABEL[record.status]}
      size="small"
      color={STATUS_COLOR[record.status]}
      data-testid="homologacao-status-chip"
    />
  );
}

const formatDateTime = (iso: string): string => new Date(iso).toLocaleString('pt-BR');

function RecordTrail({ record }: { record: PlatformHomologationRecordView }): ReactNode {
  return (
    <Typography variant="caption" color="text.secondary" component="p">
      {record.submittedAt ? `Solicitada em ${formatDateTime(record.submittedAt)}. ` : ''}
      {record.decidedAt ? `Decidida em ${formatDateTime(record.decidedAt)}. ` : ''}
      {record.updatedBy ? `Registrado por ${record.updatedBy}.` : ''}
    </Typography>
  );
}

interface HomologacaoOutcomeCardProps {
  record: PlatformHomologationRecordView | null;
  /** Record the outcome — the host PUTs it and refreshes `record`. */
  onSave: (input: HomologacaoSaveInput) => void;
  save: HomologacaoSaveState;
}

export function HomologacaoOutcomeCard(props: HomologacaoOutcomeCardProps): ReactNode {
  const { record, onSave, save } = props;
  const [status, setStatus] = useState<PlatformHomologationStatus>(record?.status ?? 'SUBMITTED');
  const [protocol, setProtocol] = useState(record?.protocol ?? '');
  const [notes, setNotes] = useState(record?.notes ?? '');

  return (
    <Stack spacing={1.5} data-testid="homologacao-outcome-card" sx={CARD_SX}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Typography variant="body2" fontWeight={600}>
          Situação da homologação
        </Typography>
        <StatusChip record={record} />
      </Box>
      {record ? <RecordTrail record={record} /> : null}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'flex-start' }}>
        <TextField
          select
          size="small"
          label="Situação"
          value={status}
          onChange={(event) => setStatus(event.target.value as PlatformHomologationStatus)}
          slotProps={{
            select: { native: true },
            htmlInput: { 'data-testid': 'homologacao-status-select' },
          }}
        >
          {(Object.keys(STATUS_LABEL) as PlatformHomologationStatus[]).map((key) => (
            <option key={key} value={key}>
              {STATUS_LABEL[key]}
            </option>
          ))}
        </TextField>
        <TextField
          size="small"
          aria-label="Protocolo"
          placeholder="Protocolo (cartão do Pipefy / chamado)"
          value={protocol}
          onChange={(event) => setProtocol(event.target.value)}
          slotProps={{ htmlInput: { 'data-testid': 'homologacao-protocol' } }}
        />
        <TextField
          size="small"
          aria-label="Observações"
          placeholder="Observações (resposta do PagBank, contexto…)"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          slotProps={{ htmlInput: { 'data-testid': 'homologacao-notes' } }}
        />
        <Button
          variant="contained"
          size="small"
          disabled={save.pending}
          onClick={() => onSave({ status, protocol, notes })}
          data-testid="homologacao-save"
        >
          Registrar
        </Button>
      </Box>
      {save.error !== null ? (
        <Alert severity="error" data-testid="homologacao-save-error">
          {save.error}
        </Alert>
      ) : null}
      {save.success ? (
        <Alert severity="success" data-testid="homologacao-save-ok">
          Registro atualizado.
        </Alert>
      ) : null}
    </Stack>
  );
}
