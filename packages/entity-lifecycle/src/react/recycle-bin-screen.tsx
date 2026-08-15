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
import { DATE_TIME, entityTypeLabel, type EntityTypeLabels } from './labels';
import type { LifecycleResult } from './transport';

/**
 * Lixeira (12-17) — the soft-delete recycle bin of the entity-lifecycle
 * machinery, ported from the origin host's `pages/recycle-bin` with its test ids
 * and pt-BR copy intact: every binned entry (all registered collections) as
 * simple cards, each restorable ("Restaurar") or permanently purgeable
 * ("Excluir definitivamente", behind the FUT-546 type-to-confirm popup — the
 * bin is itself the undo for everything else, and purge empties it).
 */

interface BinActions {
  busyId: string | null;
  error: string | null;
  clearError: () => void;
  restore: (entry: RecycleBinEntryWire) => Promise<void>;
  requestPurge: (entry: RecycleBinEntryWire) => void;
  purgeDialog: JSX.Element | null;
}

function useBinActions(api: LifecycleApiClient, refetch: () => void): BinActions {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purging, setPurging] = useState<RecycleBinEntryWire | null>(null);

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
  }, 'Não foi possível excluir definitivamente.');

  return {
    busyId,
    error,
    clearError: () => setError(null),
    restore: (entry) => run(entry.id, () => api.restoreEntry(entry.id)),
    requestPurge: (entry) => {
      setPurging(entry);
      purgeState.request();
    },
    purgeDialog: purging ? (
      <ConfirmActionDialog
        state={purgeState}
        title="Excluir definitivamente"
        entityName={purging.label}
        description={`"${purging.label}" será excluído para sempre, junto com seus itens vinculados. Esta ação não pode ser desfeita.`}
        confirmText="Excluir definitivamente"
        typeToConfirm={purging.label}
        typeToConfirmLabel={`Digite "${purging.label}" para confirmar.`}
        dataTestId="recycle-bin-purge-confirm"
      />
    ) : null,
  };
}

/** One binned entry card: label, type chip, deletion stamp, children, actions. */
function BinEntryCard({
  entry,
  labels,
  busy,
  onRestore,
  onPurge,
}: {
  entry: RecycleBinEntryWire;
  labels: EntityTypeLabels;
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
          Restaurar
        </Button>
        <Button
          variant="text"
          color="danger"
          size="sm"
          disabled={busy}
          onClick={onPurge}
          dataTestId={`recycle-bin-purge-${entry.id}`}
        >
          Excluir definitivamente
        </Button>
      </Stack>
      <Text variant="caption" as="p" color="secondary">
        Excluído em {DATE_TIME.format(new Date(entry.deletedAt))}
        {entry.deletedByName ? ` por ${entry.deletedByName}` : ''}
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
  entries,
  refetch,
}: {
  api: LifecycleApiClient;
  labels: EntityTypeLabels;
  entries: RecycleBinEntryWire[];
  refetch: () => void;
}): JSX.Element {
  const actions = useBinActions(api, refetch);

  if (entries.length === 0) {
    return (
      <EmptyState
        title="A lixeira está vazia."
        description="Itens excluídos aparecem aqui e podem ser restaurados."
        dataTestId="recycle-bin-empty"
      />
    );
  }
  return (
    <Stack spacing={1.5} data-testid="recycle-bin-list">
      {actions.error && (
        <Alert
          variant="danger"
          title="Não foi possível concluir a ação"
          description={actions.error}
          closable
          onClose={actions.clearError}
          data-testid="recycle-bin-error"
        />
      )}
      {entries.map((entry) => (
        <BinEntryCard
          key={entry.id}
          entry={entry}
          labels={labels}
          busy={actions.busyId === entry.id}
          onRestore={() => void actions.restore(entry)}
          onPurge={() => actions.requestPurge(entry)}
        />
      ))}
      {actions.purgeDialog}
    </Stack>
  );
}

export function RecycleBinScreen({
  api,
  labels,
}: {
  api: LifecycleApiClient;
  labels: EntityTypeLabels;
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
        title="Não foi possível carregar a lixeira"
        message={loadError}
        retryLabel="Tentar novamente"
        onRetry={refetch}
      />
    );
  }
  if (entries === null) {
    return <LoadingState dataTestId="recycle-bin-loading" />;
  }
  return <BinBody api={api} labels={labels} entries={entries} refetch={refetch} />;
}
