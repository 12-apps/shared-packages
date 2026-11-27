import { describe, expect, it } from 'vitest';

import { TenantExportRefusal } from '../export';
import { exportHost, exportRequest, exportRow } from './export-fixtures';

/**
 * The request and the download (ported from the host's requests suite and its
 * two route suites): the session check first, one row and one audit line per
 * export, the running one answered to a second press, 404 and 410, and every
 * hand-out audited.
 */

const AT_ISO = '2026-11-25T12:00:00.000Z';
const at = (): Date => new Date(AT_ISO);
const get = (exportId = 'e1') => ({
  request: new Request(`https://host.test/x/${exportId}`),
  slug: 'north',
  exportId,
  now: new Date('2026-11-25T12:00:00.000Z'),
});

describe('request', () => {
  it('records the request with its audit line, then queues ONE build for it', async () => {
    const env = exportHost();
    const state = await env.build().request({ request: exportRequest(), slug: 'north', now: at() });
    expect(state).toMatchObject({ status: 'PREPARING', requestedAt: AT_ISO });
    expect(env.log[0]).toBe('authorize:north:clinic:close');
    expect(env.rows.get(state.id)).toMatchObject({ tenantId: 't-1', requestedById: 'user-1', status: 'PREPARING' });
    expect(env.legacy.get(state.id)).toEqual(env.rows.get(state.id));
    expect(env.audits).toEqual([{ action: 'clinic_close.export_requested', event: { act: 'exportRequested', tenantId: 't-1', exportId: state.id } }]);
    expect(env.queued).toEqual([{ exportId: state.id, why: { source: 'request' } }]);
  });

  it('answers the running export to a second press, and starts no second job', async () => {
    const env = exportHost();
    env.rows.set('running', exportRow({ id: 'running', requestedAt: new Date('2026-11-25T11:58:00.000Z') }));
    const state = await env.build().request({ request: exportRequest(), slug: 'north', now: at() });
    expect(state).toEqual({ id: 'running', status: 'PREPARING', requestedAt: '2026-11-25T11:58:00.000Z' });
    expect(env.queued).toEqual([]);
    expect(env.audits).toEqual([]);
  });

  it('asks again only once when the running export finished between the insert and the read', async () => {
    const env = exportHost();
    const taken = new Error('taken');
    const creates: string[] = [];
    const engine = env.build({
      db: {
        ...env.config.db,
        isUniqueViolation: (error) => error === taken,
        table: () => ({
          ...env.table,
          create: async ({ data }) => {
            creates.push(data.id);
            throw taken;
          },
          findFirst: async () => null,
        }),
      },
    });
    await expect(engine.request({ request: exportRequest(), slug: 'north', now: at() })).rejects.toBe(taken);
    expect(creates).toHaveLength(2);
  });

  it('refuses an account with no person behind it: nobody to mail the link to', async () => {
    const env = exportHost();
    env.knobs.actor.actorUserId = null;
    const refusal = await env
      .build()
      .request({ request: exportRequest(), slug: 'north', now: at() })
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(TenantExportRefusal);
    expect(refusal).toMatchObject({ kind: 'exportNeedsPerson', status: 403, code: 'CLINIC_EXPORT_NEEDS_PERSON', message: 'en-GB: refusalExportNeedsPerson.' });
    expect(env.rows.size).toBe(0);
  });

  it('refuses without the permission, and once the tenant is closed', async () => {
    const env = exportHost();
    const denied = new Error('401');
    env.knobs.authorizeRefuses = denied;
    await expect(env.build().request({ request: exportRequest(), slug: 'north', now: at() })).rejects.toBe(denied);
    env.knobs.authorizeRefuses = null;
    const shut = env.host.tenantOf('t-1');
    if (shut) shut.status = 'SHUT';
    await expect(env.build().request({ request: exportRequest(), slug: 'north', now: at() })).rejects.toMatchObject({ code: 'CLINIC_SHUT', status: 403 });
    expect(env.rows.size).toBe(0);
  });
});

