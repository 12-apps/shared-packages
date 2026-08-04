'use client';

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';

/** Context value: the actor's already-resolved permission set for a scope. */
const RbacContext = createContext<ReadonlySet<string> | null>(null);

export interface RbacProviderProps {
  /**
   * Permissions the current actor holds in the current scope. This is
   * ALREADY RESOLVED server-side by the host (the provider does NOT call the
   * resolver or touch a DB), keeping the client free of host wiring.
   */
  permissions: Iterable<string>;
  children: ReactNode;
}

/** Stores a `Set<string>` of resolved permissions in React context. */
export function RbacProvider({ permissions, children }: RbacProviderProps) {
  // Snapshot the iterable into a stable Set. We intentionally re-snapshot when
  // the `permissions` reference changes; hosts pass a stable value per render.
  const value = useMemo<ReadonlySet<string>>(
    () => new Set(permissions),
    [permissions],
  );
  return <RbacContext.Provider value={value}>{children}</RbacContext.Provider>;
}

/** Read the permission set from context (throws if no provider mounted). */
export function useRbacPermissions(): ReadonlySet<string> {
  const ctx = useContext(RbacContext);
  if (ctx === null) {
    throw new Error('useCan/<Can> must be used within an <RbacProvider>');
  }
  return ctx;
}

/**
 * Returns a checker over the context permission set.
 * @example const can = useCan(); can('posts:write');
 */
export function useCan(): (permission: string) => boolean {
  const permissions = useRbacPermissions();
  return useMemo(
    () => (permission: string) => permissions.has(permission),
    [permissions],
  );
}
