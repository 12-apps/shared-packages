import type { MerchantRef } from '../../core/types';
import type {
  EvidenceChargeRow,
  EvidenceRecord,
  EvidenceWebhookEvent,
  HomologacaoEvidenceStore,
} from './types';

/**
 * Prisma adapters for the homologação evidence (FUT-3696), duck-typed on the
 * delegates like every other Prisma store in this package — it must never
 * import a generated client. The host passes `prisma.<model>`, cast to these
 * structural interfaces where it builds the service.
 */

interface EvidenceRow {
  id: string;
  provider: string;
  kind: string;
  steps: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/** The host's evidence table: `id`, `provider`, `kind`, `steps` (JSON), timestamps. */
export interface EvidenceDelegate {
  findFirst(args: {
    where: { provider: string; kind: string };
    orderBy: { createdAt: 'desc' };
  }): Promise<EvidenceRow | null>;
  upsert(args: {
    where: { id: string };
    create: { id: string; provider: string; kind: string; steps: unknown; createdAt: Date };
    update: { provider: string; kind: string; steps: unknown };
  }): Promise<EvidenceRow>;
}

/** The webhook inbox, as much of it as the evidence reads. */
export interface EvidenceWebhookDelegate {
  findMany(args: {
    where: {
      merchantKind: string;
      merchantId: string;
      provider: string;
      OR: { payload: { contains: string } }[];
    };
    orderBy: { receivedAt: 'asc' };
  }): Promise<{ receivedAt: Date; processedAt: Date | null; status: string; payload: string }[]>;
}

/** The charge table, as much of it as the evidence reads. */
export interface EvidenceChargeDelegate {
  findFirst(args: {
    where: { merchantKind: string; merchantId: string; providerChargeId: { in: string[] } };
    orderBy: { updatedAt: 'desc' };
    select: { providerChargeId: true; status: true; updatedAt: true };
  }): Promise<EvidenceChargeRow | null>;
}

function toRecord(row: EvidenceRow): EvidenceRecord {
  return {
    id: row.id,
    provider: row.provider,
    kind: row.kind as EvidenceRecord['kind'],
    steps: row.steps as EvidenceRecord['steps'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPrismaHomologacaoEvidenceStore(delegate: EvidenceDelegate): HomologacaoEvidenceStore {
  return {
    async latest(provider, kind) {
      const row = await delegate.findFirst({ where: { provider, kind }, orderBy: { createdAt: 'desc' } });
      return row ? toRecord(row) : null;
    },
    async save(record) {
      const fields = { provider: record.provider, kind: record.kind, steps: record.steps };
      const row = await delegate.upsert({
        where: { id: record.id },
        create: { id: record.id, ...fields, createdAt: new Date(record.createdAt) },
        update: fields,
      });
      return toRecord(row);
    },
  };
}

function parsed(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

/** Deliveries for `merchant` whose raw payload names any of the ids. */
export function prismaEvidenceWebhooks(
  delegate: EvidenceWebhookDelegate,
  merchant: MerchantRef,
  provider: string,
): (ids: readonly string[]) => Promise<EvidenceWebhookEvent[]> {
  return async (ids) => {
    const rows = await delegate.findMany({
      where: {
        merchantKind: merchant.kind,
        merchantId: merchant.id,
        provider,
        OR: ids.map((id) => ({ payload: { contains: id } })),
      },
      orderBy: { receivedAt: 'asc' },
    });
    return rows.map((row) => ({ ...row, payload: parsed(row.payload) }));
  };
}

/** The newest charge row for `merchant` under any of the ids. */
export function prismaEvidenceCharge(
  delegate: EvidenceChargeDelegate,
  merchant: MerchantRef,
): (ids: readonly string[]) => Promise<EvidenceChargeRow | null> {
  return (ids) =>
    delegate.findFirst({
      where: { merchantKind: merchant.kind, merchantId: merchant.id, providerChargeId: { in: [...ids] } },
      orderBy: { updatedAt: 'desc' },
      select: { providerChargeId: true, status: true, updatedAt: true },
    });
}
