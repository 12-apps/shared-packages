import type { CredentialFieldSpec } from '../core/types';
import type { InfinitePayCopy } from './copy';

/**
 * The InfiniteTag field, in its own module.
 *
 * `infinitepay.ts` sits at the 400-line size gate, and this is the piece that
 * least belongs beside the charge calls: a `CredentialFieldSpec` describes a
 * FORM — a label, a mask, a pattern, whether to read the value back before
 * saving — and none of it ever reaches InfinitePay. `core/setup-guide-types.ts`
 * splits the same type out of the money types for the same reason.
 *
 * ONE field. `webhookSecret` was offered here once and it was a trap:
 * InfinitePay sends no headers a merchant can configure, so a stored secret
 * caused the verify step to reject every GENUINE delivery — a production store
 * had one set, and no notification InfinitePay sent it ever got through. The
 * verify step now ignores any stored value; the real control is
 * `payment_check`.
 */
export function infinitePayCredentialSchema(
  copy: InfinitePayCopy,
): readonly CredentialFieldSpec[] {
  return [
    {
      key: 'handle',
      label: copy.fields.handle,
      secret: false,
      required: true,
      // The two flags exist for THIS field: it is short, unchecksummed, and
      // decides which account is paid. Monospace so `0` and `O` are told
      // apart by eye; confirmed on save so the value is read back once more
      // before it starts receiving the store's money.
      mono: true,
      confirmOnSave: true,
      placeholder: '$suatag',
      pattern: '^\\$[a-zA-Z0-9][a-zA-Z0-9._-]{2,}$',
      helperText: copy.handleHelp,
    },
  ];
}
