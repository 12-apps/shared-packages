/**
 * The two factories: the host's packs, widgets, hooks and readers, checked
 * when the host boots. A pack missing a key, or a piece left out, fails named
 * (`closingScreens.copy.locales.<tag>.<key>`), never as a blank line on screen.
 */
import type { JSX } from 'react';

import { TENANT_COPY_SHAPE } from '../../config';
import { TenantConfigError } from '../../validate';
import { ArchiveCardScreen, type ArchiveCardProps } from './archive-card';
import { ArchivePanelScreen, type ArchivePanelProps } from './archive-panel';
import { ClosingBannerScreen, type ClosingBannerProps } from './banner';
import { ClosePageScreen, type ClosePageProps } from './close-page';
import type { TenantClosingScreensConfig, TenantPlatformArchiveConfig } from './config';
import { ClosingConfigProvider, PlatformConfigProvider, type ClosingConfig, type PlatformConfig } from './context';
import { TENANT_LIFECYCLE_SCREENS_COPY_SHAPE } from './copy';
import { TenantGoneScreenBody, type TenantGoneScreenProps } from './gone-screen';
import { makeRefusalReaders } from './refusals';
import type { TenantLifecyclePin } from './types';

type Bag = Record<string, unknown>;
const isBag = (value: unknown): value is Bag => typeof value === 'object' && value !== null && !Array.isArray(value);

function requireBag(value: unknown, key: string): Bag {
  if (value === undefined || value === null) throw new TenantConfigError(key, 'is required and missing');
  if (!isBag(value)) throw new TenantConfigError(key, 'must be an object');
  return value;
}

function requireText(value: unknown, key: string): string {
  if (value === undefined || value === null) throw new TenantConfigError(key, 'is required and missing');
  if (typeof value !== 'string' || value.trim() === '') throw new TenantConfigError(key, 'must be a non-empty string');
  return value;
}

function requireFunction(value: unknown, key: string, what = 'a function'): void {
  if (value === undefined || value === null) throw new TenantConfigError(key, 'is required and missing');
  if (typeof value !== 'function') throw new TenantConfigError(key, `must be ${what}`);
}

function requireComponent(value: unknown, key: string): void {
  if (value === undefined || value === null) throw new TenantConfigError(key, 'is required and missing');
  // A function component, or an exotic one (memo, forwardRef): an object with `$$typeof`.
  if (typeof value !== 'function' && !(isBag(value) && '$$typeof' in value)) {
    throw new TenantConfigError(key, 'must be a React component');
  }
}

const PACK_SHAPE: ReadonlyArray<readonly [string, 'text' | 'sentence']> = [
  ...Object.entries(TENANT_COPY_SHAPE),
  ...Object.entries(TENANT_LIFECYCLE_SCREENS_COPY_SHAPE),
];

function checkPack(value: unknown, key: string): void {
  const pack = requireBag(value, key);
  PACK_SHAPE.forEach(([name, kind]) => {
    if (kind === 'text') requireText(pack[name], `${key}.${name}`);
    else requireFunction(pack[name], `${key}.${name}`, 'a function that writes the whole sentence');
  });
}

function checkCopy(value: unknown, root: string): void {
  const copy = requireBag(value, `${root}.copy`);
  const locales = requireBag(copy.locales, `${root}.copy.locales`);
  const tags = Object.keys(locales);
  if (tags.length === 0) throw new TenantConfigError(`${root}.copy.locales`, 'must hold at least one locale pack');
  for (const tag of tags) checkPack(locales[tag], `${root}.copy.locales.${tag}`);
  const fallback = requireText(copy.defaultLocale, `${root}.copy.defaultLocale`);
  if (!tags.includes(fallback)) {
    throw new TenantConfigError(`${root}.copy.defaultLocale`, `names "${fallback}", which copy.locales does not hold`);
  }
}

function checkStatuses(value: unknown, root: string): Bag {
  const statuses = requireBag(value, `${root}.statuses`);
  for (const role of ['active', 'closing', 'closed'] as const) requireText(statuses[role], `${root}.statuses.${role}`);
  return statuses;
}

function checkGroup(value: unknown, key: string, names: readonly string[], check: (value: unknown, key: string) => void): void {
  const bag = requireBag(value, key);
  for (const name of names) check(bag[name], `${key}.${name}`);
}

