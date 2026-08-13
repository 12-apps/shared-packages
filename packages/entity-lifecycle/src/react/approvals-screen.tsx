import { useCallback, useEffect, useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Chip } from '@12-apps/ui/data-display/Chip';
import { EmptyState } from '@12-apps/ui/data-display/EmptyState';
import { ErrorState } from '@12-apps/ui/data-display/ErrorState';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { Dialog, DialogContent } from '@12-apps/ui/feedback/Dialog';
import { Button } from '@12-apps/ui/form/Button';
import { Textarea } from '@12-apps/ui/form/Textarea';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { ApprovalRequestWire, ApprovalStatusWire, LifecycleApiClient } from './api';
import { DATE_TIME, entityTypeLabel, type EntityTypeLabels } from './labels';
import { LifecycleHttpError, type LifecycleResult } from './transport';

/**
 * Aprovações (12-17) — the parked-change-request inbox of the
 * entity-lifecycle machinery, ported from future-pay's `pages/approvals`
 * with its test ids and pt-BR copy intact: filter chips (Pendentes /
 * Aprovadas / Rejeitadas); a PENDING row offers "Aprovar" and "Rejeitar"
 * (the reject dialog takes an optional note). A 403 (feature off for the
 * tenant) renders a friendly notice.
 */

/** The status filter chips, in display order. */
const STATUS_FILTERS: { value: ApprovalStatusWire; label: string }[] = [
  { value: 'PENDING', label: 'Pendentes' },
  { value: 'APPROVED', label: 'Aprovadas' },
  { value: 'REJECTED', label: 'Rejeitadas' },
];

/** pt-BR labels for the request actions. */
const ACTION_LABELS: Record<ApprovalRequestWire['action'], string> = {
  CREATE: 'Criação',
  UPDATE: 'Alteração',
  DELETE: 'Exclusão',
};

/** Per-status empty-state copy. */
const EMPTY_LABELS: Record<ApprovalStatusWire, string> = {
  PENDING: 'Nenhuma solicitação pendente.',
  APPROVED: 'Nenhuma solicitação aprovada.',
  REJECTED: 'Nenhuma solicitação rejeitada.',
};

interface DecisionActions {
  busyId: string | null;
  error: string | null;
  clearError: () => void;
  rejecting: ApprovalRequestWire | null;
  setRejecting: (request: ApprovalRequestWire | null) => void;
  approve: (request: ApprovalRequestWire) => Promise<void>;
  reject: (note: string) => Promise<void>;
}

/** Decision dispatch state: approve, and the note-gated reject dialog. */
function useDecisionActions(api: LifecycleApiClient, refetch: () => void): DecisionActions {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ApprovalRequestWire | null>(null);

  async function run(
    requestId: string,
    dispatch: () => Promise<LifecycleResult<unknown>>,
  ): Promise<void> {
    setBusyId(requestId);
    setError(null);
    try {
      const result = await dispatch();
      if (result.ok) refetch();
      else setError(result.error);
    } finally {
      setBusyId(null);
    }
  }

  return {
    busyId,
    error,
    clearError: () => setError(null),
    rejecting,
    setRejecting,
    approve: (request) => run(request.id, () => api.approveRequest(request.id)),
    reject: async (note) => {
      if (!rejecting) return;
      const target = rejecting;
      setRejecting(null);
      await run(target.id, () => api.rejectRequest(target.id, note || undefined));
    },
  };
}

