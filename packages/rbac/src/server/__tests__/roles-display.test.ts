import { beforeEach, describe, expect, it } from 'vitest';

import { composePermissions } from '../../core/compose';
import { RBAC_PERMISSIONS } from '../../permissions';
import { createRoleDisplay } from '../role-display';

import { enrolMember } from './fake-db';
import { createTestHost, memberActor, type TestHost } from './server-fixtures';

/**
 * THE WORDS THE ROLES SCREEN IS READ IN (12-13 · FUT-1747).
 *
 * A seeded role is stored under a NAME and read as a sentence, and until this
 * existed the grid showed the name and the seeded description — so a pt-BR
 * store owner read `ADMIN` / `Administers a tenant…` on an otherwise Portuguese
 * screen, while the roster beside it had been translating the same role for
 * releases.
 *
 * These cases pin the three things that make the fix more than a lookup: the
 * rule about whose words win, the fact that the search box matches what the
 * reader can see, and the fact that the sort orders by it too. The last two are
 * what a naive fix misses — translate the column alone and a store owner types
 * the word in front of them and is told there is no such role.
 */

const TENANT = 'library-1';

/** The demo catalog, plus the role sentences this suite reads. */
function catalogWithDescriptions() {
  return composePermissions(RBAC_PERMISSIONS).withRoles({
    roles: [
      { name: 'CLERK', permissions: [] as const, description: 'Works the counter.' },
      { name: 'DIRECTOR', permissions: '*' as const, description: 'Everything.' },
    ],
    ownerRoles: ['DIRECTOR'],
    leafOnlyRoles: [],
    platformOnlyRoles: [],
    roleLabels: ({ locale }: { readonly locale?: string | null }) =>
      locale === 'en-US'
        ? { CLERK: 'Clerk', DIRECTOR: 'Director' }
        : { CLERK: 'Atendente de balcão', DIRECTOR: 'Direção' },
    roleDescriptions: ({ locale }: { readonly locale?: string | null }) =>
      locale === 'en-US'
        ? { CLERK: 'Works the counter.', DIRECTOR: 'Everything.' }
        : { CLERK: 'Trabalha no balcão.', DIRECTOR: 'Tudo.' },
  });
}

describe('whose words a role row is read in', () => {
  const catalog = catalogWithDescriptions();
  const seeds = catalog.tenantRoleSeeds;

  it('reads a seeded row in the reader language while it still says what the seed said', () => {
    const display = createRoleDisplay(catalog, seeds, 'pt-BR');
    expect(display({ name: 'CLERK', description: 'Works the counter.', kind: 'SYSTEM' })).toEqual({
      displayName: 'Atendente de balcão',
      displayDescription: 'Trabalha no balcão.',
    });
  });

  it('answers the same row in the other language', () => {
    const display = createRoleDisplay(catalog, seeds, 'en-US');
    expect(display({ name: 'CLERK', description: 'Works the counter.', kind: 'SYSTEM' })).toEqual({
      displayName: 'Clerk',
      displayDescription: 'Works the counter.',
    });
  });

  it('keeps a tenant OVERRIDE of a seeded description, in every language', () => {
    const row = { name: 'CLERK', description: 'Atende o caixa e o balcão.', kind: 'SYSTEM' };
    for (const locale of ['pt-BR', 'en-US']) {
      expect(createRoleDisplay(catalog, seeds, locale)(row).displayDescription).toBe(
        'Atende o caixa e o balcão.',
      );
    }
  });

  it('never touches a CUSTOM role — the tenant named it and wrote it', () => {
    const display = createRoleDisplay(catalog, seeds, 'pt-BR');
    expect(display({ name: 'Caixa', description: 'Operador de caixa', kind: 'CUSTOM' })).toEqual({
      displayName: 'Caixa',
      displayDescription: 'Operador de caixa',
    });
  });

  it('falls back to the raw pair for a seeded name the catalog has no words for', () => {
    const display = createRoleDisplay(catalog, seeds, 'pt-BR');
    expect(display({ name: 'LEGACY', description: 'Left over.', kind: 'SYSTEM' })).toEqual({
      displayName: 'LEGACY',
      displayDescription: 'Left over.',
    });
  });

  it('answers the catalog own words when nobody said which language', () => {
    const display = createRoleDisplay(catalog, seeds, undefined);
    // The resolver decides; this one answers pt-BR for anything but `en-US`,
    // which is how a host with one audience keeps exactly what it contributed.
    expect(display({ name: 'CLERK', description: 'Works the counter.', kind: 'SYSTEM' })).toEqual({
      displayName: 'Atendente de balcão',
      displayDescription: 'Trabalha no balcão.',
    });
  });
});

