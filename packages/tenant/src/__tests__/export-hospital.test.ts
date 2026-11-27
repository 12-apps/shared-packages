import { describe, expect, it } from 'vitest';

import { TENANT_COPY_SHAPE, type TenantCopyPack } from '../config';
import { createTenantExport, type TenantExportSection } from '../export';
import { createApiTenant } from '../server';
import { coreConfig } from './fixtures';
import { exportHost, exportRequest } from './export-fixtures';
import { readZip } from './export-zip-reader';

/**
 * A second host, end to end: a hospital with its own statuses, ids, copy
 * packs, sections and archive language. The same engine asks, builds,
 * tells, hands out, expires and erases its archive, and nothing on the way
 * reads a value of the clinic's (nor of the host the engine came from).
 */

type Ward = 'ADMITTING' | 'DISCHARGING' | 'DISCHARGED';

function hospitalPack(tag: string): TenantCopyPack {
  const pack = Object.fromEntries(
    Object.entries(TENANT_COPY_SHAPE).map(([key, kind]) => [key, kind === 'text' ? `${tag} ${key}` : () => `${tag} ${key}`]),
  ) as unknown as Record<string, unknown>;
  return {
    ...pack,
    noticeExportReadyTitle: (name: string) => `${name}: o seu ficheiro do hospital está pronto`,
    noticeExportReadyBody: (name: string, day: string) => `O ficheiro de ${name} fica disponível até ${day}.`,
    noticeExportFailedTitle: (name: string) => `${name}: não foi possível preparar o ficheiro`,
    noticeExportFailedBody: (name: string) => `Peça de novo o ficheiro de ${name}.`,
    refusalExportExpired: `${tag}: esta ligação expirou.`,
  } as unknown as TenantCopyPack;
}

function hospital() {
  const env = exportHost();
  const base = coreConfig();
  const wards: { id: string; slug: string; status: Ward; name: string }[] = [{ id: 'h-9', slug: 'sao-joao', status: 'ADMITTING', name: 'Hospital São João' }];
  const tenant = createApiTenant<Ward, { label: 'tx' }>({
    statuses: { all: ['ADMITTING', 'DISCHARGING', 'DISCHARGED'], active: 'ADMITTING', closing: 'DISCHARGING', closed: 'DISCHARGED', closableFrom: ['ADMITTING'] },
    ids: {
      refusals: Object.fromEntries(Object.keys(base.ids.refusals).map((kind) => [kind, `H_${kind.toUpperCase()}`])) as unknown as typeof base.ids.refusals,
      audit: Object.fromEntries(Object.keys(base.ids.audit).map((act) => [act, `hospital.${act}`])) as unknown as typeof base.ids.audit,
      notifications: { ...base.ids.notifications, exportReady: 'hospital.archive_ready' },
      permissions: { close: 'hospital:discharge' },
    },
    copy: { locales: { 'en-GB': hospitalPack('en-GB'), 'pt-BR': hospitalPack('pt-BR') }, defaultLocale: 'pt-BR' },
    port: {
      bySlug: async (slug) => wards.find((row) => row.slug === slug) ?? null,
      byId: async (id) => wards.find((row) => row.id === id) ?? null,
      setStatusIf: async () => false,
      clearProfile: async () => undefined,
      timeZone: async () => 'Europe/Lisbon',
    },
  });
  const sections: TenantExportSection[] = [
    { kind: 'file', name: 'plano-das-alas.txt', data: async () => 'Ala A\nAla B\n' },
    {
      kind: 'rows',
      name: (at) => (at.locale === 'pt-BR' ? 'internamentos.csv' : 'admissions.csv'),
      header: () => ['Utente', 'Entrada'],
      pages: async function* pages(at) {
        const day = new Intl.DateTimeFormat('pt-PT', { timeZone: at.timeZone }).format(at.now);
        yield [['Rui Sá', { raw: day }]];
      },
    },
    {
      kind: 'files',
      files: async function* files() {
        yield { name: 'exames/RX/1.dcm.txt', data: 'raio-x' };
      },
    },
  ];
  const made = createTenantExport(tenant, env.host.lifecycle, {
    ...env.config,
    sections,
    archiveLocale: () => 'pt-BR',
    copy: {
      locales: {
        'en-GB': { archiveFilename: (day) => `hospital-records-${day}.zip` },
        'pt-BR': { archiveFilename: (day) => `ficheiro-do-hospital-${day}.zip` },
      },
    },
    authorize: async (_request, at) => {
      env.log.push(`authorize:${at.slug}:${at.permission}`);
      return { tenantId: 'h-9', actorUserId: 'nurse-1' };
    },
  });
  const discharge = (): void => {
    for (const ward of wards) ward.status = 'DISCHARGED';
  };
  return { env, exporter: made, discharge };
}

