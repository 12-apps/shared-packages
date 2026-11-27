/**
 * What every part of the closing screens reads without a prop: the host's
 * validated config. Each screen the factory hands back provides it; a part
 * rendered outside one fails loudly, named.
 */
import { createContext, useContext } from 'react';

import type { TenantClosingScreensConfig, TenantPlatformArchiveConfig } from './config';
import type { TenantLifecyclePin } from './types';

/**
 * The config as the parts read it. The PIN's own type is erased here: the
 * factory checked once that the host's `usePin` and `PinFields` agree on it.
 */
export type ClosingConfig = TenantClosingScreensConfig<TenantLifecyclePin>;
export type PlatformConfig = TenantPlatformArchiveConfig<TenantLifecyclePin>;

const ClosingContext = createContext<ClosingConfig | null>(null);
const PlatformContext = createContext<PlatformConfig | null>(null);

export const ClosingConfigProvider = ClosingContext.Provider;
export const PlatformConfigProvider = PlatformContext.Provider;

export function useClosingConfig(): ClosingConfig {
  const config = useContext(ClosingContext);
  if (config === null) throw new Error('@12-apps/tenant: a closing screen part was rendered outside its screen.');
  return config;
}

export function usePlatformConfig(): PlatformConfig {
  const config = useContext(PlatformContext);
  if (config === null) throw new Error('@12-apps/tenant: an archive part was rendered outside its panel or card.');
  return config;
}
