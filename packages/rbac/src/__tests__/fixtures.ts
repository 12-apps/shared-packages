import { buildRoleIndex } from '../core/roles';
import type { CanContext } from '../core/can';

import { DEMO_CATALOG } from './demo-catalog';

/** A ready-to-use CanContext built from the demo host's composed catalog. */
export function demoCtx(globalScope = 'GLOBAL'): CanContext {
  return {
    roleIndex: buildRoleIndex(DEMO_CATALOG.roleTemplates),
    globalScope,
    allPermissions: DEMO_CATALOG.permissions.list,
  };
}