/** The reject dialog: optional decision note + confirm. */
function RejectDialog({
  request,
  onClose,
  onConfirm,
}: {
  request: ApprovalRequestWire | null;
  onClose: () => void;
  onConfirm: (note: string) => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  return (
    <Dialog
      open={request !== null}
      onClose={onClose}
      title={request ? `Rejeitar "${request.label}"` : 'Rejeitar solicitação'}
      size="sm"
      showCloseButton
      dataTestId="approval-reject-dialog"
    >
      <DialogContent>
        <Stack spacing={2}>
          <Textarea
            label="Motivo (opcional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            dataTestId="approval-reject-note"
          />
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button variant="text" onClick={onClose} dataTestId="approval-reject-cancel">
              Cancelar
            </Button>
            <Button
              color="danger"
              onClick={() => {
                onConfirm(note);
                setNote('');
              }}
              dataTestId="approval-reject-confirm"
            >
              Rejeitar
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

/** One request card: label, action chip, requester + stamps, decide buttons. */
function RequestCard({
  request,
  labels,
  busy,
  onApprove,
  onReject,
}: {
  request: ApprovalRequestWire;
  labels: EntityTypeLabels;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}): JSX.Element {
  return (
    <Box
      data-testid={`approval-request-${request.id}`}
      sx={{ p: 2, borderRadius: 1, border: (theme) => `1px solid ${theme.palette.divider}` }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
        <Text variant="heading" size="sm" as="h3">
          {request.label}
        </Text>
        <Chip label={ACTION_LABELS[request.action]} size="sm" variant="outlined" />
        <Chip
          label={entityTypeLabel(labels, request.entityType)}
          size="sm"
          variant="outlined"
        />
        <Box sx={{ flex: 1 }} />
        {request.status === 'PENDING' && (
          <>
            <Button
              size="sm"
              loading={busy}
              onClick={onApprove}
              dataTestId={`approval-approve-${request.id}`}
            >
              Aprovar
            </Button>
            <Button
              variant="outline"
              color="danger"
              size="sm"
              disabled={busy}
              onClick={onReject}
              dataTestId={`approval-reject-${request.id}`}
            >
              Rejeitar
            </Button>
          </>
        )}
      </Stack>
      <Text variant="caption" as="p" color="secondary">
        Solicitado por {request.requestedByName ?? 'Sistema'} em{' '}
        {DATE_TIME.format(new Date(request.requestedAt))}
      </Text>
      {request.decidedAt && (
        <Text variant="caption" as="p" color="secondary">
          Decidido em {DATE_TIME.format(new Date(request.decidedAt))}
          {request.decisionNote ? ` — ${request.decisionNote}` : ''}
        </Text>
      )}
    </Box>
  );
}

/** The filtered request list + decision dialogs and feedback. */
function ApprovalsBody({
  api,
  labels,
  status,
  requests,
  refetch,
}: {
  api: LifecycleApiClient;
  labels: EntityTypeLabels;
  status: ApprovalStatusWire;
  requests: ApprovalRequestWire[];
  refetch: () => void;
}): JSX.Element {
  const actions = useDecisionActions(api, refetch);

  return (
    <Stack spacing={1.5} data-testid="approvals-list">
      {actions.error && (
        <Alert
          variant="danger"
          title="Não foi possível concluir a decisão"
          description={actions.error}
          closable
          onClose={actions.clearError}
          data-testid="approvals-error"
        />
      )}
      {requests.length === 0 ? (
        <EmptyState title={EMPTY_LABELS[status]} dataTestId="approvals-empty" />
      ) : (
        requests.map((request) => (
          <RequestCard
            key={request.id}
            request={request}
            labels={labels}
            busy={actions.busyId === request.id}
            onApprove={() => void actions.approve(request)}
            onReject={() => actions.setRejecting(request)}
          />
        ))
      )}
      <RejectDialog
        request={actions.rejecting}
        onClose={() => actions.setRejecting(null)}
        onConfirm={(note) => void actions.reject(note)}
      />
    </Stack>
  );
}

interface ApprovalsLoad {
  requests: ApprovalRequestWire[] | null;
  loadError: { status: number | null; message: string } | null;
  refetch: () => void;
}

/** The status-scoped inbox read, refetchable after a decision. */
function useApprovalsLoad(api: LifecycleApiClient, status: ApprovalStatusWire): ApprovalsLoad {
  const [requests, setRequests] = useState<ApprovalRequestWire[] | null>(null);
  const [loadError, setLoadError] = useState<ApprovalsLoad['loadError']>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRequests(null);
    api
      .listApprovals(status)
      .then((payload) => {
        if (!cancelled) {
          setRequests(payload.requests);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError({
          status: error instanceof LifecycleHttpError ? error.status : null,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [api, status, generation]);

  return {
    requests,
    loadError,
    refetch: useCallback(() => setGeneration((value) => value + 1), []),
  };
}

export function ApprovalsScreen({
  api,
  labels,
}: {
  api: LifecycleApiClient;
  labels: EntityTypeLabels;
}): JSX.Element {
  const [status, setStatus] = useState<ApprovalStatusWire>('PENDING');
  const { requests, loadError, refetch } = useApprovalsLoad(api, status);

  // Feature off for the tenant — a friendly notice instead of an error state.
  const featureOff = loadError !== null && loadError.status === 403;

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} data-testid="approvals-status-filter">
        {STATUS_FILTERS.map((filter) => (
          <Chip
            key={filter.value}
            label={filter.label}
            selectable
            selected={status === filter.value}
            onClick={() => setStatus(filter.value)}
            dataTestId={`approvals-filter-${filter.value}`}
          />
        ))}
      </Stack>
      {requests === null && loadError === null && <LoadingState dataTestId="approvals-loading" />}
      {featureOff && (
        <Alert
          variant="info"
          description="O recurso de aprovações não está ativo para esta loja."
          data-testid="approvals-feature-off"
        />
      )}
      {loadError !== null && !featureOff && (
        <ErrorState
          title="Não foi possível carregar as aprovações"
          message={loadError.message}
          retryLabel="Tentar novamente"
          onRetry={refetch}
        />
      )}
      {requests !== null && (
        <ApprovalsBody
          api={api}
          labels={labels}
          status={status}
          requests={requests}
          refetch={refetch}
        />
      )}
    </Stack>
  );
}
