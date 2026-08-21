import { Fragment, useCallback, useEffect, useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { AlertDialog } from '@12-apps/ui/data-display/AlertDialog';
import { ErrorState } from '@12-apps/ui/data-display/ErrorState';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { Dialog, DialogContent } from '@12-apps/ui/feedback/Dialog';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { LifecycleApiClient, VersionsWire } from './api';
import type { VersionComparisonCopy, VersionHistoryCopy } from './copy';
import { LifecycleHttpError } from './transport';
import { VersionComparisonSection } from './version-comparison-panel';
import { VersionRow } from './version-row';

/**
 * Reusable, entity-agnostic version-history dialog (12-17), ported from
 * the origin host's `shared/lifecycle/VersionHistoryDialog` with its test ids
 * intact: lists `GET <apiBase>/{resourcePath}/versions` newest
 * first and lets the admin restore any non-current version (behind an
 * AlertDialog confirm). A 403 (feature off for the tenant) renders a friendly
 * notice; a parked restore (202 → `applied: false`) surfaces the
 * pending-approval notice. Every sentence comes from the host's
 * {@link VersionHistoryCopy}.
 *
 * CLICKING a row opens the comparison panel under it (FUT-247): that version
 * beside its previous, its next and the current one, field by field. The list
 * alone can only name the fields a version touched — the row stores nothing
 * else — so "what did it actually say" is a second, deliberate read.
 */

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
  copy: VersionHistoryCopy,
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
        setNotice({ variant: 'success', message: copy.restored(confirming) });
        refetch();
        props.onRestored?.();
      } else {
        // 202 — parked for approval; nothing changed yet.
        setNotice({ variant: 'info', message: copy.sentToApproval });
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

/** Which version the admin is comparing, cleared whenever the list reloads. */
function useSelectedVersion(data: VersionsWire | null): {
  selected: number | null;
  toggle: (version: number) => void;
} {
  const [selected, setSelected] = useState<number | null>(null);
  // A restore rewrites the history under the panel, so the selection cannot
  // survive a reload — it would leave a comparison of a list that has moved.
  useEffect(() => setSelected(null), [data]);
  return {
    selected,
    toggle: useCallback(
      (version: number) => setSelected((current) => (current === version ? null : version)),
      [],
    ),
  };
}

interface VersionsBodyProps {
  api: LifecycleApiClient;
  resourcePath: string;
  copy: VersionHistoryCopy;
  comparisonCopy: VersionComparisonCopy;
  systemActor: string;
  load: HistoryLoad;
  selected: number | null;
  onSelect: (version: number) => void;
  onRestore: (version: number) => void;
}

/** The list body: loading / feature-off / error / version rows. */
function VersionsBody({
  api,
  resourcePath,
  copy,
  comparisonCopy,
  systemActor,
  load,
  selected,
  onSelect,
  onRestore,
}: VersionsBodyProps): JSX.Element {
  if (load.error) {
    // Feature off for the tenant — a friendly notice instead of an error state.
    if (load.error.status === 403) {
      return (
        <Alert
          variant="info"
          description={copy.featureOffBody}
          data-testid="version-history-feature-off"
        />
      );
    }
    return (
      <ErrorState
        title={copy.loadFailedTitle}
        message={load.error.message}
        retryLabel={copy.retryAction}
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
        {copy.emptyBody}
      </Text>
    );
  }
  const { versions, publishedVersion } = load.data;
  return (
    <Stack spacing={1}>
      {versions.map((entry) => (
        <Fragment key={entry.version}>
          <VersionRow
            entry={entry}
            copy={copy}
            systemActor={systemActor}
            isCurrent={entry.version === publishedVersion}
            isSelected={selected === entry.version}
            onSelect={onSelect}
            onRestore={onRestore}
          />
          {/* Below the row rather than inside it: the row IS a button, and a
              table of interactive-width content does not belong in one. */}
          {selected === entry.version && (
            <VersionComparisonSection
              api={api}
              resourcePath={resourcePath}
              copy={comparisonCopy}
              systemActor={systemActor}
              version={entry.version}
            />
          )}
        </Fragment>
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
  copy,
  comparisonCopy,
  systemActor,
  ...props
}: VersionHistoryDialogProps & {
  api: LifecycleApiClient;
  copy: VersionHistoryCopy;
  comparisonCopy: VersionComparisonCopy;
  systemActor: string;
}): JSX.Element {
  const load = useHistory(api, props.resourcePath, props.open);
  const restore = useRestoreFlow(api, props, copy, load.refetch);
  const comparison = useSelectedVersion(load.data);

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title={copy.title(props.itemLabel)}
      // The list alone is a narrow dialog; a four-column comparison is not.
      size={comparison.selected === null ? 'sm' : 'lg'}
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
          <VersionsBody
            api={api}
            resourcePath={props.resourcePath}
            copy={copy}
            comparisonCopy={comparisonCopy}
            systemActor={systemActor}
            load={load}
            selected={comparison.selected}
            onSelect={comparison.toggle}
            onRestore={restore.setConfirming}
          />
        </Stack>
      </DialogContent>
      <AlertDialog
        open={restore.confirming !== null}
        // `0` never renders: the dialog is closed while nothing is confirming.
        title={copy.restoreDialogTitle}
        description={copy.restoreDialogBody(restore.confirming ?? 0)}
        confirmText={copy.restoreConfirm}
        cancelText={copy.cancelAction}
        loading={restore.busy}
        onConfirm={() => void restore.confirmRestore()}
        onCancel={() => restore.setConfirming(null)}
        data-testid="version-restore-confirm"
      />
    </Dialog>
  );
}
