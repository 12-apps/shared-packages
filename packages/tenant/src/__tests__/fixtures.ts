import { TENANT_COPY_KEYS, type TenantCopyPack, type TenantCoreConfig } from '../config';
import type { TenantPort, TenantRecord } from '../port';
import type { TenantServerConfig } from '../server';

/**
 * A host that is NOT the one the package was extracted from: a clinic network
 * whose tenant row has five statuses, ids of its own and two locales. Every
 * suite builds on it, so nothing here can lean on a value the package might
 * have quietly assumed.
 */

export type ClinicStatus = 'OPEN' | 'WINDING_DOWN' | 'SHUT' | 'ON_HOLD' | 'AWAITING_REVIEW';

function pack(prefix: string): TenantCopyPack {
  return Object.fromEntries(
    TENANT_COPY_KEYS.map((key) => [key, `${prefix}: ${key} sentence.`]),
  ) as TenantCopyPack;
}

export function coreConfig(): TenantCoreConfig<ClinicStatus> {
  return {
    statuses: {
      all: ['OPEN', 'WINDING_DOWN', 'SHUT', 'ON_HOLD', 'AWAITING_REVIEW'],
      active: 'OPEN',
      closing: 'WINDING_DOWN',
      closed: 'SHUT',
    },
    ids: {
      refusals: {
        closing: 'CLINIC_WINDING_DOWN',
        closed: 'CLINIC_SHUT',
        readOnly: 'CLINIC_READ_ONLY',
        gone: 'CLINIC_GONE',
      },
      audit: {
        closeScheduled: 'clinic_close.scheduled',
        closeReopened: 'clinic_close.reopened',
        closePurged: 'clinic_close.purged',
        afterCloseFailed: 'clinic_close.after_close_failed',
        exportRequested: 'clinic_close.export_requested',
        exportDownloaded: 'clinic_close.export_downloaded',
      },
      notifications: {
        closingScheduled: 'clinic.closing_scheduled',
        closingWeek: 'clinic.closing_week',
        closingDay: 'clinic.closing_day',
        exportReady: 'clinic.export_ready',
      },
      permissions: { close: 'clinic:close' },
    },
    copy: {
      locales: { 'en-GB': pack('en-GB'), 'pt-BR': pack('pt-BR') },
      defaultLocale: 'en-GB',
    },
  };
}

const TENANTS: TenantRecord<ClinicStatus>[] = [{ id: 't-1', slug: 'north', status: 'OPEN' }];

export function fakePort(): TenantPort<ClinicStatus, { label: string }> {
  return {
    bySlug: async (slug) => TENANTS.find((row) => row.slug === slug) ?? null,
    byId: async (id) => TENANTS.find((row) => row.id === id) ?? null,
    setStatusIf: async () => false,
    clearProfile: async () => undefined,
    timeZone: async () => 'Europe/London',
  };
}

export function serverConfig(): TenantServerConfig<ClinicStatus, { label: string }> {
  return { ...coreConfig(), port: fakePort() };
}

/** A deep copy with the value at `path` replaced (or deleted, for `undefined`). */
export function withValue(config: object, path: readonly string[], value: unknown): unknown {
  const copy = structuredClone(
    Object.fromEntries(Object.entries(config).filter(([key]) => key !== 'port')),
  ) as Record<string, unknown>;
  if ('port' in config) copy.port = { ...(config as { port: object }).port };
  let cursor = copy;
  for (const key of path.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
  const last = path[path.length - 1] as string;
  if (value === undefined) delete cursor[last];
  else cursor[last] = value;
  return copy;
}

/** Every leaf path of a plain object (arrays and functions count as leaves). */
export function leafPaths(value: unknown, prefix: string[] = []): string[][] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, [...prefix, key]));
}
