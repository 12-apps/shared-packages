import { describe, expect, it } from 'vitest';

import { entitlementsPermissions } from '../server/contribution';
import { EN_US_ENTITLEMENTS_PERMISSION_LABELS } from '../server/en-US';
import { ENTITLEMENTS_PERMISSION_LABELS } from '../server/locales';
import { PT_BR_ENTITLEMENTS_PERMISSION_LABELS } from '../server/pt-BR';

/**
 * The label vocabulary this package contributes to a host's permission
 * catalog, and the one thing that was missing from it: the field would not
 * take a resolver, so `localeCopy(...)` did not type-check however the host
 * composed.
 *
 * What is pinned here is the CHOICE being available and the plain form being
 * unchanged — not the words, which are host copy and change.
 */
describe('entitlementsPermissions', () => {
  it('still takes a plain pack, unchanged', () => {
    const contribution = entitlementsPermissions(PT_BR_ENTITLEMENTS_PERMISSION_LABELS);

    expect(contribution.source).toBe('@12-apps/entitlements');
    expect(contribution.ids).toEqual(['plan:request']);
    expect(contribution.labels).toEqual(PT_BR_ENTITLEMENTS_PERMISSION_LABELS);
  });

  it('takes a resolver and composes in the locale it is given', () => {
    const resolver = ({ locale }: { readonly locale?: string | null }) =>
      locale === 'en-US'
        ? EN_US_ENTITLEMENTS_PERMISSION_LABELS
        : PT_BR_ENTITLEMENTS_PERMISSION_LABELS;

    expect(entitlementsPermissions(resolver, 'en-US').labels).toEqual(
      EN_US_ENTITLEMENTS_PERMISSION_LABELS,
    );
    expect(entitlementsPermissions(resolver, 'pt-BR').labels).toEqual(
      PT_BR_ENTITLEMENTS_PERMISSION_LABELS,
    );
  });

  it('asks the resolver once per composition, with that composition\'s locale', () => {
    // The catalog is a static structure — `composePermissions` merges every
    // source's vocabulary into one. So the compose IS the last moment a
    // language can be chosen, and a host whose readers differ composes per
    // reader. Pinning the call shape says which boundary this is.
    const asked: Array<string | null | undefined> = [];
    const recording = ({ locale }: { readonly locale?: string | null }) => {
      asked.push(locale);
      return PT_BR_ENTITLEMENTS_PERMISSION_LABELS;
    };

    entitlementsPermissions(recording, 'en-US');
    entitlementsPermissions(recording, 'pt-BR');

    expect(asked).toEqual(['en-US', 'pt-BR']);
  });

  it('treats a composition with no locale as "nobody said"', () => {
    const seen: Array<string | null | undefined> = [];
    entitlementsPermissions(({ locale }) => {
      seen.push(locale);
      return PT_BR_ENTITLEMENTS_PERMISSION_LABELS;
    });

    expect(seen).toEqual([undefined]);
  });

  it('leaves the permission SPECS untouched by the language', () => {
    /**
     * Rule H, on the half of this structure that must never follow a reader:
     * the id and its kind are mechanism. A vocabulary that translated
     * `plan:request` — or flipped its `kind` — would change what the entity
     * gate does, not what a picker reads.
     */
    const pt = entitlementsPermissions(PT_BR_ENTITLEMENTS_PERMISSION_LABELS);
    const en = entitlementsPermissions(EN_US_ENTITLEMENTS_PERMISSION_LABELS);

    expect(en.ids).toEqual(pt.ids);
    expect(en.permissions).toEqual(pt.permissions);
  });

  it('pairs both languages under one tag-keyed pack', () => {
    expect(ENTITLEMENTS_PERMISSION_LABELS['pt-BR']).toBe(PT_BR_ENTITLEMENTS_PERMISSION_LABELS);
    expect(ENTITLEMENTS_PERMISSION_LABELS['en-US']).toBe(EN_US_ENTITLEMENTS_PERMISSION_LABELS);
  });
});
