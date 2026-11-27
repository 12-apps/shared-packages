/**
 * Tell the person who asked how their archive went: the link when it is
 * READY, and that it could not be made when it FAILED, through the host's
 * `notify` (inbox and e-mail are the host's). Stamped `notified_at` only once
 * the notice was RECORDED, so the sweep sends a lost one again. A `notify`
 * that throws is reported to `onError` and counts as not recorded.
 */
import type { ExportEngine } from './engine';
import type { TenantDataExportRow, TenantExportNoticePayload } from './types';

export async function tellRequester<S extends string, Tx>(
  engine: ExportEngine<S, Tx>,
  row: Pick<TenantDataExportRow, 'id' | 'tenantId' | 'requestedById' | 'expiresAt'>,
  failed: boolean,
): Promise<void> {
  const record = await engine.tenant.byId(row.tenantId);
  if (record === null || (!failed && row.expiresAt === null)) return;
  const payload: TenantExportNoticePayload = {
    tenantId: row.tenantId,
    name: record.name ?? record.slug,
    slug: record.slug,
    exportId: row.id,
    requestedById: row.requestedById,
    expiresAt: failed ? null : (row.expiresAt?.toISOString() ?? null),
    failed,
  };
  let told = false;
  try {
    told = await engine.config.notify(engine.tenant.config.ids.notifications.exportReady, payload);
  } catch (error) {
    engine.lifecycle.onError(error, { act: 'exportNotify', tenantId: row.tenantId });
  }
  if (told) await engine.write(row.id, { notifiedAt: null }, { notifiedAt: new Date() });
}

/** The notice's title and body, in `locale` (else the default pack), the expiry day formatted in `timeZone`. */
export function noticeWords<S extends string, Tx>(
  engine: ExportEngine<S, Tx>,
  payload: TenantExportNoticePayload,
  at: { locale: string | null; timeZone: string },
): { title: string; body: string } {
  const { locales, defaultLocale } = engine.tenant.config.copy;
  const tag = at.locale !== null && Object.hasOwn(locales, at.locale) ? at.locale : defaultLocale;
  const copy = engine.tenant.copyFor(tag);
  if (payload.failed || payload.expiresAt === null) {
    return { title: copy.noticeExportFailedTitle(payload.name), body: copy.noticeExportFailedBody(payload.name) };
  }
  const day = new Intl.DateTimeFormat(tag, { timeZone: at.timeZone }).format(new Date(payload.expiresAt));
  return { title: copy.noticeExportReadyTitle(payload.name), body: copy.noticeExportReadyBody(payload.name, day) };
}
