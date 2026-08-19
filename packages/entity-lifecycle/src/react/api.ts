import type { Snapshot } from '../types';
import type {
  DraftWire,
  VersionComparisonWire,
  VersionsWire,
  WriteOutcomeWire,
} from '../wire';

import type { LifecycleResult, LifecycleTransport } from './transport';

/**
 * The typed wire calls the screens make (12-17) — the REST twins of the
 * `/server` descriptors, built from an `apiBase` (the host's admin mount,
 * e.g. `/api/admin/minha-loja`). Paths here and in `routes-*.ts` are ONE
 * contract; changing either alone is a drift bug.
 */

export type {
  ComparisonCellWire,
  ComparisonColumnWire,
  ComparisonRoleWire,
  ComparisonRowWire,
  DraftWire,
  VersionComparisonWire,
  VersionsWire,
  VersionWire,
  WriteOutcomeWire,
} from '../wire';

export interface RecycleBinChildWire {
  id: string;
  entityType: string;
  label: string;
}

export interface RecycleBinEntryWire {
  id: string;
  entityType: string;
  entityId: string;
  label: string;
  deletedBy: string | null;
  deletedByName: string | null;
  deletedAt: string;
  status: string;
  children: RecycleBinChildWire[];
}

export type ApprovalStatusWire = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ApprovalRequestWire {
  id: string;
  entityType: string;
  entityId: string | null;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  label: string;
  status: ApprovalStatusWire;
  requestedBy: string | null;
  requestedByName: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface LifecycleApiClient {
  /** `resourcePath` is `<slug>/<entityId>`, e.g. `products/p1`. */
  listVersions(resourcePath: string): Promise<VersionsWire>;
  /**
   * The comparison table for one version — it, its neighbours and the current
   * one. Same endpoint as {@link listVersions}, asked a bigger question, so a
   * host that mounts the history route has this for free.
   */
  compareVersion(resourcePath: string, version: number): Promise<VersionComparisonWire | null>;
  restoreVersion(resourcePath: string, version: number): Promise<LifecycleResult<WriteOutcomeWire>>;
  getDraft(resourcePath: string): Promise<{ draft: DraftWire | null }>;
  saveDraft(resourcePath: string, data: Snapshot): Promise<LifecycleResult<{ draft: DraftWire }>>;
  listDrafts(slug: string): Promise<{ drafts: DraftWire[] }>;
  createDraft(slug: string, data: Snapshot): Promise<LifecycleResult<{ draft: DraftWire }>>;
  publishDraft(slug: string, draftId: string): Promise<LifecycleResult<WriteOutcomeWire>>;
  discardDraft(slug: string, draftId: string): Promise<LifecycleResult<void>>;
  listRecycleBin(entityType?: string): Promise<{ entries: RecycleBinEntryWire[] }>;
  restoreEntry(entryId: string): Promise<LifecycleResult<void>>;
  purgeEntry(entryId: string): Promise<LifecycleResult<void>>;
  listApprovals(status: ApprovalStatusWire): Promise<{ requests: ApprovalRequestWire[] }>;
  approveRequest(requestId: string): Promise<LifecycleResult<WriteOutcomeWire>>;
  rejectRequest(requestId: string, note?: string): Promise<LifecycleResult<void>>;
}

/** Unwrap the `{ data }` envelope every successful read carries. */
async function readData<T>(transport: LifecycleTransport, path: string): Promise<T> {
  const payload = await transport.get<{ data: T }>(path);
  return payload.data;
}

export function createLifecycleApiClient(
  apiBase: string,
  transport: LifecycleTransport,
): LifecycleApiClient {
  const base = apiBase.replace(/\/$/, '');
  return {
    listVersions: (resourcePath) =>
      readData(transport, `${base}/${resourcePath}/versions`),
    compareVersion: async (resourcePath, version) => {
      const payload = await readData<VersionsWire>(
        transport,
        `${base}/${resourcePath}/versions?compare=${version}`,
      );
      return payload.comparison ?? null;
    },
    restoreVersion: (resourcePath, version) =>
      transport.send(`${base}/${resourcePath}/versions/${version}/restore`, 'POST'),
    getDraft: (resourcePath) => readData(transport, `${base}/${resourcePath}/draft`),
    saveDraft: (resourcePath, data) =>
      transport.send(`${base}/${resourcePath}/draft`, 'PUT', { data }),
    listDrafts: (slug) => readData(transport, `${base}/${slug}/drafts`),
    createDraft: (slug, data) => transport.send(`${base}/${slug}/drafts`, 'POST', { data }),
    publishDraft: (slug, draftId) =>
      transport.send(`${base}/${slug}/drafts/${encodeURIComponent(draftId)}/publish`, 'POST'),
    discardDraft: (slug, draftId) =>
      transport.send(`${base}/${slug}/drafts/${encodeURIComponent(draftId)}`, 'DELETE'),
    listRecycleBin: (entityType) =>
      readData(
        transport,
        entityType
          ? `${base}/recycle-bin?entityType=${encodeURIComponent(entityType)}`
          : `${base}/recycle-bin`,
      ),
    restoreEntry: (entryId) =>
      transport.send(`${base}/recycle-bin/${encodeURIComponent(entryId)}/restore`, 'POST'),
    purgeEntry: (entryId) =>
      transport.send(`${base}/recycle-bin/${encodeURIComponent(entryId)}`, 'DELETE'),
    listApprovals: (status) =>
      readData(transport, `${base}/approvals?status=${encodeURIComponent(status)}`),
    approveRequest: (requestId) =>
      transport.send(`${base}/approvals/${encodeURIComponent(requestId)}/approve`, 'POST'),
    rejectRequest: (requestId, note) =>
      transport.send(
        `${base}/approvals/${encodeURIComponent(requestId)}/reject`,
        'POST',
        note === undefined ? {} : { note },
      ),
  };
}
