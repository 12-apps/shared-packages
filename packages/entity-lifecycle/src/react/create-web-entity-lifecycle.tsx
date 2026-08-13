import { useState, type ComponentType, type JSX } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';

import { createLifecycleApiClient, type LifecycleApiClient } from './api';
import { ApprovalsScreen } from './approvals-screen';
import { DraftBanner, type DraftBannerProps } from './draft-banner';
import { DEFAULT_ENTITY_TYPE_LABELS, type EntityTypeLabels } from './labels';
import { RecycleBinScreen } from './recycle-bin-screen';
import {
  VersionHistoryDialog,
  type VersionHistoryDialogProps,
} from './version-history-dialog';
import { httpLifecycleTransport, type LifecycleTransport } from './transport';

/**
 * The one thing this package exposes to a FRONTEND host (12-17).
 *
 * Everything the lifecycle admin IS — the recycle-bin page with its
 * type-to-confirm purge, the approvals inbox with its decision flows, the
 * reusable version-history dialog and the draft banner, and the wire calls
 * between them — lives inside this package. The host names where the API is
 * mounted, and that is the whole wiring.
 *
 * `page` is the standalone surface (Lixeira + Aprovações behind the
 * package's own tabs). The dialog and the banner are per-entity components a
 * host drops INTO its own editors, already bound to the same client.
 */

export interface EntityLifecycleWebConfig {
  /** The admin mount the routes live under, e.g. `/api/admin/minha-loja`. */
  apiBase: string;
  /** How the surface reaches its data. Default: same-origin fetch. */
  transport?: LifecycleTransport;
  /** pt-BR entity-type labels, merged over the future-pay defaults. */
  entityTypeLabels?: EntityTypeLabels;
}

export interface WebEntityLifecycle {
  /** The whole surface: Lixeira + Aprovações behind the package's own tabs. */
  page: ComponentType;
  /** The two screens individually, for hosts that route them themselves. */
  RecycleBinScreen: ComponentType;
  ApprovalsScreen: ComponentType;
  /** Per-entity pieces a host mounts inside its own editors. */
  VersionHistoryDialog: ComponentType<VersionHistoryDialogProps>;
  DraftBanner: ComponentType<DraftBannerProps>;
  /** The bound wire client, for host glue (draft prefetch, etc.). */
  api: LifecycleApiClient;
}

type TabKey = 'recycle-bin' | 'approvals';

const TABS: readonly { key: TabKey; label: string }[] = [
  { key: 'recycle-bin', label: 'Lixeira' },
  { key: 'approvals', label: 'Aprovações' },
];

function LifecycleTabs({
  api,
  labels,
}: {
  api: LifecycleApiClient;
  labels: EntityTypeLabels;
}): JSX.Element {
  const [tab, setTab] = useState<TabKey>('recycle-bin');
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} role="tablist">
        {TABS.map((entry) => (
          <Button
            key={entry.key}
            variant={tab === entry.key ? 'solid' : 'text'}
            role="tab"
            aria-selected={tab === entry.key}
            dataTestId={`lifecycle-tab-${entry.key}`}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </Button>
        ))}
      </Stack>
      <Box>
        {tab === 'recycle-bin' ? (
          <RecycleBinScreen api={api} labels={labels} />
        ) : (
          <ApprovalsScreen api={api} labels={labels} />
        )}
      </Box>
    </Stack>
  );
}

export function createWebEntityLifecycle(config: EntityLifecycleWebConfig): WebEntityLifecycle {
  const api = createLifecycleApiClient(
    config.apiBase,
    config.transport ?? httpLifecycleTransport(),
  );
  const labels = { ...DEFAULT_ENTITY_TYPE_LABELS, ...config.entityTypeLabels };
  return {
    page: () => <LifecycleTabs api={api} labels={labels} />,
    RecycleBinScreen: () => <RecycleBinScreen api={api} labels={labels} />,
    ApprovalsScreen: () => <ApprovalsScreen api={api} labels={labels} />,
    VersionHistoryDialog: (props) => <VersionHistoryDialog api={api} {...props} />,
    DraftBanner: (props) => <DraftBanner api={api} {...props} />,
    api,
  };
}
