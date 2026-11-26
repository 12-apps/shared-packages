/**
 * The kept memory's startup validation: every option is required (but the
 * database), and a missing or bad one throws naming `memory.<key>`.
 */
import { TenantConfigError } from '../validate';
import type { KeptMemoryOptions } from './memory';

const CHANNEL = /^[a-z_][a-z0-9_]*$/u;

function requireFunction(value: unknown, key: string): void {
  if (value === undefined || value === null) throw new TenantConfigError(key, 'is required and missing');
  if (typeof value !== 'function') throw new TenantConfigError(key, 'must be a function');
}

function requireCount(value: unknown, key: string): void {
  if (value === undefined || value === null) throw new TenantConfigError(key, 'is required and missing');
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TenantConfigError(key, 'must be a positive integer');
  }
}

function requireChannel(channel: unknown): void {
  if (channel === undefined || channel === null) throw new TenantConfigError('memory.channel', 'is required and missing');
  if (typeof channel !== 'string' || !CHANNEL.test(channel)) {
    throw new TenantConfigError('memory.channel', 'must be a lower-case identifier (/^[a-z_][a-z0-9_]*$/)');
  }
}

/** Validate the memory's options. Throws {@link TenantConfigError} naming `memory.<key>`. */
export function validateKeptMemoryOptions(options: unknown): asserts options is KeptMemoryOptions {
  if (options === undefined || options === null) throw new TenantConfigError('memory', 'is required and missing');
  if (typeof options !== 'object' || Array.isArray(options)) throw new TenantConfigError('memory', 'must be an object');
  const bag = options as Record<string, unknown>;
  requireChannel(bag.channel);
  requireFunction(bag.listen, 'memory.listen');
  requireFunction(bag.onError, 'memory.onError');
  for (const key of ['backstopMs', 'retryMs', 'maxScopes', 'maxSlots'] as const) requireCount(bag[key], `memory.${key}`);
  if (bag.database !== undefined) requireFunction(bag.database, 'memory.database');
}
