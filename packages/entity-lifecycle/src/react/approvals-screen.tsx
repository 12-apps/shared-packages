import { useState, type JSX } from 'react';

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
import { useApprovalsLoad } from './approvals-load';
import type { ApprovalsCopy } from './copy';
import { DATE_TIME, entityTypeLabel, type EntityTypeLabels } from './labels';
import type { LifecycleResult } from './transport';

/**
 * Aprovações (12-17) — the parked-change-request inbox of the
 * entity-lifecycle machinery, ported from the origin host's `pages/approvals`
 * with its test ids intact: filter chips (pending / approved / rejected); a
 * PENDING row offers approve and reject (the reject dialog takes an optional
 * note). A 403 (feature off for the tenant) renders a friendly notice. Every
 * sentence comes from the host's {@link ApprovalsCopy}.
 */

/**
 * What a HOST may hand the screen (FUT-2520) — both optional, so a host that
 * passes neither renders exactly as before.
 */
export interface ApprovalsScreenHostProps {
  /**
   * Any change in its value re-reads the current status list in the
   * BACKGROUND: the rows stay on screen, with no loading state. The value
   * itself means nothing — a counter bumped on a realtime hint or a window
   * focus is the intended shape. The mount's first value reads nothing extra.
   */
  refreshSignal?: unknown;
  /**
   * Called once after each SUCCESSFUL approve or reject (never a refused one),
   * so the host can refresh its own copy of the queue, such as a nav badge.
   * A throw or a rejected promise from it is swallowed: it cannot turn the
   * decision into a failure, and the host's hook reports its own errors.
   */
  onDecided?: () => void;
}

/** The status filter chips, in display order. */
const STATUS_ORDER: readonly ApprovalStatusWire[] = ['PENDING', 'APPROVED', 'REJECTED'];

/** Wire status → the copy key `statusFilters` and `emptyByStatus` share. */
const STATUS_COPY_KEYS: Record<ApprovalStatusWire, keyof ApprovalsCopy['statusFilters']> = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

/** Wire action → the copy key naming what the request wants to do. */
const ACTION_COPY_KEYS: Record<ApprovalRequestWire['action'], keyof ApprovalsCopy['actions']> = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
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

/**
 * Tell the host a decision stood. Its hook can never undo that: a throw or a
 * rejected promise from it is swallowed rather than escaping the click as an
 * unhandled rejection. The decision is recorded and the list re-reads either
 * way, and the host's hook owns its own error reporting.
 */
function notifyDecided(onDecided: (() => void) | undefined): void {
  if (!onDecided) return;
  // Widened to `unknown` so an ASYNC hook's rejection is absorbed too.
  const hook: () => unknown = onDecided;
  try {
    Promise.resolve(hook()).catch(() => undefined);
  } catch {
    // A synchronous throw is the host's bug; the decision already stood.
  }
}

