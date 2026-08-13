import { useCallback, useEffect, useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { AlertDialog } from '@12-apps/ui/data-display/AlertDialog';
import { Chip } from '@12-apps/ui/data-display/Chip';
import { ErrorState } from '@12-apps/ui/data-display/ErrorState';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { Dialog, DialogContent } from '@12-apps/ui/feedback/Dialog';
import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { LifecycleApiClient, VersionsWire, VersionWire } from './api';
import { DATE_TIME } from './labels';
import { LifecycleHttpError } from './transport';

/**
 * Reusable, entity-agnostic version-history dialog (12-17), ported from
 * future-pay's `shared/lifecycle/VersionHistoryDialog` with its test ids and
 * pt-BR copy intact: lists `GET <apiBase>/{resourcePath}/versions` newest
 * first and lets the admin restore any non-current version (behind an
 * AlertDialog confirm). A 403 (feature off for the tenant) renders a friendly
 * notice; a parked restore (202 → `applied: false`) surfaces the
 * pending-approval notice.
 */

/** pt-BR labels for the version kinds. */
const KIND_LABELS: Record<VersionWire['kind'], string> = {
  CREATE: 'Criação',
  UPDATE: 'Alteração',
  RESTORE: 'Restauração',
};

export interface VersionHistoryDialogProps {
  /** Entity resource path under the mount, e.g. `products/${id}`. */
  resourcePath: string;
  /** Human label of the item, shown in the dialog title. */
  itemLabel: string;
  open: boolean;
  onClose: () => void;
  /** Called after a restore is applied (so the owning page can refresh). */
  onRestored?: () => void;
}

/** One version row: number, kind chip, date, author, field chips + restore. */
function VersionRow({
  entry,
  isCurrent,
  onRestore,
}: {
  entry: VersionWire;
  isCurrent: boolean;
  onRestore: (version: number) => void;
}): JSX.Element {
  return (
    <Box
      data-testid={`version-row-${entry.version}`}
      sx={{ p: 1.5, borderRadius: 1, border: (theme) => `1px solid ${theme.palette.divider}` }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
        <Text variant="heading" size="sm" as="span">
          {`v${entry.version}`}
        </Text>
        <Chip label={KIND_LABELS[entry.kind]} size="sm" variant="outlined" />
        {isCurrent && <Chip label="Versão atual" size="sm" color="primary" />}
        {entry.restoredFromVersion !== null && (
          <Chip
            label={`a partir da v${entry.restoredFromVersion}`}
            size="sm"
            variant="outlined"
          />
        )}
        <Box sx={{ flex: 1 }} />
        {!isCurrent && (
          <Button
            variant="outline"
            size="xs"
            onClick={() => onRestore(entry.version)}
            dataTestId={`version-restore-${entry.version}`}
          >
            Restaurar
          </Button>
        )}
      </Stack>
      <Text variant="caption" as="p" color="secondary">
        {DATE_TIME.format(new Date(entry.createdAt))} · {entry.actorName ?? 'Sistema'}
      </Text>
      {(entry.changedFields.length > 0 || entry.removedFields.length > 0) && (
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
          {entry.changedFields.map((field) => (
            <Chip key={`c-${field}`} label={field} size="sm" variant="outlined" />
          ))}
          {entry.removedFields.map((field) => (
            <Chip key={`r-${field}`} label={`− ${field}`} size="sm" variant="outlined" />
          ))}
        </Stack>
      )}
    </Box>
  );
}

interface HistoryLoad {
  data: VersionsWire | null;
  error: { status: number | null; message: string } | null;
  refetch: () => void;
}

function useHistory(api: LifecycleApiClient, resourcePath: string, open: boolean): HistoryLoad {
  const [data, setData] = useState<VersionsWire | null>(null);
  const [error, setError] = useState<HistoryLoad['error']>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    // Fetches only while open — the dialog is mounted next to a grid row.
    if (!open) return undefined;
    let cancelled = false;
    setData(null);
    setError(null);
    api
      .listVersions(resourcePath)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError({
          status: cause instanceof LifecycleHttpError ? cause.status : null,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [api, resourcePath, open, generation]);

  return { data, error, refetch: useCallback(() => setGeneration((v) => v + 1), []) };
}

interface RestoreFlow {
  confirming: number | null;
  setConfirming: (version: number | null) => void;
  busy: boolean;
  notice: { variant: 'success' | 'info' | 'danger'; message: string } | null;
  clearNotice: () => void;
  confirmRestore: () => Promise<void>;
}

/** Restore-flow state + dispatch (confirm dialog, notices, refetch). */
function useRestoreFlow(
  api: LifecycleApiClient,
  props: VersionHistoryDialogProps,
  refetch: () => void,
): RestoreFlow {
  const [confirming, setConfirming] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<RestoreFlow['notice']>(null);

  async function confirmRestore(): Promise<void> {
    if (confirming === null) return;
    setBusy(true);
    try {
      const result = await api.restoreVersion(props.resourcePath, confirming);
      if (!result.ok) {
        setNotice({ variant: 'danger', message: result.error });
        return;
      }
      if (result.data.applied) {
        setNotice({ variant: 'success', message: `Versão v${confirming} restaurada.` });
        refetch();
        props.onRestored?.();
      } else {
        // 202 — parked for approval; nothing changed yet.
        setNotice({ variant: 'info', message: 'Alteração enviada para aprovação.' });
      }
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  return {
    confirming,
    setConfirming,
    busy,
    notice,
    clearNotice: () => setNotice(null),
    confirmRestore,
  };
}

/** The list body: loading / feature-off / error / version rows. */
function VersionsBody({
  load,
  onRestore,
}: {
  load: HistoryLoad;
  onRestore: (version: number) => void;
}): JSX.Element {
  if (load.error) {
    // Feature off for the tenant — a friendly notice instead of an error state.
    if (load.error.status === 403) {
      return (
        <Alert
          variant="info"
          description="O histórico de versões não está ativo para esta loja."
          data-testid="version-history-feature-off"
        />
      );
    }
    return (
      <ErrorState
        title="Não foi possível carregar o histórico"
        message={load.error.message}
        retryLabel="Tentar novamente"
        onRetry={load.refetch}
      />
    );
  }
  if (load.data === null) {
    return <LoadingState dataTestId="version-history-loading" />;
  }
  if (load.data.versions.length === 0) {
    return (
      <Text variant="body" as="p">
        Nenhuma versão registrada.
      </Text>
    );
  }
  const { versions, publishedVersion } = load.data;
  return (
    <Stack spacing={1}>
      {versions.map((entry) => (
        <VersionRow
          key={entry.version}
          entry={entry}
          isCurrent={entry.version === publishedVersion}
          onRestore={onRestore}
        />
      ))}
    </Stack>
  );
}

/**
 * The generic version-history dialog: newest-first list of an entity's
 * versions with per-version restore. Entity-agnostic via `resourcePath`.
 */
export function VersionHistoryDialog({
  api,
  ...props
}: VersionHistoryDialogProps & { api: LifecycleApiClient }): JSX.Element {
  const load = useHistory(api, props.resourcePath, props.open);
  const restore = useRestoreFlow(api, props, load.refetch);

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title={`Histórico de versões — ${props.itemLabel}`}
      size="sm"
      showCloseButton
      dataTestId="version-history-dialog"
    >
      <DialogContent>
        <Stack spacing={2}>
          {restore.notice && (
            <Alert
              variant={restore.notice.variant}
              description={restore.notice.message}
              closable
              onClose={restore.clearNotice}
              data-testid="version-history-notice"
            />
          )}
          <VersionsBody load={load} onRestore={restore.setConfirming} />
        </Stack>
      </DialogContent>
      <AlertDialog
        open={restore.confirming !== null}
        title="Restaurar versão"
        description={`O conteúdo atual será substituído pela versão v${restore.confirming ?? ''}. Uma nova versão será registrada no histórico.`}
        confirmText="Restaurar"
        cancelText="Cancelar"
        loading={restore.busy}
        onConfirm={() => void restore.confirmRestore()}
        onCancel={() => restore.setConfirming(null)}
        data-testid="version-restore-confirm"
      />
    </Dialog>
  );
}
