import type { EvidenceRecord, EvidenceRecordKind, HomologacaoEvidenceStore } from './types';

/** An in-memory {@link HomologacaoEvidenceStore} — tests and local demos only. */
export function createMemoryHomologacaoEvidenceStore(): HomologacaoEvidenceStore {
  const records = new Map<string, EvidenceRecord>();
  return {
    async latest(provider: string, kind: EvidenceRecordKind) {
      const matching = [...records.values()].filter((r) => r.provider === provider && r.kind === kind);
      matching.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return matching[0] ? structuredClone(matching[0]) : null;
    },
    async save(record: EvidenceRecord) {
      records.set(record.id, structuredClone(record));
      return structuredClone(record);
    },
  };
}
