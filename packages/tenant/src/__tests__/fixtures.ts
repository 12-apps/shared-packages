import { TENANT_COPY_SHAPE, type TenantCopyPack, type TenantCoreConfig } from '../config';
import type { TenantPort, TenantRecord } from '../port';
import type { TenantServerConfig } from '../server';

/**
 * A host that is NOT the one the package was extracted from: a clinic network
 * whose tenant row has five statuses, ids of its own and two locales. Every
 * suite builds on it, so nothing here can lean on a value the package might
 * have quietly assumed.
 */

type ClinicStatus = 'OPEN' | 'WINDING_DOWN' | 'SHUT' | 'ON_HOLD' | 'AWAITING_REVIEW';

/** A text key reads `<locale>: <key>.`; a sentence key echoes its arguments. */
function pack(prefix: string): TenantCopyPack {
  return Object.fromEntries(
    Object.entries(TENANT_COPY_SHAPE).map(([key, kind]) => [
      key,
      kind === 'text'
        ? `${prefix}: ${key}.`
        : (...args: unknown[]) => `${prefix}: ${key}(${args.join(', ')}).`,
    ]),
  ) as unknown as TenantCopyPack;
}

export function coreConfig(): TenantCoreConfig<ClinicStatus> {
  return {
    statuses: {
      all: ['OPEN', 'WINDING_DOWN', 'SHUT', 'ON_HOLD', 'AWAITING_REVIEW'],
      active: 'OPEN',
      closing: 'WINDING_DOWN',
      closed: 'SHUT',
      closableFrom: ['OPEN', 'ON_HOLD'],
    },
    ids: {
      refusals: {
        closing: 'CLINIC_WINDING_DOWN',
        closed: 'CLINIC_SHUT',
        readOnly: 'CLINIC_READ_ONLY',
        gone: 'CLINIC_GONE',
        reasonTooShort: 'CLINIC_REASON_TOO_SHORT',
        nameMismatch: 'CLINIC_NAME_MISMATCH',
        alreadyClosing: 'CLINIC_ALREADY_WINDING_DOWN',
        notActive: 'CLINIC_NOT_OPEN',
        closingBlocked: 'CLINIC_CLOSE_BLOCKED',
        purged: 'CLINIC_PURGED',
        notClosing: 'CLINIC_NOT_WINDING_DOWN',
        exportNeedsPerson: 'CLINIC_EXPORT_NEEDS_PERSON',
        exportNotFound: 'CLINIC_EXPORT_NOT_FOUND',
        exportExpired: 'CLINIC_EXPORT_EXPIRED',
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
        reopened: 'clinic.reopened',
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

/** The host's transaction client, as the fake port sees it. */
export interface FakeTx {
  label: string;
}

/** Every call the fake port received: its name and its arguments, the tx included. */
export type PortCall = readonly [string, ...unknown[]];

/**
 * A port over one in-memory row that records every call. `setStatusIf` is a
 * real compare-and-set: it moves the row only while it is in `from`.
 */
function fakePort(calls: PortCall[]): TenantPort<ClinicStatus, FakeTx> {
  const rows: TenantRecord<ClinicStatus>[] = [{ id: 't-1', slug: 'north', status: 'OPEN' }];
  return {
    bySlug: async (slug) => {
      calls.push(['bySlug', slug]);
      return rows.find((row) => row.slug === slug) ?? null;
    },
    byId: async (id, tx) => {
      calls.push(['byId', id, tx]);
      return rows.find((row) => row.id === id) ?? null;
    },
    setStatusIf: async (id, from, to, tx) => {
      calls.push(['setStatusIf', id, from, to, tx]);
      const row = rows.find((candidate) => candidate.id === id && candidate.status === from);
      if (row) row.status = to;
      return row !== undefined;
    },
    clearProfile: async (tx, id) => {
      calls.push(['clearProfile', tx, id]);
    },
    timeZone: async (id) => {
      calls.push(['timeZone', id]);
      return 'Europe/London';
    },
  };
}

export function serverConfig(calls: PortCall[] = []): TenantServerConfig<ClinicStatus, FakeTx> {
  return { ...coreConfig(), port: fakePort(calls) };
}

/**
 * A copy of `config` with the value at `keys` replaced, or left out for
 * `undefined`. Functions (the port's members) are kept as they are.
 */
export function withValue(config: unknown, keys: readonly string[], value: unknown): unknown {
  const [head, ...rest] = keys;
  if (head === undefined) return value;
  const bag = config as Record<string, unknown>;
  const entries = Object.entries(bag).filter(([key]) => !(key === head && rest.length === 0 && value === undefined));
  return Object.fromEntries(
    entries.map(([key, child]) => [key, key === head ? withValue(child, rest, value) : child]),
  );
}

/** Every leaf path of a plain object (arrays and functions count as leaves). */
export function leafPaths(value: unknown, prefix: string[] = []): string[][] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, [...prefix, key]));
}