describe('expiryOf', () => {
  it('gives the link linkDays, never past the tenant purge', () => {
    const engine = exportHost().build();
    expect(engine.expiryOf(at(), null).toISOString()).toBe('2026-12-02T12:00:00.000Z');
    const purge = new Date('2026-11-28T00:00:00.000Z');
    expect(engine.expiryOf(at(), purge)).toBe(purge);
  });
});

describe('download', () => {
  const ready = () => exportRow({ status: 'READY', storageKey: 'exports/t-1/e1.zip', expiresAt: new Date('2026-12-01T00:00:00.000Z') });

  it('redirects a holder of the permission to a short-lived presigned link, and audits it once', async () => {
    const env = exportHost();
    env.rows.set('e1', ready());
    env.objects.set('exports/t-1/e1.zip', Buffer.from('PK'));
    const response = await env.build().download(get());
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://bucket.test/exports/t-1/e1.zip?sig=1');
    expect(response.headers.get('cache-control')).toBe(['no', 'st' + 'ore'].join('-'));
    expect(env.log).toContain('presign:exports/t-1/e1.zip:clinic-data-2026-11-25.zip');
    expect(env.audits).toEqual([{ action: 'clinic_close.export_downloaded', event: { act: 'exportDownloaded', tenantId: 't-1', exportId: 'e1' } }]);
  });

  it('hands the archive itself as a download where the port streams it (local disk)', async () => {
    const env = exportHost();
    env.rows.set('e1', ready());
    env.objects.set('exports/t-1/e1.zip', Buffer.from([0x50, 0x4b]));
    env.knobs.presign = 'stream';
    const response = await env.build({ archiveLocale: () => 'pt-BR' }).download(get());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="dados-da-clinica-2026-11-25.zip"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0x50, 0x4b]));
  });

  it('refuses one still preparing, another tenant one, and an expired one', async () => {
    const env = exportHost();
    const engine = env.build();
    env.rows.set('e1', exportRow());
    await expect(engine.download(get())).rejects.toMatchObject({ kind: 'exportNotFound', status: 404, code: 'CLINIC_EXPORT_NOT_FOUND' });
    env.rows.set('e1', { ...ready(), tenantId: 't-2' });
    await expect(engine.download(get())).rejects.toMatchObject({ kind: 'exportNotFound' });
    env.rows.set('e1', { ...ready(), expiresAt: new Date('2026-11-25T11:00:00.000Z') });
    await expect(engine.download(get())).rejects.toMatchObject({ kind: 'exportExpired', status: 410, code: 'CLINIC_EXPORT_EXPIRED' });
    env.rows.set('e1', { ...ready(), deletedAt: at() });
    await expect(engine.download(get())).rejects.toMatchObject({ kind: 'exportExpired' });
    expect(env.log.filter((line) => line.startsWith('presign'))).toEqual([]);
    expect(env.audits).toEqual([]);
  });

  it('answers 410 when the archive is gone from storage, auditing nothing', async () => {
    const env = exportHost();
    env.rows.set('e1', ready());
    await expect(env.build().download(get())).rejects.toMatchObject({ kind: 'exportExpired', status: 410 });
    expect(env.audits).toEqual([]);
  });

  it('opens nothing without the permission, nor once the tenant is closed', async () => {
    const env = exportHost();
    env.rows.set('e1', ready());
    env.objects.set('exports/t-1/e1.zip', Buffer.from('PK'));
    const denied = new Error('401');
    env.knobs.authorizeRefuses = denied;
    await expect(env.build().download(get())).rejects.toBe(denied);
    env.knobs.authorizeRefuses = null;
    const shut = env.host.tenantOf('t-1');
    if (shut) shut.status = 'SHUT';
    await expect(env.build().download(get())).rejects.toMatchObject({ kind: 'closed', status: 403 });
    expect(env.log.filter((line) => line.startsWith('presign'))).toEqual([]);
  });
});
