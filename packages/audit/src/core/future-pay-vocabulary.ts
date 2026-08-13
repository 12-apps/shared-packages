/**
 * The Future Pay audit vocabulary, as DATA (12-14).
 *
 * The machinery in this package knows nothing about restaurants: it takes an
 * {@link AuditVocabulary} and enforces it. This module is the one that came out
 * of future-pay — its `AUDIT_ACTIONS`, `AUDIT_RESOURCE_TYPES` and
 * `FIELD_ALLOWLIST`, plus the pt-BR labels the admin SPA kept in a fourth,
 * separately-maintained copy. A second host passes its own vocabulary and
 * inherits none of these names (the same shape `@12-apps/rbac` uses to ship
 * `FUTURE_PAY_PERMISSIONS` beside a generic engine).
 *
 * Labels are USER-FACING product copy and therefore pt-BR; every identifier,
 * comment and doc around them is English.
 */
import type { AuditActionDef, AuditResourceDef, AuditVocabulary } from './vocabulary';

/**
 * Audited actions. Dot-namespaced `<resource>.<event>`, validated in TypeScript
 * rather than by a DB CHECK, so a newly instrumented feature extends the list
 * without a migration.
 *
 * Several of these look like variants of one another and are deliberately NOT:
 * `payment.short` / `payment.over` / `payment.refund` / `payment.dispute` point
 * money in different directions and imply different remedies, and an operator
 * reconciling one must not have to read the others to find it. Same for
 * `comanda.force_close` vs `comanda.reopen` (opposites), and for
 * `payment.short` (what the PROVIDER did, written by nobody) vs
 * `payment.short.resolved` (what a HUMAN decided, and what takes the item off
 * the reconciliation queue).
 */
export const FUTURE_PAY_AUDIT_ACTIONS: readonly AuditActionDef[] = [
  { id: 'order.cancel', label: 'Pedido cancelado' },
  { id: 'payment.capture', label: 'Pagamento confirmado' },
  { id: 'payment.unfulfillable', label: 'Pagamento sem estoque' },
  { id: 'payment.short', label: 'Pagamento a menor' },
  { id: 'payment.over', label: 'Pagamento a maior' },
  { id: 'payment.refund', label: 'Pagamento devolvido' },
  { id: 'payment.dispute', label: 'Pagamento contestado' },
  { id: 'payment.short.resolved', label: 'Pagamento a menor resolvido' },
  { id: 'comanda.force_close', label: 'Comanda encerrada' },
  { id: 'comanda.reopen', label: 'Comanda reaberta' },
  { id: 'stock.loss', label: 'Perda de estoque' },
  { id: 'stock.movement_cancel', label: 'Movimentação cancelada' },
  { id: 'stock.movement_restore', label: 'Movimentação restaurada' },
  { id: 'stock.movement_edit', label: 'Movimentação editada' },
  { id: 'role.create', label: 'Papel criado' },
  { id: 'role.update', label: 'Papel alterado' },
  { id: 'role.delete', label: 'Papel excluído' },
  { id: 'team.role_set', label: 'Papel principal definido' },
  { id: 'team.role_grant', label: 'Papel adicional concedido' },
  { id: 'team.role_revoke', label: 'Papel adicional revogado' },
  { id: 'team.member_remove', label: 'Membro removido' },
  // A DENIED escalation / scope-ceiling / separation-of-duties attempt —
  // exactly the event an owner most wants surfaced.
  { id: 'governance.reject', label: 'Tentativa bloqueada' },
  // The PLATFORM deciding what a tenant may use. Not a money mutation, but
  // audited for the same reason one would be: "who put this tenant on Max for
  // free" and "who revoked their audit log" are questions that get asked.
  { id: 'plan.assign', label: 'Plano atribuído' },
  { id: 'plan.override_set', label: 'Ajuste de plano aplicado' },
  { id: 'discount.redeem', label: 'Cupom utilizado' },
  { id: 'shift.start', label: 'Turno iniciado' },
  { id: 'shift.end', label: 'Turno encerrado' },
  // The impersonation session lifecycle, as FOUR actions rather than one with a
  // status field. `start` and `end` are separate rows because the table is
  // append-only — a session cannot be "closed out" by updating the row that
  // opened it, so two rows and a subtraction is the only way to answer "how
  // long was someone inside that account", and the only way that stays
  // answerable when the session ends by the clock instead of by a click.
  { id: 'impersonation.start', label: 'Acesso como outro usuário iniciado' },
  { id: 'impersonation.end', label: 'Acesso como outro usuário encerrado' },
  // A REFUSED start is audited as loudly as a successful one, and that is the
  // point of it existing: the interesting security event is not "an owner
  // previewed a role", it is "somebody kept trying to".
  { id: 'impersonation.refused', label: 'Acesso como outro usuário recusado' },
  // ARMING the feature is its own event: the other three describe a SESSION,
  // this one the store's standing decision to permit sessions at all — and
  // "who turned this on" is the first question asked of a capability that lets
  // one person see the app as another.
  { id: 'impersonation.configured', label: 'Acesso como outro usuário configurado' },
];

/**
 * Resource kinds an entry may point at, each with its field allowlist.
 *
 * Only scalar OPERATIONAL fields belong in an allowlist; never buyer contact
 * data or raw provider payloads. Payment events are logged against their ORDER
 * — the resource the venue reasons about — with the provider charge id in the
 * diff pinning the exact charge.
 */
