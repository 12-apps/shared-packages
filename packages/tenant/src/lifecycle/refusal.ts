/**
 * The refusals the lifecycle and its gates answer: each a refusal kind of the
 * host's own code set, with a FIXED HTTP status and the sentence of the
 * caller's copy pack.
 */
import type { TenantCopyPack } from '../config';
import type { TenantRefusalKind } from '../core';

/** The lifecycle's refusal kinds (the export's are the export slice's). */
export type TenantLifecycleRefusalKind = Exclude<TenantRefusalKind, 'exportNeedsPerson' | 'exportNotFound' | 'exportExpired'>;

/** Each kind's HTTP status: never the host's choice, so every host's clients read the same. */
export const TENANT_REFUSAL_STATUS: Readonly<Record<TenantLifecycleRefusalKind, 403 | 409 | 422>> = {
  closing: 403,
  readOnly: 403,
  closed: 403,
  gone: 409,
  alreadyClosing: 409,
  notActive: 409,
  closingBlocked: 409,
  purged: 409,
  notClosing: 409,
  reasonTooShort: 422,
  nameMismatch: 422,
};

const SENTENCES: Readonly<Record<TenantLifecycleRefusalKind, (copy: TenantCopyPack, count: number) => string>> = {
  closing: (copy) => copy.refusalClosing,
  readOnly: (copy) => copy.refusalReadOnly,
  closed: (copy) => copy.refusalClosed,
  gone: (copy) => copy.refusalGone,
  alreadyClosing: (copy) => copy.refusalAlreadyClosing,
  notActive: (copy) => copy.refusalNotActive,
  closingBlocked: (copy, count) => copy.refusalBlocked(count),
  purged: (copy) => copy.refusalPurged,
  notClosing: (copy) => copy.refusalNotClosing,
  reasonTooShort: (copy) => copy.refusalReasonTooShort,
  nameMismatch: (copy) => copy.refusalNameMismatch,
};

/** The sentence a kind reads in `copy`; `count` is the blockers' for `closingBlocked`. */
export function refusalSentence(copy: TenantCopyPack, kind: TenantLifecycleRefusalKind, count = 0): string {
  return SENTENCES[kind](copy, count);
}

/** A refusal as a gate answers it: status, the host's code, the sentence. */
export interface GateRefusal {
  kind: TenantLifecycleRefusalKind;
  status: 403 | 409 | 422;
  code: string;
  message: string;
}

/** Thrown by `close` and `reopen`: the host maps it onto its own error envelope. */
export class TenantLifecycleRefusal extends Error {
  readonly kind: TenantLifecycleRefusalKind;
  readonly code: string;
  readonly status: 403 | 409 | 422;
  readonly details: Readonly<Record<string, number>>;

  constructor(refusal: GateRefusal, details: Readonly<Record<string, number>> = {}) {
    super(refusal.message);
    this.name = 'TenantLifecycleRefusal';
    this.kind = refusal.kind;
    this.code = refusal.code;
    this.status = refusal.status;
    this.details = details;
  }
}
