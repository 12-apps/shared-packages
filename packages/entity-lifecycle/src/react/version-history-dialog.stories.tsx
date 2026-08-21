/** The version-history dialog, and the click that opens a comparison in it. */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { BY_SELECTION, COPY, HISTORY, API_BASE } from './__stories__/fixtures';
import { createWebEntityLifecycle } from './create-web-entity-lifecycle';
import type { VersionsWire } from './api';
import type { LifecycleResult, LifecycleTransport } from './transport';

const meta: Meta = { title: 'Version history dialog' };
export default meta;

/**
 * The history read answers the list; a read carrying `?compare=N` answers that
 * version's comparison. Written out here rather than through the shared
 * `surface()` helper because this is the ONE screen whose transport has to
 * branch on a query param.
 */
const transport: LifecycleTransport = {
  async get<T>(url: string): Promise<T> {
    const asked = /compare=(\d+)/.exec(url)?.[1];
    const data: VersionsWire = {
      versions: HISTORY,
      publishedVersion: 4,
      ...(asked ? { comparison: BY_SELECTION[Number(asked)] ?? null } : {}),
    };
    return { data } as T;
  },
  async send<T>(): Promise<LifecycleResult<T>> {
    return { ok: false, error: 'Restaurar não faz nada nesta demonstração.' } as LifecycleResult<T>;
  },
};

const { VersionHistoryDialog } = createWebEntityLifecycle({
  apiBase: API_BASE,
  copy: COPY,
  transport,
});

/**
 * The dialog as an admin meets it. Click any row to open its comparison; click
 * the same row again to close it. Every version is wired, so all four column
 * shapes are reachable by clicking rather than by switching story.
 */
export const ClickARowToCompare: StoryObj = {
  name: 'Click a row to compare',
  render: () => (
    <VersionHistoryDialog
      resourcePath="suppliers/s1"
      itemLabel="Distribuidora Sul"
      open
      onClose={() => undefined}
    />
  ),
};
