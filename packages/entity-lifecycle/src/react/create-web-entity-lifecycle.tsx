import { useState, type ComponentType, type JSX } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';

import { createLifecycleApiClient, type LifecycleApiClient } from './api';
import { ApprovalsScreen } from './approvals-screen';
import type { LifecycleWebCopy } from './copy';
import { DraftBanner, type DraftBannerProps } from './draft-banner';
import { type EntityTypeLabels } from './labels';
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
 * mounted and supplies every sentence the screens render, and that is the
 * whole wiring.
 *
 * `page` is the standalone surface (Lixeira + Aprovações behind the
 * package's own tabs). The dialog and the banner are per-entity components a
 * host drops INTO its own editors, already bound to the same client.
 */

export interface EntityLifecycleWebConfig {
  /** The admin mount the routes live under, e.g. `/api/admin/minha-loja`. */
  apiBase: string;
  /**
   * Every sentence the screens render — REQUIRED, the host's words.
   * pt-BR hosts pass `PT_BR_LIFECYCLE_WEB_COPY` from `./pt-BR` (re-exported
   * at `@12-apps/entity-lifecycle/react`).
   */
  copy: LifecycleWebCopy;
  /** How the surface reaches its data. Default: same-origin fetch. */
  transport?: LifecycleTransport;
  /** The host's own entity-type labels; an unlisted type renders as its raw key. */
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

/** The two tabs in display order — keys fixed, labels the host's. */
function tabsOf(copy: LifecycleWebCopy): readonly { key: TabKey; label: string }[] {
  return [
    { key: 'recycle-bin', label: copy.tabs.recycleBin },
    { key: 'approvals', label: copy.tabs.approvals },
  ];
}

function LifecycleTabs({
  api,
  labels,
  copy,
}: {
  api: LifecycleApiClient;
  labels: EntityTypeLabels;
  copy: LifecycleWebCopy;
}): JSX.Element {
  const [tab, setTab] = useState<TabKey>('recycle-bin');
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} role="tablist">
        {tabsOf(copy).map((entry) => (
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
          <RecycleBinScreen api={api} labels={labels} copy={copy.recycleBin} />
        ) : (
          <ApprovalsScreen
            api={api}
            labels={labels}
            copy={copy.approvals}
            systemActor={copy.systemActor}
          />
        )}
      </Box>
    </Stack>
  );
}

export function createWebEntityLifecycle(config: EntityLifecycleWebConfig): WebEntityLifecycle {
  const { copy } = config;
  const api = createLifecycleApiClient(
    config.apiBase,
    config.transport ?? httpLifecycleTransport(copy.operationFailed),
  );
  // The host's map, WHOLE — not merged over a shipped one. A base layer here
  // meant every key the host did not restate silently kept another host's
  // word, while the presence of `entityTypeLabels` made it look configured.
  const labels = config.entityTypeLabels ?? {};
  return {
    page: () => <LifecycleTabs api={api} labels={labels} copy={copy} />,
    RecycleBinScreen: () => (
      <RecycleBinScreen api={api} labels={labels} copy={copy.recycleBin} />
    ),
    ApprovalsScreen: () => (
      <ApprovalsScreen
        api={api}
        labels={labels}
        copy={copy.approvals}
        systemActor={copy.systemActor}
      />
    ),
    VersionHistoryDialog: (props) => (
      <VersionHistoryDialog
        api={api}
        copy={copy.versionHistory}
        comparisonCopy={copy.comparison}
        systemActor={copy.systemActor}
        {...props}
      />
    ),
    DraftBanner: (props) => <DraftBanner api={api} copy={copy.draftBanner} {...props} />,
    api,
  };
}