/** Check the closing screens' config. Throws {@link TenantConfigError}. */
export function validateClosingScreens(config: unknown): void {
  const root = 'closingScreens';
  const bag = requireBag(config, root);
  checkStatuses(bag.statuses, root);
  checkCopy(bag.copy, root);
  checkGroup(bag.refusals, `${root}.refusals`, ['closing', 'closed', 'readOnly'], requireText);
  checkGroup(bag.paths, `${root}.paths`, ['app', 'api', 'closePage'], requireText);
  const hooks = ['useClosingView', 'useClosingState', 'useRequestExport', 'useClose', 'useReopen', 'useHoldsClose', 'usePathname', 'usePin'];
  checkGroup(bag.hooks, `${root}.hooks`, hooks, requireFunction);
  checkGroup(bag.components, `${root}.components`, ['PinFields', 'UndoNote', 'Link', 'Frame'], requireComponent);
  for (const name of ['errorAnswer', 'toast', 'navigate', 'shortDay']) requireFunction(bag[name], `${root}.${name}`);
  requireText(bag.testIdWord, `${root}.testIdWord`);
  requireText(bag.nameLocale, `${root}.nameLocale`);
}

/** Check the platform archive's config. Throws {@link TenantConfigError}. */
export function validatePlatformArchive(config: unknown): void {
  const root = 'platformArchive';
  const bag = requireBag(config, root);
  const statuses = checkStatuses(bag.statuses, root);
  const from = statuses.closableFrom;
  if (from === undefined || from === null) throw new TenantConfigError(`${root}.statuses.closableFrom`, 'is required and missing');
  if (!Array.isArray(from) || from.length === 0) {
    throw new TenantConfigError(`${root}.statuses.closableFrom`, 'must be a non-empty array');
  }
  from.forEach((status, index) => requireText(status, `${root}.statuses.closableFrom[${index}]`));
  checkCopy(bag.copy, root);
  checkGroup(bag.components, `${root}.components`, ['PinFields', 'UndoNote', 'Overlay'], requireComponent);
  requireFunction(bag.toast, `${root}.toast`);
}

/**
 * The owner's closing screens and the readers of a closing tenant's refusals.
 * `P` is the host's PIN: its `usePin` and its `PinFields` agree on it.
 */
export function createClosingScreens<P extends TenantLifecyclePin>(config: TenantClosingScreensConfig<P>) {
  validateClosingScreens(config);
  // The PIN's own type is erased for the parts: `usePin` and `PinFields` were checked to agree on `P`.
  const value = config as unknown as ClosingConfig;
  const readers = makeRefusalReaders(config);
  return {
    /** Settings › the close page; `copy` is this render's resolved pack. */
    ClosePage: (props: ClosePageProps): JSX.Element => (
      <ClosingConfigProvider value={value}>
        <ClosePageScreen {...props} />
      </ClosingConfigProvider>
    ),
    /** The banner every screen shows while the tenant is closing. */
    ClosingBanner: (props: ClosingBannerProps): JSX.Element => (
      <ClosingConfigProvider value={value}>
        <ClosingBannerScreen {...props} />
      </ClosingConfigProvider>
    ),
    /** The screen a member a closing or closed tenant keeps out sees. */
    TenantGoneScreen: (props: Omit<TenantGoneScreenProps, 'switchTarget'>): JSX.Element => (
      <ClosingConfigProvider value={value}>
        <TenantGoneScreenBody {...props} switchTarget={readers.switchTarget} />
      </ClosingConfigProvider>
    ),
    ...readers,
  };
}

/** The platform's archive confirmation and its card. `P` is the host's PIN. */
export function createPlatformArchive<P extends TenantLifecyclePin>(config: TenantPlatformArchiveConfig<P>) {
  validatePlatformArchive(config);
  const value = config as unknown as PlatformConfig;
  return {
    /** The confirmation, in the host's overlay; the menu and the card open this one component. */
    ArchivePanel: (props: ArchivePanelProps<P>): JSX.Element => (
      <PlatformConfigProvider value={value}>
        <ArchivePanelScreen {...props} />
      </PlatformConfigProvider>
    ),
    /** The settings card: archive, or who archived it and the restore. */
    ArchiveCard: (props: ArchiveCardProps): JSX.Element => (
      <PlatformConfigProvider value={value}>
        <ArchiveCardScreen {...props} />
      </PlatformConfigProvider>
    ),
  };
}
