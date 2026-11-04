import type { ReactNode } from 'react';

/** A footer worth a bar: `null`, `false` and `undefined` draw none, on either surface. */
export const hasFooter = (footer: ReactNode): boolean => footer !== undefined && footer !== null && footer !== false;
