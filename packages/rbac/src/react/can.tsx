'use client';

import type { ReactNode } from 'react';
import { useCan } from './context';

export interface CanProps {
  /** Permission to check against the provided permission set. */
  permission: string;
  /** Rendered when the permission is granted. */
  children: ReactNode;
  /** Rendered when denied. Defaults to `null`. */
  fallback?: ReactNode;
}

/** Renders `children` when `permission` is granted, otherwise `fallback`. */
export function Can({
  permission,
  children,
  fallback = null,
}: CanProps): ReactNode {
  const can = useCan();
  return can(permission) ? children : fallback;
}
