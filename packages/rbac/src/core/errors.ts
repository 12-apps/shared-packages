import type { Scope } from './types';

/** Thrown by the engine/guards when an actor lacks a required permission. */
export class PermissionDeniedError extends Error {
  readonly actorId: string;
  readonly permission: string;
  readonly scope: Scope;

  constructor(actorId: string, permission: string, scope: Scope) {
    super(
      `Permission denied: actor "${actorId}" lacks "${permission}" in scope "${scope}"`,
    );
    this.name = 'PermissionDeniedError';
    this.actorId = actorId;
    this.permission = permission;
    this.scope = scope;
    // Restore prototype chain for downlevel targets / instanceof checks.
    Object.setPrototypeOf(this, PermissionDeniedError.prototype);
  }
}
