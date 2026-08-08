import { describe, expect, it } from 'vitest';

import {
  createHomologationRecordService,
  createMemoryHomologationRecordStore,
} from '../platform/homologacao-record';

/**
 * The homologação outcome record (FUT-483, packaged by FUT-573). What matters
 * is the DERIVED timestamps — the part every host must agree on:
 *
 *  - `submittedAt` is first-submission time and survives every later save;
 *  - `decidedAt` stamps a verdict, holds while the verdict stands, and clears
 *    when the operator moves the record back to SUBMITTED (a re-submission);
 *  - blank form strings normalize to null, so "" never masquerades as data.
 */

function service(times: string[]) {
  const store = createMemoryHomologationRecordStore();
  const queue = [...times];
  const clock = () => new Date(queue.shift() ?? '2026-12-31T00:00:00Z');
  return { svc: createHomologationRecordService(store, clock), store };
}

describe('createHomologationRecordService', () => {
  it('reads null while nothing was recorded — the honest "não solicitada"', async () => {
    const { svc } = service([]);

    await expect(svc.read('pagbank')).resolves.toBeNull();
  });

  it('stamps submittedAt on the first SUBMITTED save', async () => {
    const { svc } = service(['2026-08-01T10:00:00Z']);

    const record = await svc.save('pagbank', { status: 'SUBMITTED' }, 'ops@example.com');

    expect(record.submittedAt?.toISOString()).toBe('2026-08-01T10:00:00.000Z');
    expect(record.decidedAt).toBeNull();
    expect(record.updatedBy).toBe('ops@example.com');
  });

  it('keeps submittedAt when the verdict lands later', async () => {
    const { svc } = service(['2026-08-01T10:00:00Z', '2026-08-05T09:00:00Z']);
    await svc.save('pagbank', { status: 'SUBMITTED' }, 'ops@example.com');

    const record = await svc.save('pagbank', { status: 'APPROVED' }, 'ops@example.com');

    // Recording the verdict must not erase when the form went in.
    expect(record.submittedAt?.toISOString()).toBe('2026-08-01T10:00:00.000Z');
    expect(record.decidedAt?.toISOString()).toBe('2026-08-05T09:00:00.000Z');
  });

  it('keeps decidedAt while the same verdict is re-saved', async () => {
    const { svc } = service([
      '2026-08-01T10:00:00Z',
      '2026-08-05T09:00:00Z',
      '2026-08-06T12:00:00Z',
    ]);
    await svc.save('pagbank', { status: 'SUBMITTED' }, 'ops@example.com');
    await svc.save('pagbank', { status: 'REJECTED' }, 'ops@example.com');

    const record = await svc.save(
      'pagbank',
      { status: 'REJECTED', notes: 'faltou anexo' },
      'ops@example.com',
    );

    expect(record.decidedAt?.toISOString()).toBe('2026-08-05T09:00:00.000Z');
    expect(record.notes).toBe('faltou anexo');
  });

  it('clears decidedAt when the record moves back to SUBMITTED', async () => {
    // A re-submission after a refusal: the old verdict no longer stands.
    const { svc } = service([
      '2026-08-01T10:00:00Z',
      '2026-08-05T09:00:00Z',
      '2026-08-10T08:00:00Z',
    ]);
    await svc.save('pagbank', { status: 'SUBMITTED' }, 'ops@example.com');
    await svc.save('pagbank', { status: 'REJECTED' }, 'ops@example.com');

    const record = await svc.save('pagbank', { status: 'SUBMITTED' }, 'ops@example.com');

    expect(record.decidedAt).toBeNull();
    expect(record.submittedAt?.toISOString()).toBe('2026-08-01T10:00:00.000Z');
  });

  it('never lets a verdict-first record invent a submission time', async () => {
    // An operator may record an APPROVED outcome for a submission made before
    // the screen existed; the unknown submission time stays honest.
    const { svc } = service(['2026-08-05T09:00:00Z']);

    const record = await svc.save('pagbank', { status: 'APPROVED' }, 'ops@example.com');

    expect(record.submittedAt).toBeNull();
    expect(record.decidedAt?.toISOString()).toBe('2026-08-05T09:00:00.000Z');
  });

  it('normalizes blank strings to null and persists through the store', async () => {
    const { svc, store } = service(['2026-08-01T10:00:00Z']);

    await svc.save('pagbank', { status: 'SUBMITTED', protocol: '  ', notes: '' }, 'ops@x.com');

    const stored = await store.get('pagbank');
    expect(stored?.protocol).toBeNull();
    expect(stored?.notes).toBeNull();
    expect(stored?.updatedAt.toISOString()).toBe('2026-08-01T10:00:00.000Z');
  });
});