const AT = new Date('2026-11-25T23:30:00.000Z');

describe('a hospital host, end to end', () => {
  it('asks, builds, tells, hands out, expires and erases its own archive', async () => {
    const { env, exporter, discharge } = hospital();
    const state = await exporter.request({ request: exportRequest(), slug: 'sao-joao', now: AT });
    expect(env.log).toContain('authorize:sao-joao:hospital:discharge');
    expect(env.audits).toEqual([{ action: 'hospital.exportRequested', event: { act: 'exportRequested', tenantId: 'h-9', exportId: state.id } }]);

    await expect(exporter.build(state.id, AT)).resolves.toBe('built');
    const key = `exports/h-9/${state.id}.zip`;
    const files = Object.fromEntries(readZip(new Uint8Array(env.objects.get(key) as Buffer)));
    // The tenant's clock (Lisbon): 23:30 UTC is still the 25th there.
    expect(files).toEqual({
      'plano-das-alas.txt': 'Ala A\nAla B\n',
      'internamentos.csv': '\ufeffUtente,Entrada\r\nRui Sá,25/11/2026\r\n',
      'exames/RX/1.dcm.txt': 'raio-x',
    });

    const [notice] = env.notices;
    expect(notice?.type).toBe('hospital.archive_ready');
    expect(notice?.payload).toMatchObject({ tenantId: 'h-9', name: 'Hospital São João', slug: 'sao-joao', requestedById: 'nurse-1', failed: false });
    expect(exporter.noticeWords(notice?.payload as never, { locale: 'pt-BR', timeZone: 'Europe/Lisbon' })).toEqual({
      title: 'Hospital São João: o seu ficheiro do hospital está pronto',
      body: 'O ficheiro de Hospital São João fica disponível até 02/12/2026.',
    });

    env.knobs.presign = 'stream';
    const response = await exporter.download({ request: exportRequest(), slug: 'sao-joao', exportId: state.id, now: AT });
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="ficheiro-do-hospital-2026-11-25.zip"');
    expect(env.audits.at(-1)).toEqual({ action: 'hospital.exportDownloaded', event: { act: 'exportDownloaded', tenantId: 'h-9', exportId: state.id } });

    const later = new Date('2026-12-03T00:00:00.000Z');
    await expect(exporter.download({ request: exportRequest(), slug: 'sao-joao', exportId: state.id, now: later })).rejects.toMatchObject({
      code: 'H_EXPORTEXPIRED',
      status: 410,
      message: 'pt-BR: esta ligação expirou.',
    });
    expect(await exporter.sweep(later)).toMatchObject({ deleted: 1 });
    expect(env.objects.has(key)).toBe(false);

    await exporter.beforeErase('h-9', { now: later });
    expect(env.rows.size).toBe(0);
    discharge();
    await expect(exporter.request({ request: exportRequest(), slug: 'sao-joao', now: later })).rejects.toMatchObject({ code: 'H_CLOSED' });
  });

  it('writes the failed notice in its own words', () => {
    const words = hospital().exporter.noticeWords;
    const payload = { tenantId: 'h-9', name: 'Hospital São João', slug: 'sao-joao', exportId: 'x', requestedById: 'nurse-1', expiresAt: null, failed: true };
    expect(words(payload, { locale: 'xx-XX', timeZone: 'Europe/Lisbon' })).toEqual({
      title: 'Hospital São João: não foi possível preparar o ficheiro',
      body: 'Peça de novo o ficheiro de Hospital São João.',
    });
  });
});
