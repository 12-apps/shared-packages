import type { ProviderDescriptor } from '@12-apps/payments-backend';

/**
 * Whether this provider's "test" is a LOCAL check — there is no provider to
 * connect to (the store's own Pix key, `capabilities.confirmation: 'MANUAL'`).
 * Its screen must not say keys are tested "no provedor" or call a passing
 * check a CONNECTION. Read defensively: a host-built descriptor may carry no
 * capabilities.
 */
export function checksLocally(descriptor: Pick<ProviderDescriptor, 'capabilities'> | undefined): boolean {
  const capabilities = descriptor?.capabilities as ProviderDescriptor['capabilities'] | undefined;
  return capabilities?.confirmation === 'MANUAL';
}
