// @vitest-environment jsdom
/**
 * THE LOCALE AXIS ON THE PERMISSION LABEL VOCABULARY.
 *
 * `messages` on the server config took a resolver a while ago; the words beside
 * it — the ones a picker and a roster actually render — did not, so no host
 * could make them follow anyone. This is what the widening has to keep true,
 * and why each property is worth a case:
 *
 *  - **A plain vocabulary still works**, with no locale anywhere. The
 *    single-audience host pays nothing for this axis existing.
 *  - **The choice happens where a label is READ, not where the catalog is
 *    composed.** That is the property that separates this change from the
 *    entitlements one it follows: a host's `CATALOG` is a module-scope
 *    singleton its API and its screens share, so composing IS boot.
 *  - **The ids and the specs never move.** A vocabulary that translated
 *    `titles:write` — or flipped a `kind` — would change what the entity gate
 *    does rather than what a picker reads.
 *  - **Absent stays absent.** No locale means "nobody said", never pt-BR.
 */
import { render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { composePermissions, labelsOf } from '../core/compose';
import { definePermissionContribution } from '../core/contribution';
import { createWebRbac } from '../react/create-web-rbac';
import { createRbacLabels } from '../react/labels';
import { PT_BR_RBAC_WEB_COPY } from '../react/pt-BR';
import { RBAC_PERMISSIONS } from '../permissions';

/** The demo library's own domain, in both of the languages it serves. */
const PT_BR_SHELVES = {
  domains: { shelves: 'Prateleiras' },
  actions: { reshelve: 'Recolocar' },
  scopes: { own: 'suas' },
};

const EN_US_SHELVES = {
  domains: { shelves: 'Shelves' },
  actions: { reshelve: 'Reshelve' },
  scopes: { own: 'your own' },
};

const SHELVES_PACK = { 'pt-BR': PT_BR_SHELVES, 'en-US': EN_US_SHELVES } as const;

/**
 * What a bilingual host writes, spelled out rather than imported.
 *
 * This is `localeCopy` from `@12-apps/i18n`, which this package cannot depend
 * on — so the suite states the shape the mirror has to accept instead of
 * asserting against the real thing.
 */
function hostLocaleCopy<T>(pack: { readonly 'pt-BR': T; readonly 'en-US': T }) {
  return ({ locale }: { readonly locale?: string | null }): T =>
    locale === 'en-US' ? pack['en-US'] : pack['pt-BR'];
}

const SHELVES = definePermissionContribution({
  source: 'demo-host',
  permissions: {
    'shelves:reshelve:own': { kind: 'instance' },
    'shelves:audit': { kind: 'class', label: 'Conferência de prateleira' },
  },
  labels: hostLocaleCopy(SHELVES_PACK),
});

const PLAIN = definePermissionContribution({
  source: 'demo-plain',
  permissions: { 'boxes:move': { kind: 'class' } },
  labels: { domains: { boxes: 'Caixas' }, actions: { move: 'Movimentar' } },
});

/**
 * Annotated rather than `as const`: without it the generic infers the pack's
 * type from the pt-BR half and the English half stops being assignable, which
 * is a fixture problem and not a contract one.
 */
const ROLE_LABELS_PACK: { readonly 'pt-BR': RoleLabels; readonly 'en-US': RoleLabels } = {
  'pt-BR': { CLERK: 'Atendente de balcão' },
  'en-US': { CLERK: 'Counter clerk' },
};

type RoleLabels = Readonly<Record<string, string>>;

function catalog() {
  return composePermissions(RBAC_PERMISSIONS, SHELVES, PLAIN).withRoles({
    roles: [{ name: 'CLERK', permissions: ['boxes:move'] as const, description: 'Counter.' }],
    ownerRoles: [],
    leafOnlyRoles: [],
    platformOnlyRoles: [],
    roleLabels: hostLocaleCopy(ROLE_LABELS_PACK),
  });
}

describe('the vocabulary a catalog composes', () => {
  it('still merges a plain contribution, unchanged', () => {
    const labels = labelsOf(catalog());
    expect(labels.domains).toMatchObject({ boxes: 'Caixas' });
    expect(labels.actions).toMatchObject({ move: 'Movimentar' });
  });

  it('answers each source in the language it is asked for', () => {
    expect(labelsOf(catalog(), 'en-US').domains).toMatchObject({
      shelves: 'Shelves',
      // The plain source is untouched by the tag, which is what "a host with
      // one audience pays nothing" means concretely.
      boxes: 'Caixas',
    });
    expect(labelsOf(catalog(), 'pt-BR').domains).toMatchObject({ shelves: 'Prateleiras' });
  });

  it('layers the host`s ROLE words on in the same language', () => {
    // Not a separate axis. Leaving `roleLabels` plain would have produced a
    // roster whose permission words followed the reader and whose role names
    // did not — one grid, two languages.
    expect(labelsOf(catalog(), 'en-US').roles).toEqual({ CLERK: 'Counter clerk' });
    expect(labelsOf(catalog(), 'pt-BR').roles).toEqual({ CLERK: 'Atendente de balcão' });
  });

  it('asks at the READ, never once at the composition', () => {
    /**
     * The whole point of carrying the resolver through the merge, and the case
     * that fails against the cheaper design. A host composes its catalog ONCE,
     * at module scope, and shares that object between its server and its
     * screens — so a resolver called during `composePermissions` would answer
     * every later reader with the language that module was first evaluated in.
     * Counting the calls says which boundary this is.
     */
    const asked: Array<string | null | undefined> = [];
    const recording = definePermissionContribution({
      source: 'demo-recording',
      permissions: { 'crates:move': { kind: 'class' } },
      labels: ({ locale }) => {
        asked.push(locale);
        return { domains: { crates: 'Engradados' } };
      },
    });

    const composed = composePermissions(recording);
    expect(asked).toEqual([]);

    labelsOf(composed, 'en-US');
    labelsOf(composed, 'pt-BR');
    expect(asked).toEqual(['en-US', 'pt-BR']);
  });

  it('treats a read with no locale as "nobody said"', () => {
    // Not pt-BR. A default applied here would be a second place that decides a
    // language, and the one place that should decide is the host's resolver.
    const seen: Array<string | null | undefined> = [];
    labelsOf(
      composePermissions(
        definePermissionContribution({
          source: 'demo-silent',
          permissions: { 'crates:move': { kind: 'class' } },
          labels: ({ locale }) => {
            seen.push(locale);
            return {};
          },
        }),
      ),
    );
    expect(seen).toEqual([undefined]);
  });

  it('leaves the ids, the specs and the per-id label untouched by the language', () => {
    /**
     * Rule H, on the half of this structure that must never follow a reader.
     * An id is a value the wire carries and a `kind` decides whether the entity
     * gate runs after RBAC — translating either would change what the system
     * DOES. The per-id `label` rides on the spec for that reason and is
     * deliberately not part of the resolved half.
     */
    const en = catalog();
    const pt = catalog();
    expect(en.ids).toEqual(pt.ids);
    expect(en.permissions.kind('shelves:reshelve:own')).toBe('instance');
    expect(labelsOf(en, 'en-US').permissions).toEqual(
      labelsOf(pt, 'pt-BR').permissions,
    );
  });
});

describe('the screens read it through the accessor, per render', () => {
  it('composes a label out of the segments of the language in force', () => {
    const english = createRbacLabels(labelsOf(catalog(), 'en-US'));
    expect(english.domainLabel('shelves')).toBe('Shelves');
    expect(english.permissionActionLabel('shelves:reshelve:own')).toBe('Reshelve (your own)');

    const portuguese = createRbacLabels(labelsOf(catalog(), 'pt-BR'));
    expect(portuguese.permissionActionLabel('shelves:reshelve:own')).toBe('Recolocar (suas)');
  });

  it('still falls back to the raw segment for a word nobody translated', () => {
    // The composer's oldest promise, which the resolver must not quietly break:
    // an untranslated permission renders untranslated rather than vanishing
    // from the picker.
    expect(
      createRbacLabels(labelsOf(catalog(), 'en-US')).permissionActionLabel('foo:frobnicate'),
    ).toBe('frobnicate');
  });

  it('re-renders in the new language when the reader switches', () => {
    /**
     * The end-to-end shape of rule B in a browser, without mounting the whole
     * surface: a component reads the catalog through the accessor with the tag
     * in scope, so a language change is an ordinary re-render. The failure this
     * replaces is a screen that keeps the words it was built with because the
     * catalog handed over a table instead of a resolver.
     */
    const CATALOG = catalog();
    function Heading({ locale }: { locale: string }): JSX.Element {
      return <h1>{createRbacLabels(labelsOf(CATALOG, locale)).domainLabel('shelves')}</h1>;
    }

    const view = render(<Heading locale="pt-BR" />);
    expect(screen.getByRole('heading').textContent).toBe('Prateleiras');
    view.rerender(<Heading locale="en-US" />);
    expect(screen.getByRole('heading').textContent).toBe('Shelves');
  });
});

describe('the surface the host mounts — the tag has to reach the render', () => {
  /**
   * A catalog whose words are a resolver is inert unless something tells the
   * screens which language to ask for. `createWebRbac` is built ONCE, in a
   * `useMemo` keyed on the tenant — its members are component TYPES — so the
   * seam is a HOOK: a tag passed as config would be the language that was true
   * when the tenant was last switched.
   *
   * The roster is the screen asserted on because it renders a ROLE label
   * (`labels.roleLabel`) straight into a cell, which is the shortest path from
   * the host's `roleLabels` through composition to something a person reads.
   */
  const CATALOG = catalog();

  /** The whole backend, substituted — the transport is the surface's only I/O. */
  const transport = {
    get: async <T,>(url: string): Promise<T> => {
      if (url.endsWith('/permissions')) {
        return { data: { permissions: ['team:read'] } } as T;
      }
      if (url.endsWith('/team/context')) {
        return {
          data: {
            customRolesByMember: [],
            assignableRoles: ['CLERK'],
            pendingInvites: [],
            invitesEnabled: false,
          },
        } as T;
      }
      return {
        data: [
          {
            userId: 'u1',
            role: 'CLERK',
            email: 'ana@example.test',
            name: 'Ana',
            image: null,
            active: true,
            status: 'ENABLED',
          },
        ],
        pagination: { total: 1, page: 1, pageSize: 20, pageCount: 1, hasNextPage: false },
      } as T;
    },
    send: async <T,>(): Promise<{ ok: true; data: T }> => ({ ok: true, data: null as T }),
  };

  function roster(useLocale?: () => string | null | undefined) {
    return createWebRbac({
      apiBase: '/api/admin/demo',
      tenantSlug: 'demo',
      catalog: CATALOG,
      copy: PT_BR_RBAC_WEB_COPY,
      transport,
      formatters: { date: (iso) => iso, dateTime: (iso) => iso },
      ...(useLocale ? { useLocale } : {}),
    }).TeamScreen;
  }

  it('renders a role`s label in the reader`s language', async () => {
    const TeamScreen = roster(() => 'en-US');
    render(
      <MemoryRouter>
        <TeamScreen />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Counter clerk')).toBeDefined();
  });

  it('renders the words the host configured when no seam is wired', async () => {
    const TeamScreen = roster();
    render(
      <MemoryRouter>
        <TeamScreen />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Atendente de balcão')).toBeDefined();
  });
});
