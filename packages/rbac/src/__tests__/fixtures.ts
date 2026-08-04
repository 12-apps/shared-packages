import { buildRoleIndex } from '../core/roles';
import type { CanContext } from '../core/can';
import {
  DEFAULT_ROLE_TEMPLATES,
  FUTURE_PAY_PERMISSIONS,
} from '../templates';

/** A ready-to-use CanContext built from the Future Pay templates. */
export function futurePayCtx(globalScope = 'GLOBAL'): CanContext {
  return {
    roleIndex: buildRoleIndex(DEFAULT_ROLE_TEMPLATES),
    globalScope,
    allPermissions: FUTURE_PAY_PERMISSIONS.list,
  };
}
