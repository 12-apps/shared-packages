import { useCallback, useEffect, useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Chip } from '@12-apps/ui/data-display/Chip';
import { EmptyState } from '@12-apps/ui/data-display/EmptyState';
import { ErrorState } from '@12-apps/ui/data-display/ErrorState';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { ConfirmActionDialog, useConfirmAction } from '@12-apps/ui/feedback/ConfirmAction';
import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { LifecycleApiClient, RecycleBinEntryWire } from './api';
import type { RecycleBinCopy } from './copy';
import { DATE_TIME, entityTypeLabel, type EntityTypeLabels } from './labels';
import { RestoreConflictDialog } from './restore-conflict-dialog';
import type { LifecycleResult } from './transport';
import type { RestoreConflict } from '../restore-conflict';

/**
 * Lixeira (12-17) — the soft-delete recycle bin of the entity-lifecycle
 * machinery, ported from the origin host's `pages/recycle-bin` with its test ids
 * intact: every binned entry (all registered collections) as simple cards,
 * each restorable or permanently purgeable (behind the FUT-546
 * type-to-confirm popup — the bin is itself the undo for everything else, and
 * purge empties it). Every sentence comes from the host's
 * {@link RecycleBinCopy}.
 */

interface BinActions {
  busyId: string | null;
  error: string | null;
  clearError: () => void;
  restore: (entry: RecycleBinEntryWire) => Promise<void>;
  requestPurge: (entry: RecycleBinEntryWire) => void;
  purgeDialog: JSX.Element | null;
  /** The rename dialog of a restore refused for a clash, while one is open. */
  conflictDialog: JSX.Element | null;
}

/**
 * The rename dialog of a restore refused for a clash: opened with the host's
 * conflict, retried with what was typed, closed (and the list refetched) once
 * a retry lands.
 */
function useRestoreClash(
  api: LifecycleApiClient,
  copy: RecycleBinCopy,
  refetch: () => void,
): { open: (entry: RecycleBinEntryWire, conflict: RestoreConflict) => void; dialog: JSX.Element | null } {
  const [clashing, setClashing] = useState<{
    entry: RecycleBinEntryWire;
    conflict: RestoreConflict;
  } | null>(null);
  const dialog = clashing ? (
    <RestoreConflictDialog
      key={clashing.entry.id}
      conflict={clashing.conflict}
      restoreLabel={copy.restoreAction}
      cancelLabel={copy.confirmAction.cancel}
      onCancel={() => setClashing(null)}
      onRestore={async (overrides) => {
        const result = await api.restoreEntry(clashing.entry.id, overrides);
        if (result.ok) {
          setClashing(null);
          refetch();
        }
        return result.ok ? { ok: true } : result;
      }}
    />
  ) : null;
  return { open: (entry, conflict) => setClashing({ entry, conflict }), dialog };
}

function useBinActions(
  api: LifecycleApiClient,
  copy: RecycleBinCopy,
  refetch: () => void,
): BinActions {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purging, setPurging] = useState<RecycleBinEntryWire | null>(null);
  const clash = useRestoreClash(api, copy, refetch);

  async function run(
    entryId: string,
    dispatch: () => Promise<LifecycleResult<void>>,
  ): Promise<void> {
    setBusyId(entryId);
    setError(null);
    try {
      const result = await dispatch();
      if (!result.ok) {
        setError(result.error);
        // Rejecting keeps the confirmation popup open on the failure; the page
        // alert above carries it once the popup is dismissed.
        throw new Error(result.error);
      }
      refetch();
    } finally {
      setBusyId(null);
    }
  }

  const purgeState = useConfirmAction(async () => {
    if (!purging) return;
    const target = purging;
    await run(target.id, () => api.purgeEntry(target.id));
    setPurging(null);
  }, copy.purgeFailed);

  return {
    busyId,
    error,
    clearError: () => setError(null),
    restore: async (entry) => {
      setBusyId(entry.id);
      setError(null);
      try {
        const result = await api.restoreEntry(entry.id);
        if (result.ok) refetch();
        // A clash is not a failure to report: it is a question, asked in the
        // rename dialog, and the entry stays in the bin until it is answered.
        else if (result.conflict) clash.open(entry, result.conflict);
        else setError(result.error);
      } finally {
        setBusyId(null);
      }
    },
    requestPurge: (entry) => {
      setPurging(entry);
      purgeState.request();
    },
    purgeDialog: purging ? (
      <ConfirmActionDialog
        state={purgeState}
        title={copy.purgeDialogTitle}
        entityName={purging.label}
        description={copy.purgeBody(purging.label)}
        confirmText={copy.purgeConfirmText}
        typeToConfirm={purging.label}
        typeToConfirmLabel={copy.purgeTypeToConfirmLabel(purging.label)}
        copy={copy.confirmAction}
        dataTestId="recycle-bin-purge-confirm"
      />
    ) : null,
    conflictDialog: clash.dialog,
  };
}

