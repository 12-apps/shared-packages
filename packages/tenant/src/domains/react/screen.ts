/**
 * `createDomainsScreen`: the host's packs and widgets, checked at startup.
 * A pack missing a key, or a widget left out, fails when the host boots,
 * named (`domainsScreen.copy.locales.<tag>.records.<key>`), instead of a blank
 * line on screen.
 */
import { TenantConfigError } from '../../validate';
import { PairAnnouncement, makeDomainsCard } from './card';
import type { TenantDomainsComponents } from './context';
import { TENANT_DOMAINS_COPY_SHAPE, type TenantDomainsCopy } from './copy';

export interface TenantDomainsScreenConfig {
  copy: { locales: Record<string, TenantDomainsCopy>; defaultLocale: string };
  components: TenantDomainsComponents;
}

type Bag = Record<string, unknown>;
const isBag = (value: unknown): value is Bag => typeof value === 'object' && value !== null && !Array.isArray(value);

function requireBag(value: unknown, key: string): Bag {
  if (value === undefined || value === null) throw new TenantConfigError(key, 'is required and missing');
  if (!isBag(value)) throw new TenantConfigError(key, 'must be an object');
  return value;
}

function checkEntry(value: unknown, kind: 'text' | 'sentence', key: string): void {
  if (value === undefined || value === null) throw new TenantConfigError(key, 'is required and missing');
  if (kind === 'text' && (typeof value !== 'string' || value.trim() === '')) {
    throw new TenantConfigError(key, 'must be a non-empty string');
  }
  if (kind === 'sentence' && typeof value !== 'function') {
    throw new TenantConfigError(key, 'must be a function that writes the whole sentence');
  }
}

/** Every grouped key of a pack, once: `[group, name, kind]`. */
const GROUPED_KEYS = (['records', 'pair'] as const).flatMap((group) =>
  Object.entries(TENANT_DOMAINS_COPY_SHAPE[group]).map(([name, kind]) => [group, name, kind] as const),
);

function checkPack(value: unknown, key: string): void {
  const pack = requireBag(value, key);
  const groups = { records: requireBag(pack.records, `${key}.records`), pair: requireBag(pack.pair, `${key}.pair`) };
  for (const [group, name, kind] of GROUPED_KEYS) checkEntry(groups[group][name], kind, `${key}.${group}.${name}`);
  checkEntry(pack.closeAlert, TENANT_DOMAINS_COPY_SHAPE.closeAlert, `${key}.closeAlert`);
}

function checkCopy(value: unknown): void {
  const copy = requireBag(value, 'domainsScreen.copy');
  const locales = requireBag(copy.locales, 'domainsScreen.copy.locales');
  const tags = Object.keys(locales);
  if (tags.length === 0) throw new TenantConfigError('domainsScreen.copy.locales', 'must hold at least one locale pack');
  for (const tag of tags) checkPack(locales[tag], `domainsScreen.copy.locales.${tag}`);
  const fallback = copy.defaultLocale;
  if (typeof fallback !== 'string' || fallback === '') {
    throw new TenantConfigError('domainsScreen.copy.defaultLocale', 'is required and missing');
  }
  if (!tags.includes(fallback)) {
    throw new TenantConfigError('domainsScreen.copy.defaultLocale', `names "${fallback}", which copy.locales does not hold`);
  }
}

function checkComponents(value: unknown): void {
  const components = requireBag(value, 'domainsScreen.components');
  for (const name of ['ConfirmButton', 'Segmented'] as const) {
    const component = components[name];
    if (component === undefined || component === null) {
      throw new TenantConfigError(`domainsScreen.components.${name}`, 'is required and missing');
    }
    // A function component, or an exotic one (memo, forwardRef): an object with `$$typeof`.
    if (typeof component !== 'function' && !(isBag(component) && '$$typeof' in component)) {
      throw new TenantConfigError(`domainsScreen.components.${name}`, 'must be a React component');
    }
  }
}

/** Check the screen's config. Throws {@link TenantConfigError}. */
export function validateDomainsScreen(config: unknown): void {
  const bag = requireBag(config, 'domainsScreen');
  checkCopy(bag.copy);
  checkComponents(bag.components);
}

export function createDomainsScreen(config: TenantDomainsScreenConfig) {
  validateDomainsScreen(config);
  return {
    /** The claims, the records, verify / remove and the removed list; `copy` is this render's resolved pack. */
    DomainsCard: makeDomainsCard(config.components),
    /** The claim field's note that a root is claimed with its `www.`. */
    PairAnnouncement,
  };
}