describe('the roles list, in the reader language', () => {
  let host: TestHost;

  beforeEach(async () => {
    host = createTestHost({ catalog: catalogWithDescriptions() });
    // The SYSTEM rows exactly as a real tenant gets them — the catalog's own
    // seed projection, descriptions included — then the tenant's own role.
    await host.api.seedTenantRoles(TENANT);
    await host.api.roles.createTenantRole(TENANT, {
      name: 'Caixa',
      description: 'Operador de caixa',
      permissions: [],
    });
    enrolMember(host.state, TENANT, 'director-1', 'DIRECTOR');
  });

  const list = (query: Record<string, unknown>, locale?: string) =>
    host.api.roles.listRolesPage(
      TENANT,
      { page: 1, pageSize: 20, ...query } as Parameters<
        typeof host.api.roles.listRolesPage
      >[1],
      locale,
    );

  it('carries the displayed pair beside the stored one, so a write still has its key', async () => {
    const page = await list({}, 'pt-BR');
    const clerk = page.data.find((role) => role.name === 'CLERK');
    expect(clerk).toMatchObject({
      name: 'CLERK',
      description: 'Works the counter.',
      displayName: 'Atendente de balcão',
      displayDescription: 'Trabalha no balcão.',
    });
  });

  it('finds a seeded role by the word on screen, in either language', async () => {
    const pt = await list({ q: 'Atendente' }, 'pt-BR');
    expect(pt.data.map((role) => role.name)).toEqual(['CLERK']);
    expect(pt.pagination.total).toBe(1);

    const en = await list({ q: 'Atendente' }, 'en-US');
    expect(en.data).toEqual([]);
    expect((await list({ q: 'Clerk' }, 'en-US')).data.map((role) => role.name)).toEqual(['CLERK']);
  });

  it('still finds a role by the name a wire caller knows it under', async () => {
    expect((await list({ q: 'CLERK' }, 'pt-BR')).data.map((role) => role.name)).toEqual(['CLERK']);
  });

  it('matches a seeded description in the reader language', async () => {
    expect((await list({ q: 'balcão' }, 'pt-BR')).data.map((role) => role.name)).toEqual(['CLERK']);
  });

  it('keeps a tenant override out of the translation, and finds it by its own words', async () => {
    await host.api.roles.upsertTemplateOverride(TENANT, 'CLERK', {
      description: 'Atende o caixa e o balcão desta loja.',
      permissions: [],
    });
    const page = await list({ q: 'desta loja' }, 'en-US');
    expect(page.data.map((role) => role.displayDescription)).toEqual([
      'Atende o caixa e o balcão desta loja.',
    ]);
  });

  it('orders by the displayed name, which is a different order per language', async () => {
    const pt = await list({ sort: { field: 'name', direction: 'asc' } }, 'pt-BR');
    // Atendente de balcão · Caixa · Direção
    expect(pt.data.map((role) => role.name)).toEqual(['CLERK', 'Caixa', 'DIRECTOR']);

    const en = await list({ sort: { field: 'name', direction: 'asc' } }, 'en-US');
    // Caixa · Clerk · Director — the tenant's own role sorts where its own name puts it.
    expect(en.data.map((role) => role.name)).toEqual(['Caixa', 'CLERK', 'DIRECTOR']);
  });

  it('reverses that order on desc, and leaves createdAt to the database', async () => {
    const desc = await list({ sort: { field: 'name', direction: 'desc' } }, 'pt-BR');
    expect(desc.data.map((role) => role.name)).toEqual(['DIRECTOR', 'Caixa', 'CLERK']);

    const byAge = await list({ sort: { field: 'createdAt', direction: 'asc' } }, 'pt-BR');
    expect(byAge.data.map((role) => role.name)).toEqual(['CLERK', 'DIRECTOR', 'Caixa']);
  });

  it('pages the reader order rather than the stored one', async () => {
    const first = await list({ pageSize: 2, sort: { field: 'name', direction: 'asc' } }, 'pt-BR');
    expect(first.data.map((role) => role.name)).toEqual(['CLERK', 'Caixa']);
    expect(first.pagination.total).toBe(3);

    const second = await list(
      { page: 2, pageSize: 2, sort: { field: 'name', direction: 'asc' } },
      'pt-BR',
    );
    expect(second.data.map((role) => role.name)).toEqual(['DIRECTOR']);
  });

  it('keeps the Tipo pill a database filter — it names a column, not a word', async () => {
    const custom = await list({ kindIn: ['CUSTOM'] }, 'pt-BR');
    expect(custom.data.map((role) => role.name)).toEqual(['Caixa']);
    expect(custom.pagination.total).toBe(1);
  });

  it('answers the endpoint with the same words the store resolved', async () => {
    const response = await host.api.routes
      .find((route) => route.method === 'GET' && route.path === '/roles')!
      .handle({
        actor: memberActor(TENANT, 'director-1'),
        params: {},
        query: { q: 'Atendente' },
        locale: 'pt-BR',
      });
    expect(response.status).toBe(200);
    const body = response.body as { data: { displayName: string }[] };
    expect(body.data.map((role) => role.displayName)).toEqual(['Atendente de balcão']);
  });
});