/** Decision dispatch state: approve, and the note-gated reject dialog. */
function useDecisionActions(
  api: LifecycleApiClient,
  refetch: () => void,
  onDecided: (() => void) | undefined,
): DecisionActions {
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
      if (result.ok) {
        refetch();
        notifyDecided(onDecided);
      } else setError(result.error);
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
  copy,
  onClose,
  onConfirm,
}: {
  request: ApprovalRequestWire | null;
  copy: ApprovalsCopy;
  onClose: () => void;
  onConfirm: (note: string) => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  return (
    <Dialog
      open={request !== null}
      onClose={onClose}
      title={request ? copy.rejectDialogTitle(request.label) : copy.rejectDialogTitleNoTarget}
      size="sm"
      showCloseButton
      dataTestId="approval-reject-dialog"
    >
      <DialogContent>
        <Stack spacing={2}>
          <Textarea
            label={copy.rejectNoteLabel}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            dataTestId="approval-reject-note"
          />
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button variant="text" onClick={onClose} dataTestId="approval-reject-cancel">
              {copy.cancelAction}
            </Button>
            <Button
              color="danger"
              onClick={() => {
                onConfirm(note);
                setNote('');
              }}
              dataTestId="approval-reject-confirm"
            >
              {copy.rejectAction}
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
  copy,
  systemActor,
  busy,
  onApprove,
  onReject,
}: {
  request: ApprovalRequestWire;
  labels: EntityTypeLabels;
  copy: ApprovalsCopy;
  systemActor: string;
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
        <Chip label={copy.actions[ACTION_COPY_KEYS[request.action]]} size="sm" variant="outlined" />
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
              {copy.approveAction}
            </Button>
            <Button
              variant="outline"
              color="danger"
              size="sm"
              disabled={busy}
              onClick={onReject}
              dataTestId={`approval-reject-${request.id}`}
            >
              {copy.rejectAction}
            </Button>
          </>
        )}
      </Stack>
      <Text variant="caption" as="p" color="secondary">
        {copy.requestedBy(request.requestedByName ?? systemActor)}{' '}
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
  copy,
  systemActor,
  status,
  requests,
  refetch,
  onDecided,
}: {
  api: LifecycleApiClient;
  labels: EntityTypeLabels;
  copy: ApprovalsCopy;
  systemActor: string;
  status: ApprovalStatusWire;
  requests: ApprovalRequestWire[];
  refetch: () => void;
  onDecided: (() => void) | undefined;
}): JSX.Element {
  const actions = useDecisionActions(api, refetch, onDecided);

  return (
    <Stack spacing={1.5} data-testid="approvals-list">
      {actions.error && (
        <Alert
          variant="danger"
          title={copy.decisionFailedTitle}
          description={actions.error}
          closable
          closeLabel={copy.dismissNotice}
          onClose={actions.clearError}
          data-testid="approvals-error"
        />
      )}
      {requests.length === 0 ? (
        <EmptyState title={copy.emptyByStatus[STATUS_COPY_KEYS[status]]} dataTestId="approvals-empty" />
      ) : (
        requests.map((request) => (
          <RequestCard
            key={request.id}
            request={request}
            labels={labels}
            copy={copy}
            systemActor={systemActor}
            busy={actions.busyId === request.id}
            onApprove={() => void actions.approve(request)}
            onReject={() => actions.setRejecting(request)}
          />
        ))
      )}
      <RejectDialog
        request={actions.rejecting}
        copy={copy}
        onClose={() => actions.setRejecting(null)}
        onConfirm={(note) => void actions.reject(note)}
      />
    </Stack>
  );
}

export function ApprovalsScreen({
  api,
  labels,
  copy,
  systemActor,
  refreshSignal,
  onDecided,
}: {
  api: LifecycleApiClient;
  labels: EntityTypeLabels;
  copy: ApprovalsCopy;
  systemActor: string;
} & ApprovalsScreenHostProps): JSX.Element {
  const [status, setStatus] = useState<ApprovalStatusWire>('PENDING');
  const { requests, loadError, refetch } = useApprovalsLoad(api, status, refreshSignal);

  // Feature off for the tenant — a friendly notice instead of an error state.
  const featureOff = loadError !== null && loadError.status === 403;

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} data-testid="approvals-status-filter">
        {STATUS_ORDER.map((value) => (
          <Chip
            key={value}
            label={copy.statusFilters[STATUS_COPY_KEYS[value]]}
            selectable
            selected={status === value}
            onClick={() => setStatus(value)}
            dataTestId={`approvals-filter-${value}`}
          />
        ))}
      </Stack>
      {requests === null && loadError === null && <LoadingState dataTestId="approvals-loading" />}
      {featureOff && (
        <Alert
          variant="info"
          description={copy.featureOffBody}
          data-testid="approvals-feature-off"
        />
      )}
      {loadError !== null && !featureOff && (
        <ErrorState
          title={copy.loadFailedTitle}
          message={loadError.message}
          retryLabel={copy.retryAction}
          onRetry={refetch}
        />
      )}
      {requests !== null && (
        <ApprovalsBody
          api={api}
          labels={labels}
          copy={copy}
          systemActor={systemActor}
          status={status}
          requests={requests}
          refetch={refetch}
          onDecided={onDecided}
        />
      )}
    </Stack>
  );
}