/** One binned entry card: label, type chip, deletion stamp, children, actions. */
function BinEntryCard({
  entry,
  labels,
  copy,
  busy,
  onRestore,
  onPurge,
}: {
  entry: RecycleBinEntryWire;
  labels: EntityTypeLabels;
  copy: RecycleBinCopy;
  busy: boolean;
  onRestore: () => void;
  onPurge: () => void;
}): JSX.Element {
  return (
    <Box
      data-testid={`recycle-bin-entry-${entry.id}`}
      sx={{ p: 2, borderRadius: 1, border: (theme) => `1px solid ${theme.palette.divider}` }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
        <Text variant="heading" size="sm" as="h3">
          {entry.label}
        </Text>
        <Chip label={entityTypeLabel(labels, entry.entityType)} size="sm" variant="outlined" />
        <Box sx={{ flex: 1 }} />
        <Button
          variant="outline"
          size="sm"
          loading={busy}
          onClick={onRestore}
          dataTestId={`recycle-bin-restore-${entry.id}`}
        >
          {copy.restoreAction}
        </Button>
        <Button
          variant="text"
          color="danger"
          size="sm"
          disabled={busy}
          onClick={onPurge}
          dataTestId={`recycle-bin-purge-${entry.id}`}
        >
          {copy.purgeAction}
        </Button>
      </Stack>
      <Text variant="caption" as="p" color="secondary">
        {copy.deletedAtPrefix} {DATE_TIME.format(new Date(entry.deletedAt))}
        {entry.deletedByName ? copy.deletedBy(entry.deletedByName) : ''}
      </Text>
      {entry.children.length > 0 && (
        <Text variant="caption" as="p" color="secondary">
          Inclui: {entry.children.map((child) => child.label).join(', ')}
        </Text>
      )}
    </Box>
  );
}

/** The entries list (or the empty bin notice) plus the action feedback. */
function BinBody({
  api,
  labels,
  copy,
  entries,
  refetch,
}: {
  api: LifecycleApiClient;
  labels: EntityTypeLabels;
  copy: RecycleBinCopy;
  entries: RecycleBinEntryWire[];
  refetch: () => void;
}): JSX.Element {
  const actions = useBinActions(api, copy, refetch);

  if (entries.length === 0) {
    return (
      <EmptyState
        title={copy.emptyTitle}
        description={copy.emptyBody}
        dataTestId="recycle-bin-empty"
      />
    );
  }
  return (
    <Stack spacing={1.5} data-testid="recycle-bin-list">
      {actions.error && (
        <Alert
          variant="danger"
          title={copy.actionFailedTitle}
          description={actions.error}
          closable
          closeLabel={copy.dismissNotice}
          onClose={actions.clearError}
          data-testid="recycle-bin-error"
        />
      )}
      {entries.map((entry) => (
        <BinEntryCard
          key={entry.id}
          entry={entry}
          labels={labels}
          copy={copy}
          busy={actions.busyId === entry.id}
          onRestore={() => void actions.restore(entry)}
          onPurge={() => actions.requestPurge(entry)}
        />
      ))}
      {actions.purgeDialog}
      {actions.conflictDialog}
    </Stack>
  );
}

export function RecycleBinScreen({
  api,
  labels,
  copy,
}: {
  api: LifecycleApiClient;
  labels: EntityTypeLabels;
  copy: RecycleBinCopy;
}): JSX.Element {
  const [entries, setEntries] = useState<RecycleBinEntryWire[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .listRecycleBin()
      .then((payload) => {
        if (!cancelled) {
          setEntries(payload.entries);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [api, generation]);

  const refetch = useCallback(() => setGeneration((value) => value + 1), []);

  if (loadError) {
    return (
      <ErrorState
        title={copy.loadFailedTitle}
        message={loadError}
        retryLabel={copy.retryAction}
        onRetry={refetch}
      />
    );
  }
  if (entries === null) {
    return <LoadingState dataTestId="recycle-bin-loading" />;
  }
  return <BinBody api={api} labels={labels} copy={copy} entries={entries} refetch={refetch} />;
}
