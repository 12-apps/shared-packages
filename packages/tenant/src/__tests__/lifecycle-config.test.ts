import { describe, expect, it } from 'vitest';

import { TENANT_COPY_KEYS } from '../config';
import { TenantConfigError } from '../index';
import { createApiTenant } from '../server';
import { withValue } from './fixtures';
import { lifecycleHost } from './lifecycle-fixtures';

/**
 * The lifecycle is OPT-IN and validated at startup: no key falls back to a
 * value of somebody else's, and every bad one is named.
 */

function keyOf(config: unknown): string {
  try {
    createApiTenant(config as never);
  } catch (error) {
    if (error instanceof TenantConfigError) return error.key;
    throw error;
  }
  return 'none';
}

function hostConfig(tree = false) {
  const host = lifecycleHost(tree ? { tree: [{ id: 't-1', parentId: null, path: '/t-1/' }] } : {});
  return { ...host.config, lifecycle: host.lifecycle };
}

describe('a host with no lifecycle', () => {
  it('boots, and has no tenant.lifecycle', () => {
    const tenant = createApiTenant(withValue(hostConfig(), ['lifecycle'], undefined) as never);
    expect('lifecycle' in tenant).toBe(false);
  });

  it('keeps the base copy pack as it was: the platform sentences are the lifecycle extension', () => {
    expect(TENANT_COPY_KEYS).not.toContain('noticePlatformScheduledTitle');
  });
});

describe('a host with a lifecycle', () => {
  it('boots with a full config', () => {
    expect(createApiTenant(hostConfig()).lifecycle).toBeDefined();
    expect(keyOf(hostConfig(true))).toBe('none');
  });

  it.each([
    [['graceDays'], undefined, 'lifecycle.graceDays'],
    [['graceDays'], 1.5, 'lifecycle.graceDays'],
    [['reminderDays', 'week'], 30, 'lifecycle.reminderDays.week'],
    [['reminderDays', 'day'], 7, 'lifecycle.reminderDays.day'],
    [['reminderDays', 'day'], 0, 'lifecycle.reminderDays.day'],
    [['minReasonLength'], -1, 'lifecycle.minReasonLength'],
    [['nameLocale'], 'pt_br', 'lifecycle.nameLocale'],
    [['sweepBatch'], undefined, 'lifecycle.sweepBatch'],
    [['copy', 'locales', 'pt-BR'], undefined, 'lifecycle.copy.locales.pt-BR'],
    [['copy', 'locales', 'en-GB', 'noticePlatformScheduledBody'], 'text', 'lifecycle.copy.locales.en-GB.noticePlatformScheduledBody'],
    [['db', 'transaction'], undefined, 'lifecycle.db.transaction'],
    [['db', 'table'], 1, 'lifecycle.db.table'],
    [['blockers', 'kinds'], undefined, 'lifecycle.blockers.kinds'],
    [['blockers', 'kinds'], [{ kind: 'a', path: 'x' }, { kind: 'a', path: 'y' }], 'lifecycle.blockers.kinds[1].kind'],
    [['blockers', 'kinds'], [{ kind: 'a' }], 'lifecycle.blockers.kinds[0].path'],
    [['blockers', 'read'], undefined, 'lifecycle.blockers.read'],
    [['confirmDangerousAct'], undefined, 'lifecycle.confirmDangerousAct'],
    [['afterClose'], undefined, 'lifecycle.afterClose'],
    [['invalidate'], undefined, 'lifecycle.invalidate'],
    [['notify'], undefined, 'lifecycle.notify'],
    [['onPurgeDue'], undefined, 'lifecycle.onPurgeDue'],
    [['audit'], undefined, 'lifecycle.audit'],
    [['locale'], undefined, 'lifecycle.locale'],
    [['onError'], undefined, 'lifecycle.onError'],
    [['mirror', 'event'], undefined, 'lifecycle.mirror.event'],
  ] as const)('names %j when it is %j', (keys, value, key) => {
    expect(keyOf(withValue(hostConfig(), ['lifecycle', ...keys], value))).toBe(key);
  });

  it('refuses the open-descendants blocker with no tree', () => {
    const config = hostConfig();
    expect(keyOf({ ...config, lifecycle: { ...config.lifecycle, openDescendants: { kind: 'units', path: 'units' } } })).toBe(
      'lifecycle.openDescendants',
    );
  });

  it('requires the open-descendants blocker with a tree, and refuses it repeating a host kind', () => {
    expect(keyOf(withValue(hostConfig(true), ['lifecycle', 'openDescendants'], undefined))).toBe('lifecycle.openDescendants');
    expect(keyOf(withValue(hostConfig(true), ['lifecycle', 'openDescendants'], { kind: 'patients', path: 'p' }))).toBe(
      'lifecycle.openDescendants.kind',
    );
  });

  it('takes no mirror at all', () => {
    expect(keyOf(withValue(hostConfig(), ['lifecycle', 'mirror'], undefined))).toBe('none');
  });

  it.each([null, 'lifecycle'])('refuses %j as the lifecycle', (value) => {
    expect(keyOf({ ...hostConfig(), lifecycle: value })).toBe('lifecycle');
  });
});