export const FUTURE_PAY_AUDIT_RESOURCES: readonly AuditResourceDef[] = [
  {
    id: 'order',
    label: 'Pedido',
    fields: [
      'status',
      'fulfillmentStatus',
      'totalCents',
      // `totalCents` is NET once a discount applies, so without the gross and
      // the saving beside it the capture diff no longer explains the amount.
      'subtotalCents',
      'discountTotalCents',
      'method',
      'amountCents',
      'providerChargeId',
      // The reconciliation decision: what the operator chose, and the parked
      // `payment.short` entry it answers. The resolution points AT the parked
      // row rather than at the order, because one order can come up short more
      // than once and only the addressed shortfall is resolved.
      'resolution',
      'shortPaymentId',
    ],
  },
  { id: 'table_session', label: 'Comanda', fields: ['status', 'closedAt', 'tableId'] },
  {
    id: 'stock_movement',
    label: 'Movimentação',
    fields: [
      'type',
      'itemId',
      'quantityDelta',
      'unitCostCents',
      'costCents',
      'lossReasonId',
      'reason',
      'canceledAt',
    ],
  },
  { id: 'inventory_item', label: 'Produto', fields: ['quantityDelta', 'lossReasonId', 'reason'] },
  {
    id: 'loss_event',
    label: 'Perda',
    fields: ['itemId', 'lotId', 'lossReasonId', 'quantity', 'unitCostCents'],
  },
  // Role lifecycle: `permissions` is the role's serialized permission string
  // ('*' or a JSON array) — a scalar by design, so the diff shows the exact
  // bundle change.
  { id: 'role', label: 'Papel', fields: ['name', 'description', 'permissions', 'kind'] },
  { id: 'membership', label: 'Membro', fields: ['role', 'previousRole', 'roleName'] },
  // A governance REJECTION: the validator's machine code, the role whose grant
  // or composition was denied, and the grant target.
  { id: 'governance', label: 'Governança', fields: ['code', 'roleName', 'targetUserId'] },
  // The tenant row itself, for platform-written plan-layer changes: `plan_key`
  // and the serialized override map are columns on it.
  { id: 'client', label: 'Loja', fields: ['planKey', 'overrides'] },
  // A discount rule: the coupon, how it computes, what it removed, where its
  // redemption counter stands. Never the buyer who redeemed it — the order
  // entry already carries that link.
  { id: 'discount', label: 'Cupom', fields: ['code', 'type', 'amountCents', 'usageCount'] },
  {
    id: 'shift',
    label: 'Turno',
    fields: [
      'userId',
      'kind',
      'startedAt',
      'endedAt',
      'endedReason',
      'endedByUserId',
      'resourceType',
      'resourceId',
    ],
  },
  {
    // An impersonation SESSION. There is no row anywhere to point at — the
    // session lives only in a signed cookie and in its own entries — so
    // `resourceId` carries WHO/WHAT was being rendered.
    //
    // This allowlist is the UNION of what BOTH writers emit (the platform trail
    // and the tenant's preview routes). They stay two writers because the two
    // sessions record genuinely different facts, but they share one resource
    // type and therefore one allowlist: a field only one of them emits still
    // has to be listed here, or that writer's entries come back hollow and the
    // action name is the only thing the row says.
    //
    // `reason` is the operator's free-text justification — the only free text
    // here, and deliberately kept: "why was someone inside this account" is the
    // question the whole log exists to answer, and a reason nobody can read
    // afterwards is a reason nobody gave.
    //
    // Deliberately ABSENT: anything about the previewed person beyond their
    // user id. A name or e-mail here would put contact data into an append-only
    // table to save a join the listing route already does.
    id: 'impersonation',
    label: 'Sessão de acesso',
    fields: [
      'kind',
      'previewAs',
      'roleName',
      'memberUserId',
      'targetUserId',
      'targetApp',
      'reason',
      'allowWrites',
      'readOnly',
      'expiresAt',
      'refusal',
      'actorEmail',
      'code',
      'enabled',
    ],
  },
];

export const FUTURE_PAY_AUDIT_VOCABULARY: AuditVocabulary = {
  actions: FUTURE_PAY_AUDIT_ACTIONS,
  resources: FUTURE_PAY_AUDIT_RESOURCES,
};

/**
 * The Prisma models whose writes carry `created_by`/`updated_by` in future-pay
 * — the value its `TRACKED_MODELS` constant used to hard-code INSIDE the
 * generic extension. It is config now; this is future-pay's setting.
 */
export const FUTURE_PAY_TRACKED_MODELS: readonly string[] = [
  'MenuItem',
  'InventoryItem',
  'ProductCategory',
  'Supplier',
  'Discount',
];

/**
 * Action literals a HOST selects on, named once so a writer and a reader can
 * never drift apart on the string. `payment.short` is the parked shortfall the
 * reconciliation list reads; `payment.short.resolved` is what removes it from
 * that list, so the badge can reach zero.
 */
export const SHORT_PAYMENT_ACTION = 'payment.short';
export const OVER_PAYMENT_ACTION = 'payment.over';
export const REFUND_PAYMENT_ACTION = 'payment.refund';
export const DISPUTE_PAYMENT_ACTION = 'payment.dispute';
export const SHORT_PAYMENT_RESOLVED_ACTION = 'payment.short.resolved';
